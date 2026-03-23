mod tray;
mod drag;
mod app_settings;
mod autostart_service;
mod clipboard;
mod plugins;
mod config_manager;
mod window_effects;
mod corner_hotspot;
mod error;
use tauri::tray::TrayIcon;
use tauri::Manager;


struct TrayState {
    tray: TrayIcon,
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
            app.manage(TrayState { tray: _tray });
            drag::setup_drag_drop(&handle);
            
            let config_manager = config_manager::ConfigManager::new(&handle);
            app.manage(config_manager.clone());
            let app_config = config_manager.load_config();
            
            let clipboard_state = app.state::<std::sync::Arc<clipboard::ClipboardState>>();
            {
                let mut config = clipboard_state.config.lock().unwrap();
                config.max_records = app_config.clipboard_max_records;
                config.max_image_size_mb = app_config.clipboard_max_image_size_mb;
                config.encrypted = app_config.clipboard_encrypted;
                config.storage_path = app_config.clipboard_storage_path.clone();
            }
            {
                let mut storage_path = clipboard_state.storage_path.lock().unwrap();
                if let Some(path) = &app_config.clipboard_storage_path {
                    *storage_path = std::path::PathBuf::from(path);
                } else {
                    *storage_path = clipboard::get_default_storage_path(&handle);
                }
            }
            
            clipboard::start_clipboard_monitor(handle.clone(), clipboard_state.inner().clone());
            if autostart_service::is_autostart_launch() {
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            {
                let (toggle, clipboard) = handle
                    .state::<app_settings::AppSettingsState>()
                    .inner
                    .lock()
                    .map(|g| (g.toggle_shortcut.clone(), g.clipboard_shortcut.clone()))
                    .unwrap_or(("alt+space".to_string(), "alt+v".to_string()));

                let _ = app_settings::register_toggle_shortcut(&handle, toggle.as_str());
                let _ = app_settings::register_clipboard_shortcut(&handle, clipboard.as_str());
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            drag::report_drop_target,
            drag::get_last_drop,
            drag::extract_icons_from_paths,
            app_settings::get_app_settings,
            app_settings::set_follow_mouse_on_show,
            app_settings::set_follow_mouse_y_anchor,
            app_settings::set_toggle_shortcut,
            app_settings::suspend_toggle_shortcut,
            app_settings::resume_toggle_shortcut,
            app_settings::set_clipboard_shortcut,
            app_settings::show_window_with_follow_mouse,
            autostart_service::get_autostart_service_status,
            autostart_service::set_autostart_service_enabled,
            autostart_service::get_autostart_status,
            autostart_service::set_autostart,
            autostart_service::simulate_autostart_launch,
            autostart_service::check_is_autostart_launch,
            clipboard::get_clipboard_content,
            clipboard::set_clipboard_content,
            clipboard::get_clipboard_history,
            clipboard::clear_clipboard_history,
            clipboard::delete_clipboard_record,
            clipboard::get_clipboard_config,
            clipboard::get_clipboard_config_debug,
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
            config_manager::get_config_paths,
            config_manager::read_raw_config_json,
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
            window_effects::set_window_effects,
            window_effects::restart_app,
            window_effects::is_window_effects_supported,
            corner_hotspot::set_corner_hotspot_config,
            corner_hotspot::get_corner_hotspot_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
