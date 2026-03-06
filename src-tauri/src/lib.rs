mod tray;
mod drag;
mod app_settings;
mod autostart_service;
mod clipboard;
mod plugins;
mod config_manager;
use tauri::tray::TrayIcon;
use tauri::{Emitter, Manager};

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
    let clipboard_state = std::sync::Arc::new(clipboard::ClipboardState::default());
    tauri::Builder::default()
        .manage(drag::DragDropState::default())
        .manage(app_settings::AppSettingsState::default())
        .manage(clipboard_state.clone())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let handle = app.handle();
            let _tray = tray::create_tray(&handle);
            app.manage(TrayState { _tray });
            drag::setup_drag_drop(&handle);
            clipboard::start_clipboard_monitor(handle.clone(), clipboard_state);
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
                let _ = handle.global_shortcut().on_shortcut("alt+v", |app, _s, e| {
                    if e.state == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("open-clipboard", ());
                        }
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
            app_settings::set_clipboard_shortcut,
            autostart_service::get_autostart_service_status,
            autostart_service::set_autostart_service_enabled,
            clipboard::get_clipboard_content,
            clipboard::set_clipboard_content,
            clipboard::get_clipboard_history,
            clipboard::clear_clipboard_history,
            clipboard::delete_clipboard_record,
            clipboard::get_clipboard_config,
            clipboard::set_clipboard_config,
            clipboard::set_clipboard_storage_path,
            clipboard::get_clipboard_storage_path,
            clipboard::reset_clipboard_storage_path,
            plugins::get_plugin_directory,
            plugins::get_plugin_path,
            plugins::scan_plugins,
            plugins::read_plugin_manifest,
            plugins::read_plugin_file,
            plugins::install_plugin,
            plugins::uninstall_plugin,
            plugins::launch_item,
            config_manager::get_config,
            config_manager::save_config,
            config_manager::get_launcher_data,
            config_manager::save_launcher_data,
            config_manager::create_backup,
            config_manager::list_backups,
            config_manager::restore_backup,
            config_manager::delete_backup,
            config_manager::export_data,
            config_manager::import_data,
            config_manager::export_to_file,
            config_manager::export_data_to_file,
            config_manager::import_from_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
