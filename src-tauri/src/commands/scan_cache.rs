use crate::commands::installed_apps::{self, InstalledAppEntry};
use crate::error::AppError;
use crate::error::AppResult;
use crate::pinyin::PinyinIndex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedAppEntry {
    pub name: String,
    pub path: String,
    pub source: String,
    pub publisher: Option<String>,
    pub icon_base64: Option<String>,
    #[serde(default)]
    pub name_pinyin_full: String,
    #[serde(default)]
    pub name_pinyin_initial: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanCache {
    pub updated_at: u64,
    pub scan_type: String,
    pub apps: Vec<CachedAppEntry>,
}

fn cache_file_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("app data dir")
        .join("scanned_apps_cache.json")
}

fn read_cache(app: &AppHandle) -> Option<ScanCache> {
    let path = cache_file_path(app);
    let content = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

fn write_cache_file(path: &PathBuf, cache: &ScanCache) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let tmp = path.with_extension("tmp");
    if let Ok(json) = serde_json::to_string(&cache) {
        let _ = std::fs::write(&tmp, json);
        let _ = std::fs::rename(&tmp, path);
    }
}

pub fn write_cache(app: &AppHandle, entries: &[InstalledAppEntry], scan_type: &str) {
    let path = cache_file_path(app);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let pinyin_index = PinyinIndex::new();

    let cache = ScanCache {
        updated_at: now,
        scan_type: scan_type.to_string(),
        apps: entries
            .iter()
            .map(|e| CachedAppEntry {
                name: e.name.clone(),
                path: e.path.clone(),
                source: e.source.clone(),
                publisher: e.publisher.clone(),
                icon_base64: e.icon_base64.clone(),
                name_pinyin_full: pinyin_index.to_pinyin_full(&e.name),
                name_pinyin_initial: pinyin_index.to_pinyin_initial(&e.name),
            })
            .collect(),
    };

    write_cache_file(&path, &cache);
}

#[tauri::command]
pub fn read_scan_cache(app: AppHandle) -> AppResult<Option<ScanCache>> {
    let mut cache = read_cache(&app);
    if let Some(ref mut cache) = cache {
        let pinyin_index = PinyinIndex::new();
        let mut cache_updated = false;

        for entry in &mut cache.apps {
            if entry.name_pinyin_full.is_empty() {
                entry.name_pinyin_full = pinyin_index.to_pinyin_full(&entry.name);
                cache_updated = true;
            }
            if entry.name_pinyin_initial.is_empty() {
                entry.name_pinyin_initial = pinyin_index.to_pinyin_initial(&entry.name);
                cache_updated = true;
            }
        }

        if cache_updated {
            let path = cache_file_path(&app);
            write_cache_file(&path, cache);
        }
    }
    Ok(cache)
}

#[tauri::command]
pub fn launch_scanned_app(path: String) -> AppResult<()> {
    let status = std::process::Command::new("cmd")
        .args(["/C", "start", "", &path])
        .spawn();
    match status {
        Ok(_) => Ok(()),
        Err(e) => Err(AppError::internal(format!("启动失败: {}", e))),
    }
}

#[tauri::command]
pub fn extract_icon_lazy(path: String) -> AppResult<Option<String>> {
    Ok(installed_apps::extract_icon_for_path(&path))
}

#[tauri::command]
pub fn resolve_lnk_target(path: String) -> AppResult<Option<String>> {
    let path_buf = PathBuf::from(&path);
    if path_buf.extension().and_then(|e| e.to_str()) != Some("lnk") {
        return Ok(None);
    }
    match crate::drag::resolve_windows_shortcut_target_pathbuf(&path_buf) {
        Some(target) => Ok(Some(target.to_string_lossy().into_owned())),
        None => Ok(None),
    }
}
