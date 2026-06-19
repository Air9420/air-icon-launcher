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
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

struct TrayState {
    tray: TrayIcon,
}

#[tauri::command]
async fn check_update(app: tauri::AppHandle, window: tauri::Window) -> Result<serde_json::Value, String> {
    use tauri::Emitter;
    
    let log = |msg: String| {
        let _ = window.emit("update-log", &msg);
        log::info!("{}", msg);
    };
    
    log("开始检查更新...".to_string());
    
    let endpoints = vec![
        ("GitHub", "https://github.com/Air9420/air-icon-launcher/releases/latest/download/latest.json"),
        ("Gitee", "https://gitee.com/Air9420/air-icon-launcher/releases/latest/download/latest.json"),
    ];
    
    log(format!("并发检查 {} 个更新源: GitHub, Gitee", endpoints.len()));
    
    // 并发请求所有 endpoints
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    
    let mut handles = vec![];
    for (name, url) in endpoints {
        let client = client.clone();
        let url = url.to_string();
        let name = name.to_string();
        let window_clone = window.clone();
        
        let name_for_task = name.clone();
        let handle = tokio::spawn(async move {
            let log = |msg: String| {
                let _ = window_clone.emit("update-log", &msg);
            };
            
            log(format!("[{}] 正在检查: {}", name_for_task, url));
            let start = std::time::Instant::now();
            
            match client.get(&url).send().await {
                Ok(resp) => {
                    let elapsed = start.elapsed().as_millis();
                    let status = resp.status();
                    if status.is_success() {
                        match resp.json::<serde_json::Value>().await {
                            Ok(json) => {
                                log(format!("[{}] 成功 ({}ms)", name_for_task, elapsed));
                                Ok(json)
                            }
                            Err(e) => {
                                let err = format!("[{}] JSON 解析失败 ({}ms): {}", name_for_task, elapsed, e);
                                log(err.clone());
                                Err(err)
                            }
                        }
                    } else {
                        let err = format!("[{}] HTTP 错误 ({}ms): {} {}", name_for_task, elapsed, status.as_u16(), status.canonical_reason().unwrap_or("unknown"));
                        log(err.clone());
                        Err(err)
                    }
                }
                Err(e) => {
                    let elapsed = start.elapsed().as_millis();
                    let err = if e.is_timeout() {
                        format!("[{}] 连接超时 ({}ms)", name_for_task, elapsed)
                    } else if e.is_connect() {
                        format!("[{}] 连接失败 ({}ms): {}", name_for_task, elapsed, e)
                    } else {
                        format!("[{}] 请求失败 ({}ms): {}", name_for_task, elapsed, e)
                    };
                    log(err.clone());
                    Err(err)
                }
            }
        });
        
        handles.push((name, handle));
    }
    
    // 收集结果：优先使用第一个成功的
    let mut errors: Vec<String> = vec![];
    let mut best_result: Option<serde_json::Value> = None;
    
    for (name, handle) in handles {
        match handle.await {
            Ok(Ok(json)) => {
                // 解析 latest.json
                let version = json.get("version").and_then(|v| v.as_str()).unwrap_or("");
                let notes = json.get("notes").and_then(|v| v.as_str()).unwrap_or("");
                let pub_date = json.get("pub_date").and_then(|v| v.as_str()).unwrap_or("");
                let platforms = json.get("platforms").and_then(|p| p.as_object());
                
                if version.is_empty() {
                    errors.push(format!("[{}] 响应缺少 version 字段", name));
                    continue;
                }
                
                // 获取当前版本
                let current_version = app.config().version.clone().unwrap_or_default();
                
                if version == current_version {
                    log(format!("[{}] 版本相同 ({}), 无需更新", name, version));
                    continue;
                }
                
                log(format!("[{}] 发现新版本 {} (当前 {})", name, version, current_version));
                
                // 获取平台信息
                if let Some(platforms) = platforms {
                    if let Some(win_info) = platforms.get("windows-x86_64") {
                        let signature = win_info.get("signature").and_then(|s| s.as_str()).unwrap_or("");
                        let download_url = win_info.get("url").and_then(|u| u.as_str()).unwrap_or("");
                        
                        best_result = Some(serde_json::json!({
                            "available": true,
                            "version": version,
                            "notes": notes,
                            "pub_date": pub_date,
                            "url": download_url,
                            "signature": signature,
                            "source": name
                        }));
                        
                        log(format!("[{}] 使用此源的更新", name));
                        break;
                    } else {
                        errors.push(format!("[{}] 响应缺少 windows-x86_64 平台信息", name));
                    }
                } else {
                    errors.push(format!("[{}] 响应缺少 platforms 字段", name));
                }
            }
            Ok(Err(e)) => {
                errors.push(format!("[{}]", e));
            }
            Err(e) => {
                errors.push(format!("[{}] 任务异常: {}", name, e));
            }
        }
    }
    
    if let Some(result) = best_result {
        log("检查完成，发现新版本".to_string());
        Ok(result)
    } else if errors.is_empty() {
        log("检查完成，已是最新版本".to_string());
        Ok(serde_json::json!({"available": false}))
    } else {
        let err_msg = format!("所有更新源检查失败:\n{}", errors.join("\n"));
        log(err_msg.clone());
        Err(err_msg)
    }
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| format!("获取更新器失败: {}", e))?;

    match updater.check().await {
        Ok(Some(update)) => {
            let app_handle = app.clone();
            update
                .download_and_install(
                    move |chunk_length, total| {
                        let percentage = match total {
                            Some(t) if t > 0 => (chunk_length as f64 / t as f64 * 100.0) as u32,
                            _ => 0,
                        };
                        let _ = app_handle.emit("update-progress", serde_json::json!({
                            "chunk_length": chunk_length,
                            "total": total,
                            "percentage": percentage
                        }));
                    },
                    || {},
                )
                .await
                .map_err(|e| format!("安装更新失败: {}", e))?;
            app.restart();
        }
        Ok(None) => {}
        Err(e) => return Err(format!("检查更新失败: {}", e)),
    }
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
            install_update,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
