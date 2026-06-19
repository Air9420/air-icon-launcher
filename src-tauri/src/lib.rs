mod app_settings;
mod autostart_service;
mod clipboard;
mod clipboard_listener;
mod commands;
mod config;
mod corner_hotspot;
mod db;
mod display;
mod display_monitor;
mod drag;
mod error;
mod icc;
mod keyboard_hook;
mod memory_profiler;
mod migration;
mod migrations;
mod pinyin;
mod plugins;
mod process_monitor;
mod search;
mod system;
mod tray;
mod updater;
mod window_effects;
use tauri::tray::TrayIcon;
use tauri::Manager;

struct TrayState {
    tray: TrayIcon,
}

#[tauri::command]
async fn check_update(app: tauri::AppHandle, window: tauri::Window) -> Result<serde_json::Value, String> {
    use tauri::Emitter;
    use tauri_plugin_updater::UpdaterExt;
    
    let _ = window.emit("update-log", "开始检查更新...");
    log::info!("开始检查更新");
    
    let updater = app.updater().map_err(|e| format!("获取更新器失败: {}", e))?;
    
    let update = updater.check().await
        .map_err(|e| format!("检查更新失败: {}", e))?;
    
    match update {
        Some(update) => {
            let _ = window.emit("update-log", format!("发现新版本: {}", update.version));
            Ok(serde_json::json!({
                "available": true,
                "version": update.version,
                "notes": update.body.unwrap_or_default(),
                "pub_date": update.date.map(|d| d.to_string()).unwrap_or_default(),
                "url": update.download_url.to_string(),
                "signature": update.signature
            }))
        }
        None => {
            let _ = window.emit("update-log", "没有可用更新");
            Ok(serde_json::json!({
                "available": false
            }))
        }
    }
}

#[tauri::command]
async fn apply_and_restart(app: tauri::AppHandle, window: tauri::Window) -> Result<(), String> {
    use tauri::Emitter;
    use tauri_plugin_updater::UpdaterExt;
    
    let _ = window.emit("update-log", "开始检查更新...");
    log::info!("开始检查更新");
    
    let updater = app.updater().map_err(|e| format!("获取更新器失败: {}", e))?;
    
    let update = updater.check().await
        .map_err(|e| format!("检查更新失败: {}", e))?;
    
    let Some(update) = update else {
        let _ = window.emit("update-log", "没有可用更新");
        return Err("没有可用更新".to_string());
    };
    
    let _ = window.emit("update-log", format!("发现新版本: {}", update.version));
    let _ = window.emit("update-log", "开始下载更新...");
    
    let downloaded = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let downloaded_clone = downloaded.clone();
    
    update.download_and_install(
        |chunk_length, total| {
            downloaded.fetch_add(chunk_length, std::sync::atomic::Ordering::Relaxed);
            let current = downloaded.load(std::sync::atomic::Ordering::Relaxed);
            let percentage = if let Some(total) = total {
                if total > 0 {
                    (current as f64 / total as f64 * 100.0) as u32
                } else {
                    0
                }
            } else {
                0
            };
            let _ = window.emit("update-progress", serde_json::json!({
                "downloaded": current,
                "total": total.unwrap_or(0),
                "percentage": percentage
            }));
        },
        || {
            let final_downloaded = downloaded_clone.load(std::sync::atomic::Ordering::Relaxed);
            let _ = window.emit("update-log", "下载完成！");
            let _ = window.emit("update-progress", serde_json::json!({
                "downloaded": final_downloaded,
                "total": final_downloaded,
                "percentage": 100
            }));
        },
    ).await.map_err(|e| format!("下载或安装更新失败: {}", e))?;
    
    let _ = window.emit("update-log", "更新已安装！");
    let _ = window.emit("update-download-complete", serde_json::json!({
        "version": update.version
    }));
    
    Ok(())
}

#[tauri::command]
async fn restart_application(app: tauri::AppHandle) -> Result<(), String> {
    // 隐藏系统托盘图标，防止重启后残留
    if let Some(state) = app.try_state::<crate::TrayState>() {
        let _ = state.tray.set_visible(false);
    }
    app.restart();
    // unreachable, but needed for return type
    #[allow(unreachable_code)]
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
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
            
            let icc_state = icc::IccState::default();
            icc_state.set_app_handle(handle.clone());
            *icc_state.profiles.lock().unwrap() = app_config.icc_profiles.clone();
            app.manage(icc_state);

            let clipboard_state = clipboard::ClipboardState::from_config(&app_config, &handle);
            let clipboard_state = std::sync::Arc::new(clipboard_state);
            app.manage(clipboard_state.clone());

            corner_hotspot::update_corner_hotspot_config(
                &handle,
                app_config.corner_hotspot_enabled,
                &app_config.corner_hotspot_position,
                &app_config.corner_hotspot_sensitivity,
            );

            clipboard::apply_monitoring_state_from_app_config(
                &handle,
                &clipboard_state,
                &app_config,
            );
            process_monitor::start_process_monitor(handle.clone());
            display_monitor::start_display_monitor(handle.clone());
            if autostart_service::is_autostart_launch() {
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            {
                let (toggle, clipboard_shortcut, display_shortcut) = handle
                    .state::<app_settings::AppSettingsState>()
                    .inner
                    .lock()
                    .map(|g| {
                        (
                            g.toggle_shortcut.clone(),
                            g.clipboard_shortcut.clone(),
                            g.display_shortcut.clone(),
                        )
                    })
                    .unwrap_or(("alt+space".to_string(), "alt+v".to_string(), String::new()));

                let _ = app_settings::register_toggle_shortcut(&handle, toggle.as_str());
                let _ =
                    app_settings::register_clipboard_shortcut(&handle, clipboard_shortcut.as_str());

                if !display_shortcut.is_empty() {
                    let _ =
                        app_settings::register_display_shortcut(&handle, display_shortcut.as_str());
                }

                let icc_shortcut = handle
                    .state::<app_settings::AppSettingsState>()
                    .inner
                    .lock()
                    .map(|g| g.icc_shortcut.clone())
                    .unwrap_or("alt+i".to_string());

                if !icc_shortcut.is_empty() {
                    let _ = app_settings::register_icc_shortcut(&handle, icc_shortcut.as_str());
                }

                if let Some(config) = keyboard_hook::parse_hotkey(toggle.as_str()) {
                    keyboard_hook::register_hotkey(config);
                    keyboard_hook::enable_hook(app_config.strong_shortcut_mode);
                }

                keyboard_hook::set_app_handle(handle.clone());
                keyboard_hook::start_keyboard_hook();
            }
            Ok(())
        });

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            check_update,
            apply_and_restart,
            restart_application,
            drag::report_drop_target,
            drag::get_last_drop,
            drag::extract_icons_from_paths,
            app_settings::set_follow_mouse_on_show,
            app_settings::set_follow_mouse_y_anchor,
            app_settings::set_toggle_shortcut,
            app_settings::suspend_toggle_shortcut,
            app_settings::resume_toggle_shortcut,
            app_settings::set_clipboard_shortcut,
            app_settings::set_display_shortcut,
            app_settings::suspend_display_shortcut,
            app_settings::resume_display_shortcut,
            app_settings::set_icc_shortcut,
            app_settings::show_window_with_follow_mouse,
            app_settings::show_launcher,
            app_settings::set_show_mode,
            app_settings::get_show_mode,
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
            clipboard::get_clipboard_history_by_type,
            clipboard::search_clipboard_history,
            clipboard::get_clipboard_type_counts,
            clipboard::clear_clipboard_history,
            clipboard::clear_clipboard_history_by_type,
            clipboard::delete_clipboard_record,
            clipboard::set_clipboard_favorite,
            clipboard::get_clipboard_config,
            clipboard::get_clipboard_config_debug,
            clipboard::set_clipboard_config,
            clipboard::set_clipboard_favorite_hashes,
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
            commands::installed_apps::quick_scan_registry,
            commands::scan_cache::read_scan_cache,
            commands::scan_cache::launch_scanned_app,
            commands::scan_cache::extract_icon_lazy,
            commands::scan_cache::resolve_lnk_target,
            commands::pinyin::to_pinyin,
            commands::pinyin::to_pinyin_initial,
            commands::ai_organizer::refine_installed_apps_with_ai,
            commands::system::is_process_running,
            system::open_url,
            system::open_path,
            system::reveal_in_explorer,
            system::open_browser_search,
            system::fetch_favicon_from_url,
            system::read_local_image_as_data_url,
            system::write_text_file,
            system::get_recent_files,
            system::get_current_monitor_fingerprint,
            display::get_current_display_mode,
            display::get_display_count,
            display::set_display_mode,
            display::toggle_display_mode,
            icc::get_monitors,
            icc::get_icc_profiles,
            icc::add_icc_profile,
            icc::remove_icc_profile,
            icc::toggle_icc_profile,
            icc::apply_icc_profile,
            icc::apply_icc_lut_only,
            icc::restore_default_icc,
            icc::select_icc_file,
            icc::get_system_icc_profiles,
            icc::warmup_wcs,
            commands::memory::get_memory_stats,
            commands::memory::force_memory_cleanup,
            commands::memory::get_memory_recommendations,
            apply_and_restart,
            restart_application,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
