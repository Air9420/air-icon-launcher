//! 插件自带全局热键 —— 低级键盘钩子（WH_KEYBOARD_LL）实现
//!
//! 为什么不用 `RegisterHotKey`：
//! 实测在**插件子线程**里 `RegisterHotKey` 虽然返回成功，
//! 但 `WM_HOTKEY` 收不到（主线程可以，子线程不行）。
//! 而 `WH_KEYBOARD_LL` 低级钩子在子线程工作正常，
//! 且支持无修饰键的单键（如 PgDn），更符合本插件需求。
//!
//! 注意：钩子回调运行在**安装钩子的线程**，必须保持消息循环。

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Mutex;
use std::thread;

static RUNNING: AtomicBool = AtomicBool::new(false);
static STOP_FLAG: AtomicBool = AtomicBool::new(false);
static TARGET_VK: AtomicU32 = AtomicU32::new(0);
static TARGET_MODS: AtomicU32 = AtomicU32::new(0);
static THREAD_ID: AtomicU32 = AtomicU32::new(0);

/// 防抖：记录上次触发时刻（毫秒），避免键盘自动重复
static LAST_FIRE_MS: AtomicU32 = AtomicU32::new(0);

static LOCK: Mutex<()> = Mutex::new(());

/// 热键触发通道（钩子回调是 C 函数，用 static 转发）
static SENDER: Mutex<Option<Sender<()>>> = Mutex::new(None);

pub const M_CTRL: u32 = 1;
pub const M_SHIFT: u32 = 2;
pub const M_ALT: u32 = 4;
pub const M_WIN: u32 = 8;

/// 启动热键监听。返回 true 表示钩子安装成功。
pub fn start(vk: u32, mods_mask: u32, tx: Sender<()>) -> bool {
    let _guard = match LOCK.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };

    stop_locked();

    TARGET_VK.store(vk, Ordering::SeqCst);
    TARGET_MODS.store(mods_mask, Ordering::SeqCst);
    STOP_FLAG.store(false, Ordering::SeqCst);
    LAST_FIRE_MS.store(0, Ordering::SeqCst);

    if let Ok(mut g) = SENDER.lock() {
        *g = Some(tx);
    }

    #[cfg(target_os = "windows")]
    {
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<bool>();

        thread::spawn(move || unsafe {
            use windows::Win32::System::LibraryLoader::GetModuleHandleW;
            use windows::Win32::UI::WindowsAndMessaging::{
                DispatchMessageW, PeekMessageW, SetWindowsHookExW, TranslateMessage,
                UnhookWindowsHookEx, MSG, PM_REMOVE, WH_KEYBOARD_LL,
            };

            let tid = windows::Win32::System::Threading::GetCurrentThreadId();
            THREAD_ID.store(tid, Ordering::SeqCst);

            let h_instance = match GetModuleHandleW(None) {
                Ok(h) => h,
                Err(_) => {
                    THREAD_ID.store(0, Ordering::SeqCst);
                    let _ = ready_tx.send(false);
                    return;
                }
            };

            let hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), h_instance, 0)
            {
                Ok(h) => h,
                Err(_) => {
                    THREAD_ID.store(0, Ordering::SeqCst);
                    let _ = ready_tx.send(false);
                    return;
                }
            };

            RUNNING.store(true, Ordering::SeqCst);
            let _ = ready_tx.send(true);

            let mut msg = MSG::default();
            // 与宿主 keyboard_hook.rs 一致：GetMessageW 阻塞循环。
            // WH_KEYBOARD_LL 的回调依赖线程消息泵，必须持续取消息。
            loop {
                if STOP_FLAG.load(Ordering::SeqCst) {
                    break;
                }
                let has = PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE);
                if has.as_bool() {
                    if msg.message == 0x0012 {
                        // WM_QUIT
                        break;
                    }
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                } else {
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
            }

            let _ = UnhookWindowsHookEx(hook);
            RUNNING.store(false, Ordering::SeqCst);
            THREAD_ID.store(0, Ordering::SeqCst);
        });

        ready_rx
            .recv_timeout(std::time::Duration::from_secs(3))
            .unwrap_or(false)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (vk, mods_mask, tx);
        false
    }
}

/// 低级键盘钩子回调
#[cfg(target_os = "windows")]
unsafe extern "system" fn keyboard_proc(
    code: i32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, KBDLLHOOKSTRUCT, WM_KEYDOWN, WM_SYSKEYDOWN,
    };

    if code < 0 {
        return CallNextHookEx(None, code, wparam, lparam);
    }

    let msg_id = wparam.0 as u32;
    let is_down = msg_id == WM_KEYDOWN || msg_id == WM_SYSKEYDOWN;
    if !is_down {
        return CallNextHookEx(None, code, wparam, lparam);
    }

    let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
    if kb.vkCode != TARGET_VK.load(Ordering::SeqCst) {
        return CallNextHookEx(None, code, wparam, lparam);
    }

    // 校验修饰键状态是否精确匹配
    let need = TARGET_MODS.load(Ordering::SeqCst);
    let ctrl = GetAsyncKeyState(VK_CONTROL.0 as i32) as u16 & 0x8000 != 0;
    let shift = GetAsyncKeyState(VK_SHIFT.0 as i32) as u16 & 0x8000 != 0;
    let alt = GetAsyncKeyState(VK_MENU.0 as i32) as u16 & 0x8000 != 0;
    let win = GetAsyncKeyState(VK_LWIN.0 as i32) as u16 & 0x8000 != 0
        || GetAsyncKeyState(VK_RWIN.0 as i32) as u16 & 0x8000 != 0;

    let want_ctrl = need & M_CTRL != 0;
    let want_shift = need & M_SHIFT != 0;
    let want_alt = need & M_ALT != 0;
    let want_win = need & M_WIN != 0;

    if ctrl != want_ctrl || shift != want_shift || alt != want_alt || win != want_win {
        return CallNextHookEx(None, code, wparam, lparam);
    }

    // 防抖：300ms 内不重复触发（键盘自动重复）
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u32)
        .unwrap_or(0);
    let last = LAST_FIRE_MS.load(Ordering::SeqCst);
    if last != 0 && now.wrapping_sub(last) < 300 {
        return CallNextHookEx(None, code, wparam, lparam);
    }
    LAST_FIRE_MS.store(now, Ordering::SeqCst);

    if let Ok(g) = SENDER.lock() {
        if let Some(tx) = g.as_ref() {
            let _ = tx.send(());
        }
    }

    CallNextHookEx(None, code, wparam, lparam)
}

fn stop_locked() {
    STOP_FLAG.store(true, Ordering::SeqCst);
    for _ in 0..40 {
        if THREAD_ID.load(Ordering::SeqCst) == 0 {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    RUNNING.store(false, Ordering::SeqCst);
    if let Ok(mut g) = SENDER.lock() {
        *g = None;
    }
}

pub fn stop() {
    if let Ok(_g) = LOCK.lock() {
        stop_locked();
    }
}

pub fn is_running() -> bool {
    RUNNING.load(Ordering::SeqCst)
}

/// 特殊键名 → Windows 虚拟键码
fn special_vk(name: &str) -> Option<u32> {
    let vk = match name {
        "pgup" | "pageup" => 0x21,
        "pgdn" | "pagedown" | "pgdown" => 0x22,
        "home" => 0x24,
        "end" => 0x23,
        "insert" | "ins" => 0x2D,
        "delete" | "del" => 0x2E,
        "space" => 0x20,
        "tab" => 0x09,
        "enter" | "return" => 0x0D,
        "esc" | "escape" => 0x1B,
        "backspace" => 0x08,
        "up" => 0x26,
        "down" => 0x28,
        "left" => 0x25,
        "right" => 0x27,
        "capslock" => 0x14,
        "printscreen" => 0x2C,
        "scrolllock" => 0x91,
        "pause" => 0x13,
        "num0" => 0x60,
        "num1" => 0x61,
        "num2" => 0x62,
        "num3" => 0x63,
        "num4" => 0x64,
        "num5" => 0x65,
        "num6" => 0x66,
        "num7" => 0x67,
        "num8" => 0x68,
        "num9" => 0x69,
        "numadd" => 0x6B,
        "numsub" => 0x6D,
        "nummul" => 0x6A,
        "numdiv" => 0x6F,
        "numdec" => 0x6E,
        "backquote" | "`" => 0xC0,
        "minus" | "-" => 0xBD,
        "equal" | "=" => 0xBB,
        "bracketleft" | "[" => 0xDB,
        "bracketright" | "]" => 0xDD,
        "backslash" | "\\" => 0xDC,
        "semicolon" | ";" => 0xBA,
        "quote" | "'" => 0xDE,
        "comma" | "," => 0xBC,
        "period" | "." => 0xBE,
        "slash" | "/" => 0xBF,
        _ => return None,
    };
    Some(vk)
}

/// 把配置里的 "ctrl+shift+m" 解析成 (vk, mods_mask)
pub fn parse_hotkey(spec: &str) -> Option<(u32, u32)> {
    let mut mods = 0u32;
    let mut vk: Option<u32> = None;

    for part in spec.split('+').map(|s| s.trim().to_ascii_lowercase()) {
        if part.is_empty() {
            continue;
        }
        match part.as_str() {
            "ctrl" | "control" => mods |= M_CTRL,
            "shift" => mods |= M_SHIFT,
            "alt" => mods |= M_ALT,
            "win" | "super" | "meta" => mods |= M_WIN,
            other => {
                if let Some(v) = special_vk(other) {
                    vk = Some(v);
                } else if other.len() == 1 {
                    let c = other.chars().next().unwrap().to_ascii_uppercase();
                    if c.is_ascii_uppercase() || c.is_ascii_digit() {
                        vk = Some(c as u32);
                    }
                } else if let Some(n) = other.strip_prefix('f') {
                    if let Ok(num) = n.parse::<u32>() {
                        if (1..=24).contains(&num) {
                            vk = Some(0x70 + num - 1);
                        }
                    }
                }
            }
        }
    }

    vk.map(|v| (v, mods))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple() {
        let (vk, mods) = parse_hotkey("ctrl+shift+m").unwrap();
        assert_eq!(vk, 'M' as u32);
        assert_eq!(mods, M_CTRL | M_SHIFT);
    }

    #[test]
    fn parse_fkey() {
        let (vk, mods) = parse_hotkey("alt+f9").unwrap();
        assert_eq!(vk, 0x70 + 8);
        assert_eq!(mods, M_ALT);
    }

    #[test]
    fn parse_digit() {
        let (vk, _) = parse_hotkey("ctrl+5").unwrap();
        assert_eq!(vk, '5' as u32);
    }

    #[test]
    fn parse_page_keys() {
        let (vk, mods) = parse_hotkey("pgdn").unwrap();
        assert_eq!(vk, 0x22);
        assert_eq!(mods, 0);

        let (vk, mods) = parse_hotkey("pgup").unwrap();
        assert_eq!(vk, 0x21);
        assert_eq!(mods, 0);

        let (vk, mods) = parse_hotkey("ctrl+pgdn").unwrap();
        assert_eq!(vk, 0x22);
        assert_eq!(mods, M_CTRL);
    }

    #[test]
    fn parse_aliases() {
        assert_eq!(parse_hotkey("pageup").unwrap().0, 0x21);
        assert_eq!(parse_hotkey("pagedown").unwrap().0, 0x22);
        assert_eq!(parse_hotkey("ins").unwrap().0, 0x2D);
        assert_eq!(parse_hotkey("del").unwrap().0, 0x2E);
        assert_eq!(parse_hotkey("space").unwrap().0, 0x20);
    }

    #[test]
    fn parse_symbols() {
        assert_eq!(parse_hotkey("ctrl+/").unwrap().0, 0xBF);
        assert_eq!(parse_hotkey("ctrl+-").unwrap().0, 0xBD);
        assert_eq!(parse_hotkey("ctrl+.").unwrap().0, 0xBE);
    }
}
