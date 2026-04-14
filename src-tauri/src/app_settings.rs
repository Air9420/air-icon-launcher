use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use crate::error::{AppError, AppResult};

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
                follow_mouse_on_show: config.follow_mouse_on_show,
                follow_mouse_y_anchor: anchor,
            }),
        }
    }
}

pub fn show_main_window(app: &AppHandle, follow_mouse_on_show: bool, anchor: FollowMouseYAnchor) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if follow_mouse_on_show {
        if let (Ok(size), Some((x, y))) = (window.outer_size(), cursor_position()) {
            let monitor = window
                .monitor_from_point(x as f64, y as f64)
                .ok()
                .flatten()
                .or_else(|| window.current_monitor().ok().flatten())
                .or_else(|| window.primary_monitor().ok().flatten());

            let work_area = monitor.map(|m| *m.work_area()).unwrap_or_default();

            let desired_left = x - (size.width as i32 / 2);
            let desired_top = match anchor {
                FollowMouseYAnchor::Top => y,
                FollowMouseYAnchor::Center => y - (size.height as i32 / 2),
                FollowMouseYAnchor::Bottom => y - (size.height as i32),
            };

            let min_x = work_area.position.x;
            let min_y = work_area.position.y;
            let max_x = min_x + (work_area.size.width as i32) - (size.width as i32);
            let max_y = min_y + (work_area.size.height as i32) - (size.height as i32);

            let left = if max_x >= min_x {
                desired_left.clamp(min_x, max_x)
            } else {
                min_x
            };
            let top = if max_y >= min_y {
                desired_top.clamp(min_y, max_y)
            } else {
                min_y
            };

            let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(left, top)));
        }
    }

    let _ = window.show();
    let _ = window.set_focus();
}

/// 切换主窗口显示：已可见且已聚焦则隐藏；已可见但未聚焦则前置并聚焦；不可见则显示并聚焦。
#[allow(dead_code)]
pub fn toggle_main_window(app: &AppHandle, follow_mouse_on_show: bool, anchor: FollowMouseYAnchor) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let visible = window.is_visible().unwrap_or(true);
    if visible {
        let focused = window.is_focused().unwrap_or(true);
        if focused {
            let _ = window.hide();
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
pub fn get_app_settings(state: tauri::State<'_, AppSettingsState>) -> AppResult<AppSettings> {
    state
        .inner
        .lock()
        .map(|g| g.clone())
        .map_err(|_| AppError::internal("Failed to lock app settings state"))
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
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            use tauri_plugin_global_shortcut::ShortcutState;
            if event.state == ShortcutState::Pressed {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("toggle-main", ());
                }
            }
        })
        .map_err(|e| AppError::internal(e.to_string()))?;

    Ok(())
}

pub fn register_clipboard_shortcut(app: &AppHandle, shortcut: &str) -> AppResult<()> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            use tauri_plugin_global_shortcut::ShortcutState;
            if event.state == ShortcutState::Pressed {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("toggle-clipboard", ());
                    let (follow, anchor) = app
                        .state::<AppSettingsState>()
                        .inner
                        .lock()
                        .map(|g| (g.follow_mouse_on_show, g.follow_mouse_y_anchor))
                        .unwrap_or((false, FollowMouseYAnchor::Center));
                    show_main_window(app, follow, anchor);
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
        return Err(AppError::invalid_input("Clipboard shortcut cannot be the same as toggle shortcut"));
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
    let (follow, anchor) = state
        .inner
        .lock()
        .map(|g| (g.follow_mouse_on_show, g.follow_mouse_y_anchor))
        .map_err(|_| AppError::internal("Failed to lock app settings state"))?;

    show_main_window(&app, follow, anchor);
    Ok(())
}
