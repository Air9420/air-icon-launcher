mod tray;
mod drag;
mod app_settings;
mod autostart_service;
use tauri::tray::TrayIcon;
use tauri::Manager;

/// 返回问候语的命令处理函数
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

struct TrayState {
    _tray: TrayIcon,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// 应用入口，初始化系统托盘并启动应用
pub fn run() {
    tauri::Builder::default()
        .manage(drag::DragDropState::default())
        .manage(app_settings::AppSettingsState::default())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let handle = app.handle();
            let _tray = tray::create_tray(&handle);
            app.manage(TrayState { _tray });
            drag::setup_drag_drop(&handle);
            if autostart_service::is_autostart_launch() {
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            {
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
                let _ = handle.global_shortcut().on_shortcut("alt+space", |app, _s, e| {
                    if e.state == ShortcutState::Pressed {
                        let (follow, anchor) = app
                            .state::<app_settings::AppSettingsState>()
                            .inner
                            .lock()
                            .map(|g| (g.follow_mouse_on_show, g.follow_mouse_y_anchor))
                            .unwrap_or((false, app_settings::FollowMouseYAnchor::Center));
                        app_settings::toggle_main_window(app, follow, anchor);
                    }
                });
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            drag::report_drop_target,
            drag::get_last_drop,
            app_settings::get_app_settings,
            app_settings::set_follow_mouse_on_show,
            app_settings::set_follow_mouse_y_anchor,
            app_settings::set_toggle_shortcut,
            autostart_service::get_autostart_service_status,
            autostart_service::set_autostart_service_enabled
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
