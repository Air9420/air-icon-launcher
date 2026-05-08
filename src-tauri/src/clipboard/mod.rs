use crate::db::ClipboardDatabase;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "windows")]
use crate::clipboard_listener::listen_clipboard;

pub mod cache;
pub mod image;
pub mod monitor;
pub mod platform;
pub mod types;
pub mod writer;

pub use cache::{ClipboardCache, EventDeduplicator};
pub use image::{get_clipboard_image, save_image_atomic, set_clipboard_image_from_png};
pub use monitor::{get_default_storage_path, start_clipboard_monitor, stop_clipboard_monitor};
pub use platform::{get_clipboard_text, set_clipboard_text};
pub use types::{ClipboardConfig, ClipboardConfigDebug, ClipboardConfigPatch, ClipboardRecord};

pub struct ClipboardState {
    pub cache: Arc<Mutex<ClipboardCache>>,
    pub last_content_hash: Arc<Mutex<String>>,
    pub is_monitoring: Arc<Mutex<bool>>,
    pub config: Arc<Mutex<ClipboardConfig>>,
    pub storage_path: Arc<Mutex<PathBuf>>,
    pub database: Arc<Mutex<Option<ClipboardDatabase>>>,
    pub sender: Arc<Mutex<Option<crossbeam_channel::Sender<ClipboardRecord>>>>,
    pub images_dir: Arc<Mutex<PathBuf>>,
    pub favorite_hashes: Arc<Mutex<HashSet<String>>>,
}

impl Default for ClipboardState {
    fn default() -> Self {
        Self {
            cache: Arc::new(Mutex::new(ClipboardCache::new())),
            last_content_hash: Arc::new(Mutex::new(String::new())),
            is_monitoring: Arc::new(Mutex::new(false)),
            config: Arc::new(Mutex::new(ClipboardConfig::default())),
            storage_path: Arc::new(Mutex::new(PathBuf::new())),
            database: Arc::new(Mutex::new(None)),
            sender: Arc::new(Mutex::new(None)),
            images_dir: Arc::new(Mutex::new(PathBuf::new())),
            favorite_hashes: Arc::new(Mutex::new(HashSet::new())),
        }
    }
}

impl ClipboardState {
    pub fn from_config(app_config: &crate::config::AppConfig, app_handle: &AppHandle) -> Self {
        let storage_path = if let Some(path) = &app_config.clipboard_storage_path {
            PathBuf::from(path)
        } else {
            monitor::get_default_storage_path(app_handle)
        };

        let db_path = storage_path.with_extension("db");
        let images_dir = storage_path
            .parent()
            .unwrap_or(&storage_path)
            .join("images");

        let database = ClipboardDatabase::new(&db_path).ok();

        fs::create_dir_all(&images_dir).ok();

        Self {
            cache: Arc::new(Mutex::new(ClipboardCache::new())),
            last_content_hash: Arc::new(Mutex::new(String::new())),
            is_monitoring: Arc::new(Mutex::new(false)),
            config: Arc::new(Mutex::new(ClipboardConfig {
                history_enabled: app_config.clipboard_history_enabled,
                max_records: app_config.clipboard_max_records,
                max_image_size_mb: app_config.clipboard_max_image_size_mb,
                encrypted: app_config.clipboard_encrypted,
                storage_path: app_config.clipboard_storage_path.clone(),
            })),
            storage_path: Arc::new(Mutex::new(storage_path)),
            database: Arc::new(Mutex::new(database)),
            sender: Arc::new(Mutex::new(None)),
            images_dir: Arc::new(Mutex::new(images_dir)),
            favorite_hashes: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    #[allow(dead_code)]
    pub fn get_images_dir(&self) -> PathBuf {
        self.images_dir.lock().unwrap().clone()
    }

    pub fn rebuild_database(&self, new_path: &Path) -> Result<(), String> {
        let db_path = new_path.with_extension("db");
        let images_dir = new_path.parent().unwrap_or(new_path).join("images");

        if let Some(parent) = new_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

        let new_db = ClipboardDatabase::new(&db_path).map_err(|e| e.to_string())?;

        let mut db_lock = self.database.lock().unwrap();
        *db_lock = Some(new_db);

        let mut images_lock = self.images_dir.lock().unwrap();
        *images_lock = images_dir;

        Ok(())
    }
}

fn clipboard_config_from_app_config(app_config: &crate::config::AppConfig) -> ClipboardConfig {
    ClipboardConfig {
        history_enabled: app_config.clipboard_history_enabled,
        max_records: app_config.clipboard_max_records,
        max_image_size_mb: app_config.clipboard_max_image_size_mb,
        encrypted: app_config.clipboard_encrypted,
        storage_path: app_config.clipboard_storage_path.clone(),
    }
}

fn enforce_runtime_max_records(state: &Arc<ClipboardState>, max_records: usize) -> Result<(), String> {
    if max_records == 0 {
        return Ok(());
    }

    let protected_hashes = state.favorite_hashes.lock().unwrap().clone();

    if let Some(db) = state.database.lock().unwrap().as_ref() {
        let pruned = db
            .enforce_max_records_with_protected(max_records, &protected_hashes)
            .map_err(|e| e.to_string())?;
        let pruned_ids: Vec<String> = pruned.iter().map(|record| record.id.clone()).collect();
        if !pruned_ids.is_empty() {
            let mut cache = state.cache.lock().unwrap();
            let _ = cache.remove_by_ids(&pruned_ids);
        }
        for record in pruned {
            if let Some(image_path) = record.image_path {
                if !image_path.is_empty() {
                    let _ = std::fs::remove_file(image_path);
                }
            }
        }
    }

    let removed = {
        let mut cache = state.cache.lock().unwrap();
        let mut removed = cache.enforce_max_records(max_records);
        if !protected_hashes.is_empty() {
            let mut protected = Vec::new();
            removed.retain(|record| {
                if protected_hashes.contains(&record.hash) {
                    protected.push(record.clone());
                    false
                } else {
                    true
                }
            });
            for record in protected {
                cache.push_with_limit(record, 0);
            }
        }
        removed
    };
    for record in removed {
        if let Some(image_path) = record.image_path {
            if !image_path.is_empty() {
                let _ = std::fs::remove_file(image_path);
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn set_clipboard_favorite_hashes(
    hashes: Vec<String>,
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<(), String> {
    let mut favorite_hashes = state.favorite_hashes.lock().unwrap();
    *favorite_hashes = hashes
        .into_iter()
        .map(|hash| hash.trim().to_string())
        .filter(|hash| !hash.is_empty())
        .collect();
    Ok(())
}

pub fn apply_runtime_config_snapshot(
    state: &Arc<ClipboardState>,
    runtime_config: ClipboardConfig,
    resolved_storage_path: PathBuf,
) -> Result<(), String> {
    let current_storage_path = state.storage_path.lock().unwrap().clone();
    if current_storage_path != resolved_storage_path {
        state.rebuild_database(&resolved_storage_path)?;
        let mut storage_path = state.storage_path.lock().unwrap();
        *storage_path = resolved_storage_path;
    }

    {
        let mut config = state.config.lock().unwrap();
        *config = runtime_config.clone();
    }

    enforce_runtime_max_records(state, runtime_config.max_records)
}

pub fn sync_runtime_config_from_app_config(
    app_handle: &AppHandle,
    state: &Arc<ClipboardState>,
    app_config: &crate::config::AppConfig,
) -> Result<(), String> {
    let resolved_storage_path = app_config
        .clipboard_storage_path
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| monitor::get_default_storage_path(app_handle));

    apply_runtime_config_snapshot(
        state,
        clipboard_config_from_app_config(app_config),
        resolved_storage_path,
    )
}

pub fn apply_monitoring_state_from_app_config(
    app_handle: &AppHandle,
    state: &Arc<ClipboardState>,
    app_config: &crate::config::AppConfig,
) {
    if app_config.clipboard_history_enabled {
        start_clipboard_monitor(app_handle.clone(), state.clone());
    } else {
        stop_clipboard_monitor(state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_base(prefix: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "air-icon-launcher-clipboard-{prefix}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn apply_runtime_config_snapshot_updates_runtime_and_enforces_limit() {
        let base = create_test_base("runtime-sync");
        let state = Arc::new(ClipboardState::default());

        {
            let mut cache = state.cache.lock().unwrap();
            for index in 0..3 {
                cache.push_with_limit(
                    ClipboardRecord {
                        id: format!("clip-{index}"),
                        record_type: "text".to_string(),
                        text_content: Some(format!("text-{index}")),
                        image_path: None,
                        hash: format!("hash-{index}"),
                        timestamp: index,
                    },
                    10,
                );
            }
        }

        let storage_path = base.join("clipboard_history");
        apply_runtime_config_snapshot(
            &state,
            ClipboardConfig {
                history_enabled: true,
                max_records: 2,
                max_image_size_mb: 4.0,
                encrypted: true,
                storage_path: Some(storage_path.to_string_lossy().to_string()),
            },
            storage_path.clone(),
        )
        .unwrap();

        let runtime = state.config.lock().unwrap().clone();
        assert!(runtime.history_enabled);
        assert_eq!(runtime.max_records, 2);
        assert_eq!(runtime.max_image_size_mb, 4.0);
        assert!(runtime.encrypted);
        assert_eq!(runtime.storage_path, Some(storage_path.to_string_lossy().to_string()));
        assert_eq!(state.storage_path.lock().unwrap().clone(), storage_path);
        assert_eq!(state.cache.lock().unwrap().get_all().len(), 2);
        assert!(state.database.lock().unwrap().is_some());

        let _ = std::fs::remove_dir_all(&base);
    }
}

fn generate_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let random: u32 = rand();
    format!("cb-{}-{:08x}", ts, random)
}

fn rand() -> u32 {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let state = RandomState::new();
    let mut hasher = state.build_hasher();
    hasher.write_u32(get_timestamp() as u32);
    hasher.finish() as u32
}

fn get_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn simple_hash(data: &[u8]) -> String {
    use std::hash::{DefaultHasher, Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    data.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

#[tauri::command]
pub fn get_clipboard_content() -> Result<String, String> {
    get_clipboard_text().ok_or_else(|| "Failed to get clipboard content".to_string())
}

#[tauri::command]
pub fn get_current_clipboard_hash(
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<String, String> {
    let last_hash = state.last_content_hash.lock().unwrap();
    Ok(last_hash.clone())
}

#[tauri::command]
pub fn set_clipboard_content(
    content: String,
    is_image: bool,
    state: tauri::State<'_, Arc<ClipboardState>>,
    app_handle: AppHandle,
) -> Result<(), String> {
    if is_image {
        if let Ok(png_data) = std::fs::read(&content) {
            if set_clipboard_image_from_png(&png_data) {
                let hash = simple_hash(&png_data);
                let mut last_hash = state.last_content_hash.lock().unwrap();
                *last_hash = hash;
                let _ = app_handle.emit("clipboard-set-from-history", true);
                return Ok(());
            }
        }
        Err("Failed to set image to clipboard".to_string())
    } else {
        let hash = simple_hash(content.as_bytes());
        if set_clipboard_text(&content) {
            let mut last_hash = state.last_content_hash.lock().unwrap();
            *last_hash = hash;
            let _ = app_handle.emit("clipboard-set-from-history", true);
            Ok(())
        } else {
            Err("Failed to set clipboard content".to_string())
        }
    }
}

#[tauri::command]
pub fn get_clipboard_history(
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<Vec<ClipboardRecord>, String> {
    let config = state.config.lock().unwrap().clone();
    if !config.history_enabled {
        return Ok(Vec::new());
    }

    let max_records = config.max_records;
    let cache = state.cache.lock().unwrap();
    let mut records = cache.get_all();
    if max_records > 0 && records.len() > max_records {
        records.truncate(max_records);
    }
    Ok(records)
}

#[tauri::command]
pub fn clear_clipboard_history(state: tauri::State<'_, Arc<ClipboardState>>) -> Result<(), String> {
    {
        let mut cache = state.cache.lock().unwrap();
        cache.list.clear();
        cache.hash_index.clear();
        cache.content_index.clear();
        cache.buffer_hashes.clear();
    }

    if let Some(db) = state.database.lock().unwrap().as_ref() {
        let images = db.clear().map_err(|e| e.to_string())?;
        for image_path in images {
            let _ = std::fs::remove_file(image_path);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn delete_clipboard_record(
    id: String,
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<(), String> {
    let removed = {
        let mut cache = state.cache.lock().unwrap();
        cache.remove_by_id(&id)
    };

    if let Some(record) = removed {
        if let Some(db) = state.database.lock().unwrap().as_ref() {
            if let Ok(Some(image_path)) = db.delete(&id) {
                if !image_path.is_empty() {
                    let _ = std::fs::remove_file(&image_path);
                }
            }
        }

        if let Some(ref image_path) = record.image_path {
            if !image_path.is_empty() {
                let _ = std::fs::remove_file(image_path);
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn get_clipboard_config(
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<ClipboardConfig, String> {
    let config = state.config.lock().unwrap();
    Ok(config.clone())
}

#[tauri::command]
pub fn get_clipboard_config_debug(
    config_manager: tauri::State<'_, crate::config::ConfigManager>,
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<ClipboardConfigDebug, String> {
    let runtime = state.config.lock().unwrap().clone();
    let disk = config_manager.load_config();
    Ok(ClipboardConfigDebug {
        config_path: config_manager.config_path().to_string_lossy().to_string(),
        runtime,
        disk_history_enabled: disk.clipboard_history_enabled,
        disk_max_records: disk.clipboard_max_records,
        disk_max_image_size_mb: disk.clipboard_max_image_size_mb,
        disk_encrypted: disk.clipboard_encrypted,
        disk_storage_path: disk.clipboard_storage_path,
    })
}

#[tauri::command]
pub fn set_clipboard_config(
    patch: ClipboardConfigPatch,
    app_handle: AppHandle,
    config_manager: tauri::State<'_, crate::config::ConfigManager>,
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<ClipboardConfig, String> {
    {
        let mut config = state.config.lock().unwrap();

        if let Some(v) = patch.history_enabled {
            config.history_enabled = v;
        }
        if let Some(v) = patch.max_records {
            config.max_records = v;
        }
        if let Some(v) = patch.max_image_size_mb {
            config.max_image_size_mb = v;
        }
        if let Some(v) = patch.encrypted {
            config.encrypted = v;
        }
    }

    let mut app_config = config_manager.load_config();

    if let Some(v) = patch.history_enabled {
        app_config.clipboard_history_enabled = v;
    }
    if let Some(v) = patch.max_records {
        app_config.clipboard_max_records = v;
    }
    if let Some(v) = patch.max_image_size_mb {
        app_config.clipboard_max_image_size_mb = v;
    }
    if let Some(v) = patch.encrypted {
        app_config.clipboard_encrypted = v;
    }

    config_manager.save_config(&app_config)?;

    let verify = config_manager.load_config();
    if let Some(v) = patch.history_enabled {
        if verify.clipboard_history_enabled != v {
            return Err(format!(
                "配置写入校验失败：clipboard_history_enabled 期望={} 实际={} 路径={}",
                v,
                verify.clipboard_history_enabled,
                config_manager.config_path().to_string_lossy()
            ));
        }
    }
    if let Some(v) = patch.max_records {
        if verify.clipboard_max_records != v {
            return Err(format!(
                "配置写入校验失败：clipboard_max_records 期望={} 实际={} 路径={}",
                v,
                verify.clipboard_max_records,
                config_manager.config_path().to_string_lossy()
            ));
        }
    }
    if let Some(v) = patch.max_image_size_mb {
        if (verify.clipboard_max_image_size_mb - v).abs() > 1e-9 {
            return Err(format!(
                "配置写入校验失败：clipboard_max_image_size_mb 期望={} 实际={} 路径={}",
                v,
                verify.clipboard_max_image_size_mb,
                config_manager.config_path().to_string_lossy()
            ));
        }
    }
    if let Some(v) = patch.encrypted {
        if verify.clipboard_encrypted != v {
            return Err(format!(
                "配置写入校验失败：clipboard_encrypted 期望={} 实际={} 路径={}",
                v,
                verify.clipboard_encrypted,
                config_manager.config_path().to_string_lossy()
            ));
        }
    }

    if let Some(v) = patch.max_records {
        enforce_runtime_max_records(state.inner(), v)?;
    }
    if let Some(v) = patch.history_enabled {
        if v {
            start_clipboard_monitor(app_handle, state.inner().clone());
        } else {
            stop_clipboard_monitor(state.inner());
        }
    }

    let latest = state.config.lock().unwrap().clone();
    Ok(latest)
}

#[tauri::command]
pub fn set_clipboard_storage_path(
    config_manager: tauri::State<'_, crate::config::ConfigManager>,
    path: String,
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<(), String> {
    let new_path = PathBuf::from(&path);

    let old_path = state.storage_path.lock().unwrap().clone();

    {
        let mut storage_path = state.storage_path.lock().unwrap();
        *storage_path = new_path.clone();
    }

    if let Err(e) = state.rebuild_database(&new_path) {
        {
            let mut sp = state.storage_path.lock().unwrap();
            *sp = old_path.clone();
        }
        return Err(e);
    }

    {
        let mut config = state.config.lock().unwrap();
        config.storage_path = Some(path.clone());
    }

    let mut app_config = config_manager.load_config();
    app_config.clipboard_storage_path = Some(path);
    config_manager.save_config(&app_config)?;

    let verify = config_manager.load_config();
    if verify.clipboard_storage_path != app_config.clipboard_storage_path {
        return Err(format!(
            "配置写入校验失败：clipboard_storage_path 期望={:?} 实际={:?} 路径={}",
            app_config.clipboard_storage_path,
            verify.clipboard_storage_path,
            config_manager.config_path().to_string_lossy()
        ));
    }

    Ok(())
}

#[tauri::command]
pub fn get_clipboard_storage_path(
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<String, String> {
    let path = state.storage_path.lock().unwrap().clone();
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn reset_clipboard_storage_path(
    app: AppHandle,
    config_manager: tauri::State<'_, crate::config::ConfigManager>,
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<String, String> {
    let default_path = monitor::get_default_storage_path(&app);

    let old_path = state.storage_path.lock().unwrap().clone();

    {
        let mut storage_path = state.storage_path.lock().unwrap();
        *storage_path = default_path.clone();
    }

    if let Err(e) = state.rebuild_database(&default_path) {
        {
            let mut sp = state.storage_path.lock().unwrap();
            *sp = old_path.clone();
        }
        return Err(e);
    }

    {
        let mut config = state.config.lock().unwrap();
        config.storage_path = None;
    }

    let mut app_config = config_manager.load_config();
    app_config.clipboard_storage_path = None;
    config_manager.save_config(&app_config)?;

    Ok(default_path.to_string_lossy().to_string())
}
