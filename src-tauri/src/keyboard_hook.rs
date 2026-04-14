use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::time::Instant;
use std::sync::OnceLock;
use tauri::Emitter;

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW,
    DispatchMessageW, TranslateMessage, MSG, SetWindowsHookExW, UnhookWindowsHookEx,
    WH_KEYBOARD_LL, KBDLLHOOKSTRUCT, WM_KEYDOWN, WM_SYSKEYDOWN,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::LibraryLoader::GetModuleHandleW;

static HOOK_HANDLE: AtomicU64 = AtomicU64::new(0);
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

static REGISTERED_VK: AtomicU32 = AtomicU32::new(0);
static REGISTERED_MODS: AtomicU8 = AtomicU8::new(0);
static LAST_TRIGGER_TIME: AtomicU64 = AtomicU64::new(0);

static HOOK_ENABLED: AtomicBool = AtomicBool::new(false);

const MOD_CTRL: u8 = 1 << 0;
const MOD_SHIFT: u8 = 1 << 1;
const MOD_ALT: u8 = 1 << 2;
const MOD_WIN: u8 = 1 << 3;

#[derive(Clone, Copy)]
pub struct HotkeyConfig {
    pub vk: u32,
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
    pub win: bool,
}

impl HotkeyConfig {
    pub fn matches(&self, vk: u32, ctrl: bool, shift: bool, alt: bool, win: bool) -> bool {
        self.vk == vk && self.ctrl == ctrl && self.shift == shift && self.alt == alt && self.win == win
    }
}

pub fn set_app_handle(handle: tauri::AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

pub fn register_hotkey(config: HotkeyConfig) {
    REGISTERED_VK.store(config.vk, Ordering::Relaxed);
    let mut mods: u8 = 0;
    if config.ctrl { mods |= MOD_CTRL; }
    if config.shift { mods |= MOD_SHIFT; }
    if config.alt { mods |= MOD_ALT; }
    if config.win { mods |= MOD_WIN; }
    REGISTERED_MODS.store(mods, Ordering::Relaxed);
}

pub fn unregister_hotkey() {
    REGISTERED_VK.store(0, Ordering::Relaxed);
    REGISTERED_MODS.store(0, Ordering::Relaxed);
}

pub fn enable_hook(enabled: bool) {
    HOOK_ENABLED.store(enabled, Ordering::Relaxed);
}

pub fn is_hook_enabled() -> bool {
    HOOK_ENABLED.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn set_strong_shortcut_mode(enabled: bool) {
    HOOK_ENABLED.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
pub fn get_strong_shortcut_mode() -> bool {
    HOOK_ENABLED.load(Ordering::Relaxed)
}

fn should_trigger() -> bool {
    let now = Instant::now().elapsed().as_millis() as u64;
    let last = LAST_TRIGGER_TIME.load(Ordering::Relaxed);
    if now.saturating_sub(last) < 200 {
        return false;
    }
    LAST_TRIGGER_TIME.store(now, Ordering::Relaxed);
    true
}

#[cfg(target_os = "windows")]
fn should_block_input() -> bool {
    true
}

#[cfg(target_os = "windows")]
unsafe fn get_modifier_state() -> (bool, bool, bool, bool) {
    let ctrl = GetAsyncKeyState(VK_CONTROL.0 as i32) as u16 & 0x8000 != 0;
    let shift = GetAsyncKeyState(VK_SHIFT.0 as i32) as u16 & 0x8000 != 0;
    let alt = GetAsyncKeyState(VK_MENU.0 as i32) as u16 & 0x8000 != 0;
    let win = GetAsyncKeyState(VK_LWIN.0 as i32) as u16 & 0x8000 != 0
           || GetAsyncKeyState(VK_RWIN.0 as i32) as u16 & 0x8000 != 0;
    (ctrl, shift, alt, win)
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn keyboard_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
    if n_code < 0 {
        return CallNextHookEx(None, n_code, w_param, l_param);
    }

    let msg = w_param.0 as u32;
    if msg != WM_KEYDOWN && msg != WM_SYSKEYDOWN {
        return CallNextHookEx(None, n_code, w_param, l_param);
    }

    if !HOOK_ENABLED.load(Ordering::Relaxed) {
        return CallNextHookEx(None, n_code, w_param, l_param);
    }

    let kbd = *(l_param.0 as *const KBDLLHOOKSTRUCT);
    let vk = kbd.vkCode;

    let (ctrl, shift, alt, win) = get_modifier_state();

    let registered_vk = REGISTERED_VK.load(Ordering::Relaxed);
    let registered_mods = REGISTERED_MODS.load(Ordering::Relaxed);

    if registered_vk != 0 {
        let expect_ctrl = (registered_mods & MOD_CTRL) != 0;
        let expect_shift = (registered_mods & MOD_SHIFT) != 0;
        let expect_alt = (registered_mods & MOD_ALT) != 0;
        let expect_win = (registered_mods & MOD_WIN) != 0;

        if vk == registered_vk && ctrl == expect_ctrl && shift == expect_shift
            && alt == expect_alt && win == expect_win
        {
            if should_trigger() && should_block_input() {
                if let Some(handle) = APP_HANDLE.get() {
                    let _ = handle.emit("toggle-main", ());
                }
            }
        }
    }

    CallNextHookEx(None, n_code, w_param, l_param)
}

#[cfg(target_os = "windows")]
pub fn start_keyboard_hook() -> bool {
    std::thread::spawn(move || {
        unsafe {
            let h_instance = GetModuleHandleW(None)
                .expect("Failed to get module handle");

            let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), h_instance, 0);

            match hook {
                Ok(h) => {
                    HOOK_HANDLE.store(h.0 as u64, Ordering::SeqCst);
                    let mut msg = MSG::default();
                    while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                        let _ = TranslateMessage(&msg);
                        let _ = DispatchMessageW(&msg);
                    }
                    let _ = UnhookWindowsHookEx(h);
                }
                Err(e) => {
                    eprintln!("[keyboard_hook] Failed to set hook: {:?}", e);
                }
            }
        }
    });

    true
}

#[cfg(not(target_os = "windows"))]
pub fn start_keyboard_hook() -> bool {
    false
}

#[cfg(not(target_os = "windows"))]
pub fn set_app_handle(_handle: tauri::AppHandle) {}

#[cfg(not(target_os = "windows"))]
pub fn register_hotkey(_config: HotkeyConfig) {}

#[cfg(not(target_os = "windows"))]
pub fn unregister_hotkey() {}

#[cfg(not(target_os = "windows"))]
pub fn enable_hook(_enabled: bool) {}

#[cfg(not(target_os = "windows"))]
pub fn is_hook_enabled() -> bool {
    false
}

pub fn parse_hotkey(hotkey: &str) -> Option<HotkeyConfig> {
    let parts: Vec<&str> = hotkey.split('+').collect();
    let mut vk: u32 = 0;
    let mut ctrl = false;
    let mut shift = false;
    let mut alt = false;
    let mut win = false;

    for part in parts {
        let part_upper = part.trim().to_uppercase();
        match part_upper.as_str() {
            "CTRL" | "CONTROL" => ctrl = true,
            "SHIFT" => shift = true,
            "ALT" | "MENU" => alt = true,
            "WIN" | "SUPER" | "COMMAND" | "META" => win = true,
            "SPACE" => vk = 0x20,
            "ENTER" | "RETURN" => vk = 0x0D,
            "TAB" => vk = 0x09,
            "ESC" | "ESCAPE" => vk = 0x1B,
            "BACKSPACE" => vk = 0x08,
            "DELETE" => vk = 0x2E,
            "INSERT" => vk = 0x2D,
            "PAGEUP" => vk = 0x21,
            "PAGEDOWN" => vk = 0x22,
            "END" => vk = 0x23,
            "HOME" => vk = 0x24,
            "LEFT" => vk = 0x25,
            "UP" => vk = 0x26,
            "RIGHT" => vk = 0x27,
            "DOWN" => vk = 0x28,
            "PLUS" | "=" => vk = 0xBB,
            "COMMA" | "," => vk = 0xBC,
            "MINUS" | "-" => vk = 0xBD,
            "PERIOD" | "." => vk = 0xBE,
            "/" | "SLASH" => vk = 0xBF,
            "`" | "TILDE" | "GRAVE" => vk = 0xC0,
            ";" | "SEMICOLON" => vk = 0xBA,
            "[" | "LBRACKET" => vk = 0xDB,
            "\\" | "BACKSLASH" => vk = 0xDC,
            "]" | "RBRACKET" => vk = 0xDD,
            "'" | "QUOTE" => vk = 0xDE,
            key if key.starts_with('F') && key.len() > 1 => {
                if let Ok(num) = key[1..].parse::<u32>() {
                    if (1..=24).contains(&num) {
                        vk = 0x6F + num;
                    }
                }
            }
            key => {
                if key.len() == 1 {
                    let ch = key.chars().next().unwrap();
                    if ch.is_ascii_alphabetic() {
                        vk = ch.to_ascii_uppercase() as u32;
                    } else if ch.is_ascii_digit() {
                        vk = ch as u32;
                    }
                }
            }
        }
    }

    if vk != 0 {
        Some(HotkeyConfig { vk, ctrl, shift, alt, win })
    } else {
        None
    }
}
