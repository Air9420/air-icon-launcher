use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

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
                follow_mouse_on_show: false,
                follow_mouse_y_anchor: FollowMouseYAnchor::Center,
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

pub fn toggle_main_window(app: &AppHandle, follow_mouse_on_show: bool, anchor: FollowMouseYAnchor) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let visible = window.is_visible().unwrap_or(true);
    if visible {
        let _ = window.hide();
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
pub fn get_app_settings(state: tauri::State<'_, AppSettingsState>) -> Result<AppSettings, String> {
    state
        .inner
        .lock()
        .map(|g| g.clone())
        .map_err(|_| "无法获取设置状态".to_string())
}

#[tauri::command]
pub fn set_follow_mouse_on_show(
    state: tauri::State<'_, AppSettingsState>,
    enabled: bool,
) -> Result<(), String> {
    {
        let mut g = state
            .inner
            .lock()
            .map_err(|_| "无法获取设置状态".to_string())?;
        g.follow_mouse_on_show = enabled;
    }
    Ok(())
}

#[tauri::command]
pub fn set_follow_mouse_y_anchor(
    state: tauri::State<'_, AppSettingsState>,
    anchor: FollowMouseYAnchor,
) -> Result<(), String> {
    let mut g = state
        .inner
        .lock()
        .map_err(|_| "无法获取设置状态".to_string())?;
    g.follow_mouse_y_anchor = anchor;
    Ok(())
}

#[tauri::command]
pub fn set_toggle_shortcut(
    app: AppHandle,
    state: tauri::State<'_, AppSettingsState>,
    shortcut: String,
) -> Result<(), String> {
    let shortcut = shortcut.trim().to_string();
    if shortcut.is_empty() {
        return Err("快捷键不能为空".to_string());
    }

    let old = state
        .inner
        .lock()
        .map(|g| g.toggle_shortcut.clone())
        .map_err(|_| "无法获取设置状态".to_string())?;

    if old == shortcut {
        return Ok(());
    }

    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    app.global_shortcut()
        .on_shortcut(shortcut.as_str(), move |app, _shortcut, event| {
            use tauri_plugin_global_shortcut::ShortcutState;
            if event.state == ShortcutState::Pressed {
                let (follow, anchor) = app
                    .state::<AppSettingsState>()
                    .inner
                    .lock()
                    .map(|g| (g.follow_mouse_on_show, g.follow_mouse_y_anchor))
                    .unwrap_or((false, FollowMouseYAnchor::Center));
                toggle_main_window(app, follow, anchor);
            }
        })
        .map_err(|e| e.to_string())?;

    if !old.is_empty() {
        let _ = app.global_shortcut().unregister(old.as_str());
    }

    {
        let mut g = state
            .inner
            .lock()
            .map_err(|_| "无法获取设置状态".to_string())?;
        g.toggle_shortcut = shortcut;
    }

    Ok(())
}
