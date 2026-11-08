//! 插件自带全局热键 —— 四通道并联实现
//!
//! ## 为什么要四条通道
//!
//! 单独用 `WH_KEYBOARD_LL` 在**无边框 / 独占全屏游戏**里收不到按键：
//! 游戏（尤其带反作弊的）会独占键盘设备或屏蔽全局钩子，
//! 表现为「只有 Alt+Tab 切出游戏按热键才生效」。实测日志里 78 次触发
//! 全部来自窗口前台时刻，游戏内一次都没有。
//!
//! 四条通道各有适用面，任一命中即触发（共享防抖，一次按键只切一次）：
//!
//! | 通道 | 原理 | 能穿透什么 |
//! |------|------|-----------|
//! | `WH_KEYBOARD_LL` 低级钩子 | 键盘消息链最前端 | 普通窗口、UWP |
//! | `RegisterHotKey` 系统热键 | 系统级注册，不依赖钩子链 | 独占全屏、多数反作弊 |
//! | `Raw Input` + `RIDEV_INPUTSINK` | 设备级输入，与焦点无关 | 后台窗口、全屏游戏 |
//! | `GetAsyncKeyState` 轮询 | 内核态物理键状态查询 | 反作弊基本拦不住 |
//!
//! 轮询是最可靠的兜底：它既不是钩子、也不依赖窗口消息，
//! 只是每 30ms 问一次「这个键现在按着吗」。按键持续至少 50ms，
//! 30ms 间隔不会漏，代价是几乎为零的 CPU。
//!
//! ## 线程模型
//!
//! 前三条通道都必须挂在**同一个有消息循环的线程**上：
//! - 低级钩子回调运行在安装钩子的线程；
//! - `RegisterHotKey` 的 `WM_HOTKEY` 投递到注册线程的消息队列；
//! - `WM_INPUT` 投递到 `hwndTarget` 所属线程。
//!
//! 所以这里建一个隐藏窗口作为三者共同的锚点。轮询通道独立线程。

use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

static RUNNING: AtomicBool = AtomicBool::new(false);
static STOP_FLAG: AtomicBool = AtomicBool::new(false);
static TARGET_VK: AtomicU32 = AtomicU32::new(0);
static TARGET_MODS: AtomicU32 = AtomicU32::new(0);
static THREAD_ID: AtomicU32 = AtomicU32::new(0);
/// message-only 窗口句柄（0 = 未创建）
static WINDOW: AtomicIsize = AtomicIsize::new(0);

/// 本次成功启用的通道位掩码：bit0=低级钩子 bit1=系统热键 bit2=Raw Input
static ACTIVE_CHANNELS: AtomicU32 = AtomicU32::new(0);

/// 是否允许对**裸键**（无修饰键，如 pgdn）注册系统热键。
///
/// `RegisterHotKey` 会把按键从系统里**吞掉**：注册了裸键 pgdn，
/// 所有程序里的 PageDown 就都失效了。所以裸键默认不注册系统热键，
/// 只靠低级钩子 + Raw Input。需要强制穿透时可以打开这个开关。
static ALLOW_BARE_SYSTEM_HOTKEY: AtomicBool = AtomicBool::new(false);

/// 设置是否允许裸键走系统热键通道（影响下一次 start）。
pub fn set_allow_bare_system_hotkey(allow: bool) {
    ALLOW_BARE_SYSTEM_HOTKEY.store(allow, Ordering::SeqCst);
}

/// 诊断用：强制禁用的通道位掩码（环境变量 `AIR_MCHOSE_DISABLE_CHANNELS`）。
///
/// bit0=低级钩子 bit1=系统热键 bit2=Raw Input。用于验证「游戏里到底靠哪条通道」：
/// 例如设成 `1` 只禁用钩子，就能确认 Raw Input 是否真的在收输入。
static DISABLED_CHANNELS: AtomicU32 = AtomicU32::new(0);

fn load_disabled_channels() -> u32 {
    std::env::var("AIR_MCHOSE_DISABLE_CHANNELS")
        .ok()
        .and_then(|v| v.trim().parse::<u32>().ok())
        .unwrap_or(0)
}

/// 热键回调 worker 的存活标记 + 句柄。
///
/// 宿主 unload 插件时会调 `air_plugin_shutdown`，如果这个 worker 还在跑
/// `do_switch`（HID 重试 + HTTP 推送，最坏 5 秒以上），它会在宿主已卸载
/// `HostUserData` 之后继续 `host_log`，直接踩野指针崩宿主。
/// 所以 shutdown 必须能等它退出。
static WORKER_ALIVE: AtomicBool = AtomicBool::new(false);
static WORKER: Mutex<Option<thread::JoinHandle<()>>> = Mutex::new(None);

/// 防抖：记录上次触发时刻（毫秒），三条通道共享，避免一次按键触发三次
static LAST_FIRE_MS: AtomicU32 = AtomicU32::new(0);

/// 最近一次命中的通道（1=钩子 2=系统热键 3=Raw Input 4=轮询），供 worker 打日志诊断。
static LAST_CHANNEL: AtomicU32 = AtomicU32::new(0);

/// 各通道累计命中次数，便于判断「游戏内到底是哪条通道在起作用」。
static HITS_HOOK: AtomicU32 = AtomicU32::new(0);
static HITS_HOTKEY: AtomicU32 = AtomicU32::new(0);
static HITS_RAW: AtomicU32 = AtomicU32::new(0);
static HITS_POLL: AtomicU32 = AtomicU32::new(0);

/// 轮询通道的停止标记
static POLL_STOP: AtomicBool = AtomicBool::new(false);
static POLL_THREAD: Mutex<Option<thread::JoinHandle<()>>> = Mutex::new(None);

static LOCK: Mutex<()> = Mutex::new(());

/// 热键触发通道（钩子 / 窗口过程都是 C 回调，用 static 转发）
static SENDER: Mutex<Option<Sender<()>>> = Mutex::new(None);

pub const M_CTRL: u32 = 1;
pub const M_SHIFT: u32 = 2;
pub const M_ALT: u32 = 4;
pub const M_WIN: u32 = 8;

/// `RegisterHotKey` 的热键 id
const HOTKEY_ID: i32 = 0x4149; // 'AI'
/// message-only 窗口类名
const WINDOW_CLASS: &str = "AirMchoseHotkeySink";

// ---------------------------------------------------------------- 触发

fn now_ms() -> u32 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u32)
        .unwrap_or(0)
}

/// 统一触发入口：三条通道都走这里，共享 300ms 防抖。
///
/// 返回 true 表示本次真的投递了（未被防抖吞掉），便于日志区分。
fn fire_once() -> bool {
    let now = now_ms();
    let last = LAST_FIRE_MS.load(Ordering::SeqCst);
    if last != 0 && now.wrapping_sub(last) < 300 {
        return false;
    }
    LAST_FIRE_MS.store(now, Ordering::SeqCst);

    if let Ok(g) = SENDER.lock() {
        if let Some(tx) = g.as_ref() {
            let _ = tx.send(());
            return true;
        }
    }
    false
}

/// 带通道标记的触发入口。
fn fire_channel(channel: u32) -> bool {
    // 先记命中计数（即使被防抖吞掉也要记，便于判断通道是否收到输入）
    match channel {
        1 => HITS_HOOK.fetch_add(1, Ordering::Relaxed),
        2 => HITS_HOTKEY.fetch_add(1, Ordering::Relaxed),
        3 => HITS_RAW.fetch_add(1, Ordering::Relaxed),
        4 => HITS_POLL.fetch_add(1, Ordering::Relaxed),
        _ => 0,
    };
    if fire_once() {
        LAST_CHANNEL.store(channel, Ordering::SeqCst);
        true
    } else {
        false
    }
}

/// 各通道累计命中数（钩子, 系统热键, RawInput, 轮询）
pub fn channel_stats() -> (u32, u32, u32, u32) {
    (
        HITS_HOOK.load(Ordering::Relaxed),
        HITS_HOTKEY.load(Ordering::Relaxed),
        HITS_RAW.load(Ordering::Relaxed),
        HITS_POLL.load(Ordering::Relaxed),
    )
}

/// 本次实际启用的通道（用于启动日志与设置页诊断）
pub fn active_channels() -> Vec<&'static str> {
    let m = ACTIVE_CHANNELS.load(Ordering::SeqCst);
    let mut out = Vec::new();
    if m & 1 != 0 {
        out.push("低级钩子");
    }
    if m & 2 != 0 {
        out.push("系统热键");
    }
    if m & 4 != 0 {
        out.push("Raw Input");
    }
    if m & 8 != 0 {
        out.push("按键轮询");
    }
    out
}

// ---------------------------------------------------------------- 通道 4：轮询

/// 轮询线程：每 30ms 查一次目标键的物理按下状态。
///
/// 这条通道不装钩子、不建窗口消息依赖，只调 `GetAsyncKeyState`，
/// 是反作弊最拦不住的一条。用它兜底，游戏内基本不可能漏。
#[cfg(target_os = "windows")]
fn start_polling(vk: u32, mods_mask: u32) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };

    POLL_STOP.store(false, Ordering::SeqCst);
    let handle = thread::spawn(move || {
        // 记录上一帧的按下状态，只在「抬起 → 按下」的跳变时触发，
        // 避免按住不放时每 30ms 触发一次。
        let mut was_down = true; // 初始化为按下，强制第一次必须先抬起
        while !POLL_STOP.load(Ordering::SeqCst) {
            let down = unsafe { GetAsyncKeyState(vk as i32) as u16 & 0x8000 != 0 };
            if down && !was_down {
                let mods_ok = unsafe {
                    let ctrl = GetAsyncKeyState(VK_CONTROL.0 as i32) as u16 & 0x8000 != 0;
                    let shift = GetAsyncKeyState(VK_SHIFT.0 as i32) as u16 & 0x8000 != 0;
                    let alt = GetAsyncKeyState(VK_MENU.0 as i32) as u16 & 0x8000 != 0;
                    let win = GetAsyncKeyState(VK_LWIN.0 as i32) as u16 & 0x8000 != 0
                        || GetAsyncKeyState(VK_RWIN.0 as i32) as u16 & 0x8000 != 0;
                    ctrl == (mods_mask & M_CTRL != 0)
                        && shift == (mods_mask & M_SHIFT != 0)
                        && alt == (mods_mask & M_ALT != 0)
                        && win == (mods_mask & M_WIN != 0)
                };
                if mods_ok {
                    fire_channel(4);
                }
            }
            was_down = down;
            thread::sleep(Duration::from_millis(30));
        }
    });
    if let Ok(mut g) = POLL_THREAD.lock() {
        if let Some(old) = g.replace(handle) {
            let _ = old.join();
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn start_polling(_vk: u32, _mods_mask: u32) {}

fn stop_polling() {
    POLL_STOP.store(true, Ordering::SeqCst);
    if let Ok(mut g) = POLL_THREAD.lock() {
        if let Some(h) = g.take() {
            let _ = h.join();
        }
    }
}

// ---------------------------------------------------------------- 通道诊断

/// 最近一次真正触发的通道名
pub fn last_channel_name() -> &'static str {
    match LAST_CHANNEL.load(Ordering::SeqCst) {
        1 => "低级钩子",
        2 => "系统热键",
        3 => "Raw Input",
        4 => "按键轮询",
        _ => "无",
    }
}

/// 重置通道统计（重新注册热键时调用）
fn reset_stats() {
    HITS_HOOK.store(0, Ordering::Relaxed);
    HITS_HOTKEY.store(0, Ordering::Relaxed);
    HITS_RAW.store(0, Ordering::Relaxed);
    HITS_POLL.store(0, Ordering::Relaxed);
    LAST_CHANNEL.store(0, Ordering::Relaxed);
}

// ---------------------------------------------------------------- 修饰键校验

#[cfg(target_os = "windows")]
fn modifiers_match() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };
    unsafe {
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

        ctrl == want_ctrl && shift == want_shift && alt == want_alt && win == want_win
    }
}

// ---------------------------------------------------------------- 窗口过程

#[cfg(target_os = "windows")]
unsafe extern "system" fn wndproc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::UI::Input::{
        GetRawInputData, HRAWINPUT, RAWINPUT, RAWINPUTHEADER, RID_INPUT, RIM_TYPEKEYBOARD,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        DefWindowProcW, WM_HOTKEY, WM_INPUT, WM_KEYDOWN, WM_SYSKEYDOWN,
    };

    match msg {
        // 通道 2：系统热键。系统已按注册时的 vk+mods 过滤过，无需再校验。
        WM_HOTKEY => {
            if wparam.0 as i32 == HOTKEY_ID {
                fire_channel(2);
            }
            LRESULT(0)
        }

        // 通道 3：Raw Input。设备级输入，与窗口焦点无关。
        WM_INPUT => {
            let mut raw = std::mem::MaybeUninit::<RAWINPUT>::uninit();
            let mut size = std::mem::size_of::<RAWINPUT>() as u32;
            let n = GetRawInputData(
                HRAWINPUT(lparam.0),
                RID_INPUT,
                Some(raw.as_mut_ptr() as *mut _),
                &mut size,
                std::mem::size_of::<RAWINPUTHEADER>() as u32,
            );
            // 失败返回 0 或 u32::MAX
            if n != 0 && n != u32::MAX {
                let ri = raw.assume_init();
                if ri.header.dwType == RIM_TYPEKEYBOARD.0 {
                    let kb = ri.data.keyboard;
                    let is_down = kb.Message == WM_KEYDOWN || kb.Message == WM_SYSKEYDOWN;
                    // 部分驱动 Message 为 0，退回用 Flags 的 break 位判断
                    let flags_down = kb.Flags & 0x01 == 0;
                    if (is_down || (kb.Message == 0 && flags_down))
                        && kb.VKey as u32 == TARGET_VK.load(Ordering::SeqCst)
                        && modifiers_match()
                    {
                        fire_channel(3);
                    }
                }
            }
            // 必须交回 DefWindowProc 做内部清理
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }

        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

// ---------------------------------------------------------------- 通道 1：低级钩子

#[cfg(target_os = "windows")]
unsafe extern "system" fn keyboard_proc(
    code: i32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, KBDLLHOOKSTRUCT, WM_KEYDOWN, WM_SYSKEYDOWN,
    };

    if code < 0 {
        return CallNextHookEx(None, code, wparam, lparam);
    }

    let msg_id = wparam.0 as u32;
    if msg_id != WM_KEYDOWN && msg_id != WM_SYSKEYDOWN {
        return CallNextHookEx(None, code, wparam, lparam);
    }

    let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
    if kb.vkCode == TARGET_VK.load(Ordering::SeqCst) && modifiers_match() {
        fire_channel(1);
    }

    CallNextHookEx(None, code, wparam, lparam)
}

// ---------------------------------------------------------------- 启动 / 停止

/// 把 &str 转成以 NUL 结尾的 UTF-16
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// 启动热键监听。返回 true 表示至少一条通道就绪。
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
    reset_stats();

    if let Ok(mut g) = SENDER.lock() {
        *g = Some(tx);
    }

    #[cfg(target_os = "windows")]
    {
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<bool>();

        thread::spawn(move || unsafe {
            use windows::Win32::System::LibraryLoader::GetModuleHandleW;
            use windows::Win32::UI::WindowsAndMessaging::{
                CreateWindowExW, DispatchMessageW, GetMessageW, RegisterClassW, SetWindowsHookExW,
                TranslateMessage, UnhookWindowsHookEx, MSG, WH_KEYBOARD_LL, WNDCLASSW,
            };
            use windows::core::PCWSTR;

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

            // ---- 隐藏弹窗：Raw Input 与 RegisterHotKey 的锚点 ----
            //
            // 不能用 HWND_MESSAGE（message-only）：实测在部分 Win11 版本上
            // message-only 窗口收不到 WM_INPUT，Raw Input 通道会静默失效。
            // 这里建一个 0x0、不可见、不抢焦点、不进任务栏的真实顶层窗口。
            let class_name = wide(WINDOW_CLASS);
            let wc = WNDCLASSW {
                style: windows::Win32::UI::WindowsAndMessaging::WNDCLASS_STYLES(0),
                lpfnWndProc: Some(wndproc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: h_instance.into(),
                hIcon: Default::default(),
                hCursor: Default::default(),
                hbrBackground: Default::default(),
                lpszMenuName: PCWSTR::null(),
                lpszClassName: PCWSTR(class_name.as_ptr()),
            };
            // 类名可能已存在（重复 start），RegisterClassW 失败不致命
            RegisterClassW(&wc);

            use windows::Win32::UI::WindowsAndMessaging::{
                WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP,
            };
            let hwnd = CreateWindowExW(
                WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                PCWSTR(class_name.as_ptr()),
                PCWSTR(class_name.as_ptr()),
                WS_POPUP,
                0,
                0,
                0,
                0,
                None,
                None,
                h_instance,
                None,
            );
            if hwnd.0 != 0 {
                WINDOW.store(hwnd.0, Ordering::SeqCst);
            }

            let mut channels = 0u32;
            let disabled = load_disabled_channels();
            DISABLED_CHANNELS.store(disabled, Ordering::SeqCst);

            // ---- 通道 1：低级键盘钩子 ----
            let hook = if disabled & 1 == 0 {
                match SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), h_instance, 0) {
                    Ok(h) => {
                        channels |= 1;
                        Some(h)
                    }
                    Err(_) => None,
                }
            } else {
                None
            };

            // ---- 通道 2：RegisterHotKey ----
            // 用真实窗口接收 WM_HOTKEY：比 NULL（投递到线程队列）更可靠，
            // 也不会被同线程其它消息循环逻辑吞掉。
            //
            // ⚠ 裸键（mods=0，如 pgdn）不注册：RegisterHotKey 会把这个键从
            // 系统里吞掉，其他程序里的 PageDown 会全部失效。
            // 带修饰键的组合（ctrl+shift+m）不会被日常输入用到，可以安全注册。
            let need = TARGET_MODS.load(Ordering::SeqCst);
            let bare = need == 0;
            let allow_bare = ALLOW_BARE_SYSTEM_HOTKEY.load(Ordering::SeqCst);
            if hwnd.0 != 0 && (!bare || allow_bare) && disabled & 2 == 0 {
                use windows::Win32::UI::Input::KeyboardAndMouse::{
                    RegisterHotKey, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, MOD_WIN,
                };
                let mut fs = MOD_NOREPEAT;
                if need & M_CTRL != 0 {
                    fs |= MOD_CONTROL;
                }
                if need & M_SHIFT != 0 {
                    fs |= MOD_SHIFT;
                }
                if need & M_ALT != 0 {
                    fs |= MOD_ALT;
                }
                if need & M_WIN != 0 {
                    fs |= MOD_WIN;
                }
                if RegisterHotKey(hwnd, HOTKEY_ID, fs, TARGET_VK.load(Ordering::SeqCst)).is_ok() {
                    channels |= 2;
                }
            }

            // ---- 通道 3：Raw Input（RIDEV_INPUTSINK 后台也能收） ----
            if hwnd.0 != 0 && disabled & 4 == 0 {
                use windows::Win32::UI::Input::{
                    RegisterRawInputDevices, RAWINPUTDEVICE, RAWINPUTDEVICE_FLAGS, RIDEV_INPUTSINK,
                };
                let dev = RAWINPUTDEVICE {
                    usUsagePage: 0x01, // Generic Desktop
                    usUsage: 0x06,     // Keyboard
                    dwFlags: RAWINPUTDEVICE_FLAGS(RIDEV_INPUTSINK.0),
                    hwndTarget: hwnd,
                };
                if RegisterRawInputDevices(&[dev], std::mem::size_of::<RAWINPUTDEVICE>() as u32)
                    .is_ok()
                {
                    channels |= 4;
                }
            }

            // ---- 通道 4：GetAsyncKeyState 轮询（独立线程，不依赖消息循环） ----
            if disabled & 8 == 0 {
                start_polling(TARGET_VK.load(Ordering::SeqCst), need);
                channels |= 8;
            }

            if channels == 0 {
                THREAD_ID.store(0, Ordering::SeqCst);
                let _ = ready_tx.send(false);
                return;
            }
            ACTIVE_CHANNELS.store(channels, Ordering::SeqCst);

            RUNNING.store(true, Ordering::SeqCst);
            let _ = ready_tx.send(true);

            // ---- 消息循环 ----
            let mut msg = MSG::default();
            loop {
                if STOP_FLAG.load(Ordering::SeqCst) {
                    break;
                }
                let ret = GetMessageW(&mut msg, None, 0, 0);
                if ret.0 <= 0 {
                    // 0 = WM_QUIT，-1 = 错误
                    break;
                }
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            // ---- 清理 ----
            if let Some(h) = hook {
                let _ = UnhookWindowsHookEx(h);
            }
            if hwnd.0 != 0 {
                use windows::Win32::UI::Input::KeyboardAndMouse::UnregisterHotKey;
                use windows::Win32::UI::WindowsAndMessaging::DestroyWindow;
                let _ = UnregisterHotKey(hwnd, HOTKEY_ID);
                let _ = DestroyWindow(hwnd);
                WINDOW.store(0, Ordering::SeqCst);
            }
            RUNNING.store(false, Ordering::SeqCst);
            ACTIVE_CHANNELS.store(0, Ordering::SeqCst);
            THREAD_ID.store(0, Ordering::SeqCst);
        });
        // 轮询线程与消息循环线程独立，start 时已拉起；stop 时单独停

        ready_rx
            .recv_timeout(Duration::from_secs(3))
            .unwrap_or(false)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (vk, mods_mask, tx);
        false
    }
}

fn stop_locked() {
    STOP_FLAG.store(true, Ordering::SeqCst);
    // 停轮询线程：它自己 30ms 检查一次 POLL_STOP
    stop_polling();
    // 先断开发送端：worker 的 recv 立刻返回 Err，不再排队新的切换任务。
    if let Ok(mut g) = SENDER.lock() {
        *g = None;
    }
    // 唤醒消息循环：GetMessageW 阻塞时不看 STOP_FLAG，必须投一条消息
    #[cfg(target_os = "windows")]
    {
        let tid = THREAD_ID.load(Ordering::SeqCst);
        if tid != 0 {
            unsafe {
                use windows::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_QUIT};
                let _ = PostThreadMessageW(
                    tid,
                    WM_QUIT,
                    windows::Win32::Foundation::WPARAM(0),
                    windows::Win32::Foundation::LPARAM(0),
                );
            }
        }
    }
    for _ in 0..40 {
        if THREAD_ID.load(Ordering::SeqCst) == 0 {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    // 等切换 worker 退出。它可能正卡在一次 do_switch 里（HID 重试 + HTTP 3s 超时），
    // 最多等 3s；等不到就放弃 join——宿主已把 DLL 移入退休区，不会 unmap，
    // 迟到的 host_log 也会被宿主的 ABI 注册表拦掉，不会再崩。
    for _ in 0..300 {
        if !WORKER_ALIVE.load(Ordering::SeqCst) {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    if WORKER_ALIVE.load(Ordering::SeqCst) {
        // 还活着：detach，不 join（join 会无限阻塞宿主卸载）
        if let Ok(mut g) = WORKER.lock() {
            if let Some(h) = g.take() {
                drop(h);
            }
        }
    } else if let Ok(mut g) = WORKER.lock() {
        if let Some(h) = g.take() {
            let _ = h.join();
        }
    }
    RUNNING.store(false, Ordering::SeqCst);
}

pub fn stop() {
    if let Ok(_g) = LOCK.lock() {
        stop_locked();
    }
}

pub fn is_running() -> bool {
    RUNNING.load(Ordering::SeqCst)
}

// --- 切换 worker 生命周期（供 lib.rs 的 setup_hotkey 使用） ---

pub fn mark_worker_alive() {
    WORKER_ALIVE.store(true, Ordering::SeqCst);
}

pub fn mark_worker_dead() {
    WORKER_ALIVE.store(false, Ordering::SeqCst);
}

pub fn store_worker(handle: thread::JoinHandle<()>) {
    if let Ok(mut g) = WORKER.lock() {
        if let Some(old) = g.replace(handle) {
            // 旧 worker 已在 recv 上返回 Err 并自行退出，join 不会久等
            let _ = old.join();
        }
    }
}

/// 等待旧 worker 退出（最多 3 秒）。重新注册热键时调用，避免两个 worker 抢设备。
pub fn wait_worker_exit() {
    for _ in 0..300 {
        if !WORKER_ALIVE.load(Ordering::SeqCst) {
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

// ---------------------------------------------------------------- 解析

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
        "backslash" | "\\\\" => 0xDC,
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

    /// 防抖必须跨通道共享：四通道同时命中只允许触发一次。
    #[test]
    fn debounce_shared_across_channels() {
        LAST_FIRE_MS.store(0, Ordering::SeqCst);
        reset_stats();
        let (tx, rx) = std::sync::mpsc::channel();
        *SENDER.lock().unwrap() = Some(tx);

        assert!(fire_channel(1), "钩子通道首次应触发");
        assert!(!fire_channel(2), "300ms 内系统热键通道必须被吞");
        assert!(!fire_channel(3), "300ms 内 Raw Input 通道必须被吞");
        assert!(!fire_channel(4), "300ms 内轮询通道必须被吞");

        assert!(rx.try_recv().is_ok(), "只应投递一次");
        assert!(rx.try_recv().is_err(), "不应有第二次投递");

        // 四条通道都记录了命中，但只有一条真正生效
        let (h1, h2, h3, h4) = channel_stats();
        assert_eq!((h1, h2, h3, h4), (1, 1, 1, 1), "命中计数应各自累加");
        assert_eq!(last_channel_name(), "低级钩子", "生效通道应是第一个命中的");

        *SENDER.lock().unwrap() = None;
        reset_stats();
    }

    /// 通道统计接口存在且初值合理（设置页会读它做诊断）。
    #[test]
    fn channel_stats_start_at_zero_after_reset() {
        reset_stats();
        assert_eq!(channel_stats(), (0, 0, 0, 0));
        assert_eq!(last_channel_name(), "无");
    }
}
