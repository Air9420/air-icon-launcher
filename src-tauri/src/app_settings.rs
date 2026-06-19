use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// 显示逻辑模式
/// 0 = Tauri API (window.show + window.set_focus)
/// 1 = Win32 API (SetForegroundWindow + AttachThreadInput)
pub static SHOW_MODE: AtomicU8 = AtomicU8::new(1);

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FollowMouseYAnchor {
    Top,
    Center,
    Bottom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub toggle_shortcut: String,
    pub clipboard_shortcut: String,
    pub display_shortcut: String,
    pub icc_shortcut: String,
    pub follow_mouse_on_show: bool,
    pub follow_mouse_y_anchor: FollowMouseYAnchor,
}

pub struct AppSettingsState {
    pub(crate) inner: Mutex<AppSettings>,
}

impl Default for AppSettingsState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(AppSettings {
                toggle_shortcut: "alt+space".to_string(),
                clipboard_shortcut: "alt+v".to_string(),
                display_shortcut: String::new(),
                icc_shortcut: "alt+i".to_string(),
                follow_mouse_on_show: false,
                follow_mouse_y_anchor: FollowMouseYAnchor::Center,
            }),
        }
    }
}

impl AppSettingsState {
    pub fn from_config(config: &crate::config::AppConfig) -> Self {
        let anchor = match config.follow_mouse_y_anchor.as_str() {
            "top" => FollowMouseYAnchor::Top,
            "bottom" => FollowMouseYAnchor::Bottom,
            _ => FollowMouseYAnchor::Center,
        };
        Self {
            inner: Mutex::new(AppSettings {
                toggle_shortcut: config.toggle_shortcut.clone(),
                clipboard_shortcut: config.clipboard_shortcut.clone(),
                display_shortcut: config.display_shortcut.clone(),
                icc_shortcut: config.icc_shortcut.clone(),
                follow_mouse_on_show: config.follow_mouse_on_show,
                follow_mouse_y_anchor: anchor,
            }),
        }
    }
}

pub fn show_main_window(app: &AppHandle, follow_mouse_on_show: bool, anchor: FollowMouseYAnchor) {
    let mode = SHOW_MODE.load(Ordering::Relaxed);
    println!("[show_main_window] enter, mode={}", mode);
    let Some(window) = app.get_webview_window("main") else {
        println!("[show_main_window] window not found");
        return;
    };

    if follow_mouse_on_show {
        if let Some((x, y)) = cursor_position() {
            let size = window.outer_size().ok();
            let width = size
                .as_ref()
                .map(|s| s.width as i32)
                .filter(|w| *w > 0)
                .unwrap_or(450);
            let height = size
                .as_ref()
                .map(|s| s.height as i32)
                .filter(|h| *h > 0)
                .unwrap_or(700);

            let monitor = window
                .monitor_from_point(x as f64, y as f64)
                .ok()
                .flatten()
                .or_else(|| window.current_monitor().ok().flatten())
                .or_else(|| window.primary_monitor().ok().flatten());

            let desired_left = x - (width / 2);
            let desired_top = match anchor {
                FollowMouseYAnchor::Top => y,
                FollowMouseYAnchor::Center => y - (height / 2),
                FollowMouseYAnchor::Bottom => y - height,
            };

            let (left, top) = if let Some(monitor) = monitor {
                let work_area = *monitor.work_area();
                let min_x = work_area.position.x;
                let min_y = work_area.position.y;
                let max_x = min_x + (work_area.size.width as i32) - width;
                let max_y = min_y + (work_area.size.height as i32) - height;

                let left = if max_x >= min_x {
                    desired_left.clamp(min_x, max_x)
                } else {
                    desired_left
                };
                let top = if max_y >= min_y {
                    desired_top.clamp(min_y, max_y)
                } else {
                    desired_top
                };
                (left, top)
            } else {
                (desired_left, desired_top)
            };

            let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
                left, top,
            )));
        }
    }

    match mode {
        // 模式0: Tauri API (原始实现)
        0 => {
            println!("[show_main_window] mode=0: using Tauri API");
            let show_result = window.show();
            let focus_result = window.set_focus();
            println!("[show_main_window] show={:?}, focus={:?}", show_result, focus_result);
        }
        // 模式1: Win32 API (从 corner_hotspot 移植)
        1 => {
            println!("[show_main_window] mode=1: using Win32 API");
            show_with_win32_api(&window);
        }
        _ => {
            println!("[show_main_window] unknown mode={}, fallback to mode=0", mode);
            let show_result = window.show();
            let focus_result = window.set_focus();
            println!("[show_main_window] show={:?}, focus={:?}", show_result, focus_result);
        }
    }
}

#[cfg(windows)]
fn show_with_win32_api(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::Input::KeyboardAndMouse::{SetActiveWindow, SetFocus};
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, SetForegroundWindow, SetWindowPos, ShowWindow, HWND_NOTOPMOST,
        HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_RESTORE,
    };

    let _ = window.show();

    if let Ok(hwnd) = window.hwnd() {
        let raw = HWND(hwnd.0 as isize);
        unsafe {
            let _ = ShowWindow(raw, SW_RESTORE);

            let foreground = GetForegroundWindow();
            let foreground_tid = GetWindowThreadProcessId(foreground, None);
            let current_tid = GetCurrentThreadId();
            println!("[show_with_win32_api] foreground_tid={}, current_tid={}", foreground_tid, current_tid);

            if foreground_tid != current_tid && foreground_tid != 0 {
                println!("[show_with_win32_api] using AttachThreadInput");
                let _ = AttachThreadInput(foreground_tid, current_tid, true);
                let _ = SetForegroundWindow(raw);
                let _ = SetActiveWindow(raw);
                let _ = SetFocus(raw);
                let _ = AttachThreadInput(foreground_tid, current_tid, false);
            } else {
                println!("[show_with_win32_api] using SetForegroundWindow directly");
                let _ = SetForegroundWindow(raw);
                let _ = SetActiveWindow(raw);
                let _ = SetFocus(raw);
            }

            let _ = SetWindowPos(
                raw,
                HWND_TOPMOST,
                0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            );
            let _ = SetWindowPos(
                raw,
                HWND_NOTOPMOST,
                0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            );
        }
        println!("[show_with_win32_api] done");
    } else {
        println!("[show_with_win32_api] hwnd failed, using set_focus");
        let _ = window.set_focus();
    }
}

#[cfg(not(windows))]
fn show_with_win32_api(window: &tauri::WebviewWindow) {
    println!("[show_with_win32_api] non-windows, using Tauri API");
    let _ = window.show();
    let _ = window.set_focus();
}

/// 切换显示模式
#[tauri::command]
pub fn set_show_mode(mode: u8) -> AppResult<()> {
    let mode = mode.min(1);
    println!("[set_show_mode] mode={}", mode);
    SHOW_MODE.store(mode, Ordering::Relaxed);
    Ok(())
}

/// 获取当前显示模式
#[tauri::command]
pub fn get_show_mode() -> u8 {
    SHOW_MODE.load(Ordering::Relaxed)
}

/// 统一的显示入口
#[tauri::command]
pub fn show_launcher(
    app: AppHandle,
    state: tauri::State<'_, AppSettingsState>,
    force_no_follow: Option<bool>,
) -> AppResult<()> {
    let (follow, anchor) = state
        .inner
        .lock()
        .map(|g| (g.follow_mouse_on_show, g.follow_mouse_y_anchor))
        .map_err(|_| AppError::internal("Failed to lock app settings state"))?;

    let effective_follow = if force_no_follow.unwrap_or(false) { false } else { follow };
    println!("[show_launcher] enter, follow={}, effective_follow={}, force_no_follow={:?}", follow, effective_follow, force_no_follow);
    show_main_window(&app, effective_follow, anchor);
    Ok(())
}

/// 切换主窗口显示：已可见且已聚焦则隐藏；已可见但未聚焦则前置并聚焦；不可见则显示并聚焦。
#[allow(dead_code)]
pub fn toggle_main_window(app: &AppHandle, follow_mouse_on_show: bool, anchor: FollowMouseYAnchor) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let visible = window.is_visible().unwrap_or(true);
    let focused = window.is_focused().unwrap_or(true);
    println!("[toggle_main_window] visible={}, focused={}", visible, focused);
    if visible {
        if focused {
            let _ = window.hide();
            println!("[toggle_main_window] hiding window");
        } else {
            show_main_window(app, follow_mouse_on_show, anchor);
        }
    } else {
        show_main_window(app, follow_mouse_on_show, anchor);
    }
}

#[cfg(windows)]
fn cursor_position() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut p = POINT::default();
    if unsafe { GetCursorPos(&mut p) }.is_ok() {
        Some((p.x, p.y))
    } else {
        None
    }
}

#[cfg(not(windows))]
fn cursor_position() -> Option<(i32, i32)> {
    None
}

#[tauri::command]
pub fn set_follow_mouse_on_show(
    state: tauri::State<'_, AppSettingsState>,
    enabled: bool,
) -> AppResult<()> {
    {
        let mut g = state
            .inner
            .lock()
            .map_err(|_| AppError::internal("Failed to lock app settings state"))?;
        g.follow_mouse_on_show = enabled;
    }
    Ok(())
}

#[tauri::command]
pub fn set_follow_mouse_y_anchor(
    state: tauri::State<'_, AppSettingsState>,
    anchor: FollowMouseYAnchor,
) -> AppResult<()> {
    let mut g = state
        .inner
        .lock()
        .map_err(|_| AppError::internal("Failed to lock app settings state"))?;
    g.follow_mouse_y_anchor = anchor;
    Ok(())
}

pub fn register_toggle_shortcut(app: &AppHandle, shortcut: &str) -> AppResult<()> {
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    let shortcut = Shortcut::from_str(shortcut)
        .map_err(|e| AppError::invalid_input(format!("Invalid toggle shortcut: {}", e)))?;

    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            use tauri_plugin_global_shortcut::ShortcutState;
            if event.state == ShortcutState::Pressed {
                println!("[global_shortcut] toggle shortcut pressed");
                if crate::corner_hotspot::is_fullscreen_app_running() {
                    println!("[global_shortcut] fullscreen app running, skipping");
                    return;
                }
                if let Some(window) = app.get_webview_window("main") {
                    println!("[global_shortcut] emitting toggle-main");
                    let _ = window.emit("toggle-main", ());
                }
            }
        })
        .map_err(|e| AppError::internal(e.to_string()))?;

    Ok(())
}

pub fn register_clipboard_shortcut(app: &AppHandle, shortcut: &str) -> AppResult<()> {
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    let shortcut = Shortcut::from_str(shortcut)
        .map_err(|e| AppError::invalid_input(format!("Invalid clipboard shortcut: {}", e)))?;

    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            use tauri_plugin_global_shortcut::ShortcutState;
            if event.state == ShortcutState::Pressed {
                if crate::corner_hotspot::is_fullscreen_app_running() {
                    return;
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("toggle-clipboard", ());
                }
            }
        })
        .map_err(|e| AppError::internal(e.to_string()))?;

    Ok(())
}

#[tauri::command]
pub fn set_toggle_shortcut(
    app: AppHandle,
    state: tauri::State<'_, AppSettingsState>,
    shortcut: String,
) -> AppResult<()> {
    let shortcut = shortcut.trim().to_string();
    if shortcut.is_empty() {
        return Err(AppError::invalid_input("Shortcut cannot be empty"));
    }

    let old = state
        .inner
        .lock()
        .map(|g| g.toggle_shortcut.clone())
        .map_err(|_| AppError::internal("Failed to lock app settings state"))?;

    if old == shortcut {
        return Ok(());
    }

    register_toggle_shortcut(&app, shortcut.as_str())?;

    if !old.is_empty() {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        let _ = app.global_shortcut().unregister(old.as_str());
    }

    if let Some(config) = crate::keyboard_hook::parse_hotkey(shortcut.as_str()) {
        crate::keyboard_hook::register_hotkey(config);
        crate::keyboard_hook::enable_hook(true);
    }

    {
        let mut g = state
            .inner
            .lock()
            .map_err(|_| AppError::internal("Failed to lock app settings state"))?;
        g.toggle_shortcut = shortcut;
    }

    Ok(())
}

#[tauri::command]
pub fn suspend_toggle_shortcut(
    app: AppHandle,
    state: tauri::State<'_, AppSettingsState>,
) -> AppResult<String> {
    let shortcut = state
        .inner
        .lock()
        .map(|g| g.toggle_shortcut.clone())
        .map_err(|_| AppError::internal("Failed to lock app settings state"))?;

    if shortcut.is_empty() {
        return Ok(shortcut);
    }

    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let _ = app.global_shortcut().unregister(shortcut.as_str());
    Ok(shortcut)
}

#[tauri::command]
pub fn resume_toggle_shortcut(app: AppHandle, shortcut: String) -> AppResult<()> {
    let shortcut = shortcut.trim();
    if shortcut.is_empty() {
        return Ok(());
    }

    register_toggle_shortcut(&app, shortcut)
}

#[tauri::command]
pub fn set_clipboard_shortcut(
    app: AppHandle,
    state: tauri::State<'_, AppSettingsState>,
    shortcut: String,
) -> AppResult<()> {
    let shortcut = shortcut.trim().to_string();
    if shortcut.is_empty() {
        return Err(AppError::invalid_input("Shortcut cannot be empty"));
    }

    let old = state
        .inner
        .lock()
        .map(|g| g.clipboard_shortcut.clone())
        .map_err(|_| AppError::internal("Failed to lock app settings state"))?;

    if old == shortcut {
        return Ok(());
    }

    let toggle_shortcut = state
        .inner
        .lock()
        .map(|g| g.toggle_shortcut.clone())
        .map_err(|_| AppError::internal("Failed to lock app settings state"))?;

    if shortcut == toggle_shortcut {
        return Err(AppError::invalid_input(
            "Clipboard shortcut cannot be the same as toggle shortcut",
        ));
    }

    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    register_clipboard_shortcut(&app, shortcut.as_str())?;

    if !old.is_empty() {
        let _ = app.global_shortcut().unregister(old.as_str());
    }

    {
        let mut g = state
            .inner
            .lock()
            .map_err(|_| AppError::internal("Failed to lock app settings state"))?;
        g.clipboard_shortcut = shortcut;
    }

    Ok(())
}

#[tauri::command]
pub fn show_window_with_follow_mouse(
    app: AppHandle,
    state: tauri::State<'_, AppSettingsState>,
) -> AppResult<()> {
    println!("[show_window_with_follow_mouse] enter");
    let (follow, anchor) = state
        .inner
        .lock()
        .map(|g| (g.follow_mouse_on_show, g.follow_mouse_y_anchor))
        .map_err(|_| AppError::internal("Failed to lock app settings state"))?;

    show_main_window(&app, follow, anchor);
    Ok(())
}

pub fn register_display_shortcut(app: &AppHandle, shortcut: &str) -> AppResult<()> {
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    let shortcut = Shortcut::from_str(shortcut)
        .map_err(|e| AppError::invalid_input(format!("Invalid display shortcut: {}", e)))?;

    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            use tauri_plugin_global_shortcut::ShortcutState;
            if event.state == ShortcutState::Pressed {
                match crate::display::get_display_count_internal() {
                    Ok(count) if count < 2 => {
                        let _ = app.emit("display-no-external-monitor", ());
                    }
                    _ => {
                        if let Err(err) = crate::display::toggle_display_mode() {
                            eprintln!("[display] Failed to toggle display mode: {}", err.message);
                        }
                    }
                }
            }
        })
        .map_err(|e| AppError::internal(e.to_string()))?;

    Ok(())
}

#[tauri::command]
pub fn set_display_shortcut(
    app: AppHandle,
    state: tauri::State<'_, AppSettingsState>,
    shortcut: String,
) -> AppResult<()> {
    let shortcut = shortcut.trim().to_string();

    let old = state
        .inner
        .lock()
        .map(|g| g.display_shortcut.clone())
        .map_err(|_| AppError::internal("Failed to lock app settings state"))?;

    if old == shortcut {
        return Ok(());
    }

    if !shortcut.is_empty() {
        register_display_shortcut(&app, shortcut.as_str())?;
    }

    if !old.is_empty() {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        let _ = app.global_shortcut().unregister(old.as_str());
    }

    {
        let mut g = state
            .inner
            .lock()
            .map_err(|_| AppError::internal("Failed to lock app settings state"))?;
        g.display_shortcut = shortcut;
    }

    Ok(())
}

#[tauri::command]
pub fn suspend_display_shortcut(
    app: AppHandle,
    state: tauri::State<'_, AppSettingsState>,
) -> AppResult<String> {
    let shortcut = state
        .inner
        .lock()
        .map(|g| g.display_shortcut.clone())
        .map_err(|_| AppError::internal("Failed to lock app settings state"))?;

    if shortcut.is_empty() {
        return Ok(shortcut);
    }

    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let _ = app.global_shortcut().unregister(shortcut.as_str());
    Ok(shortcut)
}

#[tauri::command]
pub fn resume_display_shortcut(app: AppHandle, shortcut: String) -> AppResult<()> {
    let shortcut = shortcut.trim();
    if shortcut.is_empty() {
        return Ok(());
    }

    register_display_shortcut(&app, shortcut)
}

pub fn register_icc_shortcut(app: &AppHandle, shortcut: &str) -> AppResult<()> {
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    let shortcut = Shortcut::from_str(shortcut)
        .map_err(|e| AppError::invalid_input(format!("Invalid ICC shortcut: {}", e)))?;

    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            use tauri_plugin_global_shortcut::ShortcutState;
            if event.state == ShortcutState::Pressed {
                if crate::corner_hotspot::is_fullscreen_app_running() {
                    println!("[global_shortcut] ICC shortcut: fullscreen app running, skipping");
                    return;
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("navigate-to-icc-settings", ());
                }
            }
        })
        .map_err(|e| AppError::internal(e.to_string()))?;

    Ok(())
}

#[tauri::command]
pub fn set_icc_shortcut(
    app: AppHandle,
    state: tauri::State<'_, AppSettingsState>,
    shortcut: String,
) -> AppResult<()> {
    let shortcut = shortcut.trim().to_string();
    if shortcut.is_empty() {
        return Err(AppError::invalid_input("Shortcut cannot be empty"));
    }

    let old = state
        .inner
        .lock()
        .map(|g| g.icc_shortcut.clone())
        .map_err(|_| AppError::internal("Failed to lock app settings state"))?;

    if old == shortcut {
        return Ok(());
    }

    if !shortcut.is_empty() {
        register_icc_shortcut(&app, shortcut.as_str())?;
    }

    if !old.is_empty() {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        let _ = app.global_shortcut().unregister(old.as_str());
    }

    {
        let mut g = state
            .inner
            .lock()
            .map_err(|_| AppError::internal("Failed to lock app settings state"))?;
        g.icc_shortcut = shortcut;
    }

    Ok(())
}
