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

struct TrayState {
    tray: TrayIcon,
}

#[tauri::command]
async fn check_update(app: tauri::AppHandle, window: tauri::Window) -> Result<serde_json::Value, String> {
    use tauri::Emitter;
    
    let _ = window.emit("update-log", "开始检查更新（并发双源）...");
    log::info!("开始检查更新");
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    
    let current_version = app.config().version.clone().unwrap_or_default();
    
    // GitHub 直接用 latest 路径
    let github_url = "https://github.com/Air9420/air-icon-launcher/releases/latest/download/latest.json".to_string();
    
    // Gitee 需要先获取最新 release tag
    let gitee_url = {
        let api_url = "https://gitee.com/api/v5/repos/air9420/air-icon-launcher/releases";
        match client.get(api_url).send().await {
            Ok(resp) => {
                if let Ok(releases) = resp.json::<serde_json::Value>().await {
                    releases.as_array()
                        .and_then(|arr| arr.first())
                        .and_then(|r| r.get("tag_name"))
                        .and_then(|t| t.as_str())
                        .map(|tag| {
                            let _ = window.emit("update-log", format!("[Gitee] 最新 release: {}", tag));
                            format!("https://gitee.com/air9420/air-icon-launcher/releases/download/{}/latest.json", tag)
                        })
                } else {
                    let _ = window.emit("update-log", "[Gitee] 无法解析 releases 响应");
                    None
                }
            }
            Err(e) => {
                let _ = window.emit("update-log", format!("[Gitee] API 请求失败: {}", e));
                None
            }
        }
    };
    
    // 并发请求
    let client2 = client.clone();
    let window2 = window.clone();
    let window3 = window.clone();
    let gitee_url2 = gitee_url.clone();
    
    let github_task = async move {
        fetch_latest_json(&client2, &github_url, "GitHub", &window2).await
    };
    
    let gitee_task = async move {
        match gitee_url2 {
            Some(url) => fetch_latest_json(&client, &url, "Gitee", &window3).await,
            None => Err("[Gitee] 跳过（无法获取 release 信息）".to_string()),
        }
    };
    
    // select: 谁先完成用谁
    let result;
    tokio::select! {
        r = github_task => {
            result = r;
        }
        r = gitee_task => {
            result = r;
        }
    }
    
    match result {
        Ok((name, json)) => {
            if let Some(update) = parse_update_json(&json, &current_version, &name, &window) {
                let _ = window.emit("update-log", format!("检查完成，[{}] 发现新版本", name));
                return Ok(update);
            }
            let _ = window.emit("update-log", "检查完成，已是最新版本");
            Ok(serde_json::json!({"available": false}))
        }
        Err(e) => {
            let err_msg = format!("检查更新失败: {}", e);
            let _ = window.emit("update-log", &err_msg);
            Err(err_msg)
        }
    }
}

async fn fetch_latest_json(
    client: &reqwest::Client,
    url: &str,
    source_name: &str,
    window: &tauri::Window,
) -> Result<(String, serde_json::Value), String> {
    use tauri::Emitter;
    let log = |msg: String| { let _ = window.emit("update-log", &msg); };
    
    log(format!("[{}] 正在检查: {}", source_name, url));
    let start = std::time::Instant::now();
    
    match client.get(url).send().await {
        Ok(resp) => {
            let elapsed = start.elapsed().as_millis();
            if resp.status().is_success() {
                match resp.json::<serde_json::Value>().await {
                    Ok(json) => {
                        log(format!("[{}] 成功 ({}ms)", source_name, elapsed));
                        Ok((source_name.to_string(), json))
                    }
                    Err(e) => {
                        let err = format!("[{}] JSON 解析失败 ({}ms): {}", source_name, elapsed, e);
                        log(err.clone());
                        Err(err)
                    }
                }
            } else {
                let err = format!("[{}] HTTP 错误 ({}ms): {}", source_name, elapsed, resp.status());
                log(err.clone());
                Err(err)
            }
        }
        Err(e) => {
            let elapsed = start.elapsed().as_millis();
            let err = if e.is_timeout() {
                format!("[{}] 超时 ({}ms)", source_name, elapsed)
            } else {
                format!("[{}] 连接失败 ({}ms): {}", source_name, elapsed, e)
            };
            log(err.clone());
            Err(err)
        }
    }
}

fn parse_update_json(
    json: &serde_json::Value,
    current_version: &str,
    source_name: &str,
    window: &tauri::Window,
) -> Option<serde_json::Value> {
    use tauri::Emitter;
    let log = |msg: String| { let _ = window.emit("update-log", &msg); };
    
    let version = json.get("version").and_then(|v| v.as_str()).unwrap_or("");
    let notes = json.get("notes").and_then(|v| v.as_str()).unwrap_or("");
    let pub_date = json.get("pub_date").and_then(|v| v.as_str()).unwrap_or("");
    
    if version.is_empty() {
        log(format!("[{}] 响应缺少 version 字段", source_name));
        return None;
    }
    
    if version == current_version {
        log(format!("[{}] 版本相同 ({}), 无需更新", source_name, version));
        return None;
    }
    
    log(format!("[{}] 发现新版本 {} (当前 {})", source_name, version, current_version));
    
    json.get("platforms")
        .and_then(|p| p.get("windows-x86_64"))
        .and_then(|win_info| {
            let signature = win_info.get("signature").and_then(|s| s.as_str()).unwrap_or("");
            let download_url = win_info.get("url").and_then(|u| u.as_str()).unwrap_or("");
            if download_url.is_empty() {
                log(format!("[{}] 响应缺少下载链接", source_name));
                return None;
            }
            log(format!("[{}] 使用此源的更新", source_name));
            Some(serde_json::json!({
                "available": true,
                "version": version,
                "notes": notes,
                "pub_date": pub_date,
                "url": download_url,
                "signature": signature,
                "source": source_name
            }))
        })
}

#[tauri::command]
async fn apply_and_restart(app: tauri::AppHandle, window: tauri::Window, url: String, version: String) -> Result<(), String> {
    use tauri::Emitter;
    
    let _ = window.emit("update-log", format!("开始下载更新: {}", url));
    log::info!("开始下载更新: {}", url);
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300)) // 5分钟超时
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    
    let _ = window.emit("update-log", "正在下载...");
    
    let response = client.get(&url).send().await
        .map_err(|e| {
            let err = format!("下载请求失败: {}", e);
            let _ = window.emit("update-log", &err);
            err
        })?;
    
    if !response.status().is_success() {
        let err = format!("下载失败: HTTP {}", response.status());
        let _ = window.emit("update-log", &err);
        return Err(err);
    }
    
    let total_size = response.content_length().unwrap_or(0);
    let _ = window.emit("update-log", format!("文件大小: {} bytes", total_size));
    
    // 下载到临时文件
    let temp_dir = std::env::temp_dir();
    let file_name = format!("air-icon-launcher-{}-update.nsis.zip", version);
    let file_path = temp_dir.join(&file_name);
    
    let _ = window.emit("update-log", format!("保存到: {:?}", file_path));
    
    let mut file = tokio::fs::File::create(&file_path).await
        .map_err(|e| format!("创建文件失败: {}", e))?;
    
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;
    
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载数据失败: {}", e))?;
        file.write_all(&chunk).await.map_err(|e| format!("写入文件失败: {}", e))?;
        downloaded += chunk.len() as u64;
        
        if total_size > 0 {
            let percentage = (downloaded as f64 / total_size as f64 * 100.0) as u32;
            let _ = window.emit("update-progress", serde_json::json!({
                "downloaded": downloaded,
                "total": total_size,
                "percentage": percentage
            }));
        }
    }
    
    file.flush().await.map_err(|e| format!("刷新文件失败: {}", e))?;
    drop(file);
    
    let _ = window.emit("update-log", "下载完成！");
    let _ = window.emit("update-progress", serde_json::json!({
        "downloaded": total_size,
        "total": total_size,
        "percentage": 100
    }));
    
    // 通知前端下载完成，等待用户确认重启
    let _ = window.emit("update-download-complete", serde_json::json!({
        "file_path": file_path.to_string_lossy(),
        "version": version
    }));
    
    Ok(())
}

#[tauri::command]
async fn restart_application(app: tauri::AppHandle) -> Result<(), String> {
    app.restart();
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
