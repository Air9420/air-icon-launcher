mod app_settings;
mod autostart_service;
mod clipboard;
mod clipboard_listener;
mod commands;
mod config;
mod corner_hotspot;
mod db;
mod drag;
mod error;
mod keyboard_hook;
mod pinyin;
mod plugins;
mod search;
mod system;
mod tray;
mod window_effects;
use tauri::tray::TrayIcon;
use tauri::Manager;

struct TrayState {
    tray: TrayIcon,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(drag::DragDropState::default())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let handle = app.handle();
            let _tray = tray::create_tray(&handle);
            app.manage(TrayState { tray: _tray });
            drag::setup_drag_drop(&handle);

            let config_manager = config::ConfigManager::new(&handle);
            app.manage(config_manager.clone());
            app.manage(commands::search::SearchState::new());
            let app_config = config_manager.load_config();

            app.manage(app_settings::AppSettingsState::from_config(&app_config));

            let clipboard_state = clipboard::ClipboardState::from_config(&app_config, &handle);
            let clipboard_state = std::sync::Arc::new(clipboard_state);
            app.manage(clipboard_state.clone());

            corner_hotspot::update_corner_hotspot_config(
                &handle,
                app_config.corner_hotspot_enabled,
                &app_config.corner_hotspot_position,
                &app_config.corner_hotspot_sensitivity,
            );

            clipboard::start_clipboard_monitor(handle.clone(), clipboard_state);
            if autostart_service::is_autostart_launch() {
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            {
                let (toggle, clipboard_shortcut) = handle
                    .state::<app_settings::AppSettingsState>()
                    .inner
                    .lock()
                    .map(|g| (g.toggle_shortcut.clone(), g.clipboard_shortcut.clone()))
                    .unwrap_or(("alt+space".to_string(), "alt+v".to_string()));

                let _ = app_settings::register_toggle_shortcut(&handle, toggle.as_str());
                let _ =
                    app_settings::register_clipboard_shortcut(&handle, clipboard_shortcut.as_str());

                if let Some(config) = keyboard_hook::parse_hotkey(toggle.as_str()) {
                    keyboard_hook::register_hotkey(config);
                    keyboard_hook::enable_hook(app_config.strong_shortcut_mode);
                }

                keyboard_hook::set_app_handle(handle.clone());
                keyboard_hook::start_keyboard_hook();
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            drag::report_drop_target,
            drag::get_last_drop,
            drag::extract_icons_from_paths,
            app_settings::set_follow_mouse_on_show,
            app_settings::set_follow_mouse_y_anchor,
            app_settings::set_toggle_shortcut,
            app_settings::suspend_toggle_shortcut,
            app_settings::resume_toggle_shortcut,
            app_settings::set_clipboard_shortcut,
            app_settings::show_window_with_follow_mouse,
            keyboard_hook::set_strong_shortcut_mode,
            keyboard_hook::get_strong_shortcut_mode,
            autostart_service::get_autostart_service_status,
            autostart_service::set_autostart_service_enabled,
            autostart_service::get_autostart_status,
            autostart_service::set_autostart,
            autostart_service::simulate_autostart_launch,
            autostart_service::check_is_autostart_launch,
            clipboard::get_clipboard_content,
            clipboard::get_current_clipboard_hash,
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
            config::get_config,
            config::get_config_paths,
            config::read_raw_config_json,
            config::save_config,
            config::patch_config,
            config::get_launcher_data,
            config::save_launcher_data,
            config::create_backup,
            config::list_backups,
            config::restore_backup,
            config::delete_backup,
            config::export_data,
            config::import_data,
            config::export_to_file,
            config::export_data_to_file,
            config::import_from_file,
            window_effects::set_window_effects,
            window_effects::set_window_effect_type,
            window_effects::restart_app,
            window_effects::is_window_effects_supported,
            window_effects::get_window_effect_support_info,
            corner_hotspot::set_corner_hotspot_config,
            corner_hotspot::get_corner_hotspot_config,
            commands::search::update_search_items,
            commands::search::update_search_items_incremental,
            commands::search::search_apps,
            commands::installed_apps::scan_installed_apps,
            commands::ai_organizer::refine_installed_apps_with_ai,
            system::open_url,
            system::open_path,
            system::open_browser_search,
            system::fetch_favicon_from_url,
            system::read_local_image_as_data_url,
            system::write_text_file,
            system::get_current_monitor_fingerprint,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
