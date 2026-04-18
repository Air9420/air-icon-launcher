pub mod types;

use crate::error::{AppError, AppResult};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
pub use types::*;

pub const CONFIG_VERSION: &str = "1.0";
const AI_ORGANIZER_API_KEY_ENV_VAR: &str = "AIR_ICON_LAUNCHER_AI_API_KEY";

fn write_atomically(path: &Path, data: &[u8]) -> Result<(), String> {
    let temp_path = path.with_extension("tmp");
    fs::write(&temp_path, data).map_err(|e| e.to_string())?;
    fs::rename(&temp_path, path).map_err(|e| e.to_string())
}

fn normalize_api_key(raw: &str) -> String {
    raw.trim().to_string()
}

fn redact_ai_organizer_api_key(config: &mut AppConfig) {
    config.ai_organizer_api_key.clear();
}

fn redacted_config(config: &AppConfig) -> AppConfig {
    let mut sanitized = config.clone();
    redact_ai_organizer_api_key(&mut sanitized);
    sanitized
}

fn redacted_export_data(data: &ExportData) -> ExportData {
    let mut sanitized = data.clone();
    if let Some(settings) = sanitized.settings.as_mut() {
        redact_ai_organizer_api_key(settings);
    }
    sanitized
}

fn redact_ai_organizer_api_key_in_json_export(data: &mut serde_json::Value) {
    if let Some(settings) = data.get_mut("settings").and_then(serde_json::Value::as_object_mut) {
        settings.insert(
            "ai_organizer_api_key".to_string(),
            serde_json::Value::String(String::new()),
        );
    }
}

#[derive(Clone)]
pub struct ConfigManager {
    app_data_dir: PathBuf,
    config_path: PathBuf,
    launcher_data_path: PathBuf,
    backups_dir: PathBuf,
    runtime_ai_organizer_api_key: Arc<Mutex<String>>,
}

impl ConfigManager {
    pub fn new(app_handle: &AppHandle) -> Self {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir());

        let _ = fs::create_dir_all(&app_data_dir);

        let config_path = app_data_dir.join("config.json");
        let launcher_data_path = app_data_dir.join("launcher_data.json");
        let backups_dir = app_data_dir.join("backups");
        let env_api_key = std::env::var(AI_ORGANIZER_API_KEY_ENV_VAR).unwrap_or_default();

        let _ = fs::create_dir_all(&backups_dir);

        Self {
            app_data_dir,
            config_path,
            launcher_data_path,
            backups_dir,
            runtime_ai_organizer_api_key: Arc::new(Mutex::new(normalize_api_key(&env_api_key))),
        }
    }

    pub fn app_data_dir(&self) -> PathBuf {
        self.app_data_dir.clone()
    }

    pub fn config_path(&self) -> PathBuf {
        self.config_path.clone()
    }

    pub fn launcher_data_path(&self) -> PathBuf {
        self.launcher_data_path.clone()
    }

    pub fn get_ai_organizer_api_key(&self) -> String {
        self.runtime_ai_organizer_api_key
            .lock()
            .map(|key| key.clone())
            .unwrap_or_default()
    }

    pub fn set_ai_organizer_api_key(&self, api_key: &str) {
        if let Ok(mut key) = self.runtime_ai_organizer_api_key.lock() {
            *key = normalize_api_key(api_key);
        }
    }

    fn apply_runtime_ai_organizer_api_key(&self, config: &mut AppConfig) {
        config.ai_organizer_api_key = self.get_ai_organizer_api_key();
    }

    pub fn load_config(&self) -> AppConfig {
        if !self.config_path.exists() {
            let mut config = AppConfig::default();
            self.apply_runtime_ai_organizer_api_key(&mut config);
            return config;
        }

        match fs::read_to_string(&self.config_path) {
            Ok(content) => match serde_json::from_str::<AppConfig>(&content) {
                Ok(mut config) => {
                    let legacy_key = normalize_api_key(&config.ai_organizer_api_key);
                    if !legacy_key.is_empty() {
                        // Migrate legacy plaintext key from disk into runtime memory.
                        self.set_ai_organizer_api_key(&legacy_key);
                        redact_ai_organizer_api_key(&mut config);
                        let _ = self.save_config(&config);
                    }
                    self.apply_runtime_ai_organizer_api_key(&mut config);
                    config
                }
                Err(e) => {
                    eprintln!(
                        "Failed to parse config file ({}): {}",
                        self.config_path.to_string_lossy(),
                        e
                    );
                    let _ = self.backup_bad_config_file();
                    let mut default_config = AppConfig::default();
                    self.apply_runtime_ai_organizer_api_key(&mut default_config);
                    let _ = self.save_config(&default_config);
                    default_config
                }
            },
            Err(e) => {
                eprintln!(
                    "Failed to read config file ({}): {}",
                    self.config_path.to_string_lossy(),
                    e
                );
                let mut default_config = AppConfig::default();
                self.apply_runtime_ai_organizer_api_key(&mut default_config);
                default_config
            }
        }
    }

    fn backup_bad_config_file(&self) -> Result<(), String> {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let backup_path = self
            .config_path
            .with_file_name(format!("config.bad.{}.json", timestamp));
        fs::rename(&self.config_path, backup_path).map_err(|e| e.to_string())
    }

    pub fn save_config(&self, config: &AppConfig) -> Result<(), String> {
        let content = serde_json::to_string_pretty(&redacted_config(config))
            .map_err(|e| e.to_string())?;
        write_atomically(&self.config_path, content.as_bytes())
    }

    pub fn save_config_with_runtime_ai_key(&self, config: &AppConfig) -> Result<(), String> {
        self.set_ai_organizer_api_key(&config.ai_organizer_api_key);
        self.save_config(config)
    }

    pub fn load_launcher_data(&self) -> LauncherData {
        if !self.launcher_data_path.exists() {
            return LauncherData::default();
        }

        match fs::read_to_string(&self.launcher_data_path) {
            Ok(content) => match serde_json::from_str::<LauncherData>(&content) {
                Ok(data) => data,
                Err(_) => LauncherData::default(),
            },
            Err(_) => LauncherData::default(),
        }
    }

    pub fn save_launcher_data(&self, data: &LauncherData) -> Result<(), String> {
        let content = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
        write_atomically(&self.launcher_data_path, content.as_bytes())
    }

    pub fn get_backups_dir(&self) -> PathBuf {
        self.backups_dir.clone()
    }

    pub fn create_backup(
        &self,
        config: &AppConfig,
        launcher_data: &LauncherData,
    ) -> Result<String, String> {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let backup_name = format!("backup_{}.json", timestamp);
        let backup_path = self.backups_dir.join(&backup_name);
        let redacted = redacted_config(config);

        let backup_data = serde_json::json!({
            "version": CONFIG_VERSION,
            "backup_time": timestamp,
            "config": redacted,
            "launcher_data": launcher_data,
        });

        let content = serde_json::to_string_pretty(&backup_data).map_err(|e| e.to_string())?;

        write_atomically(&backup_path, content.as_bytes())?;

        Ok(backup_path.to_string_lossy().to_string())
    }

    pub fn list_backups(&self) -> Result<Vec<BackupInfo>, String> {
        let mut backups = Vec::new();

        let entries = fs::read_dir(&self.backups_dir).map_err(|e| e.to_string())?;

        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.extension().map(|e| e == "json").unwrap_or(false) {
                    if let Some(name) = path.file_name() {
                        if let Some(name_str) = name.to_str() {
                            if name_str.starts_with("backup_") {
                                if let Ok(metadata) = entry.metadata() {
                                    let created = metadata
                                        .created()
                                        .ok()
                                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                        .map(|d| d.as_secs())
                                        .unwrap_or(0);

                                    backups.push(BackupInfo {
                                        filename: name_str.to_string(),
                                        path: path.to_string_lossy().to_string(),
                                        created_at: created,
                                        size: metadata.len(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(backups)
    }

    pub fn restore_backup(&self, filename: &str) -> Result<(AppConfig, LauncherData), String> {
        let backup_path = self.backups_dir.join(filename);

        if !backup_path.exists() {
            return Err("Backup file not found".to_string());
        }

        let content = fs::read_to_string(&backup_path).map_err(|e| e.to_string())?;

        let backup: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| e.to_string())?;

        let config: AppConfig = backup
            .get("config")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        let launcher_data: LauncherData = backup
            .get("launcher_data")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        Ok((config, launcher_data))
    }

    pub fn delete_backup(&self, filename: &str) -> Result<(), String> {
        let backup_path = self.backups_dir.join(filename);
        fs::remove_file(&backup_path).map_err(|e| e.to_string())
    }

    pub fn cleanup_old_backups(&self, retention: usize) -> AppResult<()> {
        let backups = self.list_backups().map_err(|e| AppError::internal(e))?;

        if backups.len() > retention {
            let to_delete: Vec<_> = backups.into_iter().skip(retention).collect();
            for backup in to_delete {
                self.delete_backup(&backup.filename)
                    .map_err(|e| AppError::internal(e))?;
            }
        }

        Ok(())
    }
}

#[tauri::command]
pub fn get_config_paths(manager: tauri::State<'_, ConfigManager>) -> AppResult<ConfigPaths> {
    Ok(ConfigPaths {
        app_data_dir: manager.app_data_dir().to_string_lossy().to_string(),
        config_path: manager.config_path().to_string_lossy().to_string(),
        launcher_data_path: manager.launcher_data_path().to_string_lossy().to_string(),
        backups_dir: manager.get_backups_dir().to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn read_raw_config_json(manager: tauri::State<'_, ConfigManager>) -> AppResult<String> {
    let path = manager.config_path();
    if !path.exists() {
        return Err(AppError::not_found(format!("config.json at {:?}", path)));
    }
    fs::read_to_string(&path)
        .map_err(|e| AppError::io_error(format!("Failed to read config.json: {}", e)))
}

#[tauri::command]
pub fn get_config(manager: tauri::State<'_, ConfigManager>) -> AppResult<AppConfig> {
    Ok(manager.load_config())
}

#[tauri::command]
pub fn save_config(manager: tauri::State<'_, ConfigManager>, config: AppConfig) -> AppResult<()> {
    manager
        .save_config_with_runtime_ai_key(&config)
        .map_err(|e| AppError::new("CONFIG_SAVE_ERROR", e))
}

#[tauri::command]
pub fn get_launcher_data(manager: tauri::State<'_, ConfigManager>) -> AppResult<LauncherData> {
    Ok(manager.load_launcher_data())
}

#[tauri::command]
pub fn save_launcher_data(
    manager: tauri::State<'_, ConfigManager>,
    data: LauncherData,
) -> AppResult<()> {
    manager
        .save_launcher_data(&data)
        .map_err(|e| AppError::new("LAUNCHER_DATA_SAVE_ERROR", e))
}

#[tauri::command]
pub fn create_backup(manager: tauri::State<'_, ConfigManager>) -> AppResult<String> {
    let config = manager.load_config();
    let launcher_data = manager.load_launcher_data();
    manager
        .create_backup(&config, &launcher_data)
        .map_err(|e| AppError::new("BACKUP_ERROR", e))
}

#[tauri::command]
pub fn list_backups(manager: tauri::State<'_, ConfigManager>) -> AppResult<Vec<BackupInfo>> {
    manager
        .list_backups()
        .map_err(|e| AppError::new("LIST_BACKUPS_ERROR", e))
}

#[tauri::command]
pub fn restore_backup(
    manager: tauri::State<'_, ConfigManager>,
    filename: String,
) -> AppResult<serde_json::Value> {
    let (mut config, launcher_data) = manager
        .restore_backup(&filename)
        .map_err(|e| AppError::new("RESTORE_BACKUP_ERROR", e))?;
    if !normalize_api_key(&config.ai_organizer_api_key).is_empty() {
        manager.set_ai_organizer_api_key(&config.ai_organizer_api_key);
    }
    redact_ai_organizer_api_key(&mut config);
    manager
        .save_config(&config)
        .map_err(|e| AppError::new("CONFIG_SAVE_ERROR", e))?;
    manager
        .save_launcher_data(&launcher_data)
        .map_err(|e| AppError::new("LAUNCHER_DATA_SAVE_ERROR", e))?;

    Ok(serde_json::json!({
        "settings": config,
        "launcher_data": launcher_data,
    }))
}

#[tauri::command]
pub fn delete_backup(manager: tauri::State<'_, ConfigManager>, filename: String) -> AppResult<()> {
    manager
        .delete_backup(&filename)
        .map_err(|e| AppError::new("DELETE_BACKUP_ERROR", e))
}

#[tauri::command]
pub fn export_data(
    manager: tauri::State<'_, ConfigManager>,
    include_launcher_data: bool,
    include_settings: bool,
    include_plugins: bool,
) -> AppResult<ExportData> {
    let export_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let launcher_data = if include_launcher_data {
        Some(manager.load_launcher_data())
    } else {
        None
    };

    let settings = if include_settings {
        Some(redacted_config(&manager.load_config()))
    } else {
        None
    };

    let plugins = if include_plugins {
        Some(Vec::new())
    } else {
        None
    };

    Ok(ExportData {
        version: CONFIG_VERSION.to_string(),
        export_time,
        launcher_data,
        settings,
        plugins,
    })
}

#[tauri::command]
pub fn import_data(
    manager: tauri::State<'_, ConfigManager>,
    data: ExportData,
    merge_mode: bool,
) -> AppResult<()> {
    if let Some(settings) = data.settings {
        if !normalize_api_key(&settings.ai_organizer_api_key).is_empty() {
            manager.set_ai_organizer_api_key(&settings.ai_organizer_api_key);
        }
        if !merge_mode {
            manager
                .save_config(&settings)
                .map_err(|e| AppError::new("CONFIG_SAVE_ERROR", e))?;
        } else {
            let mut current = manager.load_config();
            current.theme = settings.theme;
            current.category_cols = settings.category_cols;
            current.launcher_cols = settings.launcher_cols;
            current.toggle_shortcut = settings.toggle_shortcut;
            current.clipboard_shortcut = settings.clipboard_shortcut;
            current.follow_mouse_on_show = settings.follow_mouse_on_show;
            current.follow_mouse_y_anchor = settings.follow_mouse_y_anchor;
            current.clipboard_history_enabled = settings.clipboard_history_enabled;
            current.home_section_layouts = settings.home_section_layouts;
            current.clipboard_max_records = settings.clipboard_max_records;
            current.clipboard_max_image_size_mb = settings.clipboard_max_image_size_mb;
            current.clipboard_encrypted = settings.clipboard_encrypted;
            current.clipboard_storage_path = settings.clipboard_storage_path;
            current.backup_on_exit = settings.backup_on_exit;
            current.backup_frequency = settings.backup_frequency;
            current.backup_retention = settings.backup_retention;
            current.ai_organizer_base_url = settings.ai_organizer_base_url;
            current.ai_organizer_model = settings.ai_organizer_model;
            manager
                .save_config(&current)
                .map_err(|e| AppError::new("CONFIG_SAVE_ERROR", e))?;
        }
    }

    if let Some(launcher_data) = data.launcher_data {
        if !merge_mode {
            manager
                .save_launcher_data(&launcher_data)
                .map_err(|e| AppError::new("LAUNCHER_DATA_SAVE_ERROR", e))?;
        } else {
            let mut current = manager.load_launcher_data();
            for category in launcher_data.categories {
                if let Some(existing) = current.categories.iter_mut().find(|c| c.id == category.id)
                {
                    existing.name = category.name.clone();
                    existing.custom_icon_base64 = category.custom_icon_base64.clone();
                    for item in category.items {
                        if let Some(existing_item) =
                            existing.items.iter_mut().find(|i| i.id == item.id)
                        {
                            *existing_item = item;
                        } else {
                            existing.items.push(item);
                        }
                    }
                } else {
                    current.categories.push(category);
                }
            }
            for pinned_id in launcher_data.favorite_item_ids {
                if !current.favorite_item_ids.iter().any(|id| id == &pinned_id) {
                    current.favorite_item_ids.push(pinned_id);
                }
            }
            for recent_item in launcher_data.recent_used_items {
                if let Some(existing) = current.recent_used_items.iter_mut().find(|item| {
                    item.category_id == recent_item.category_id
                        && item.item_id == recent_item.item_id
                }) {
                    if recent_item.used_at > existing.used_at {
                        existing.used_at = recent_item.used_at;
                    }
                    if recent_item.usage_count > existing.usage_count {
                        existing.usage_count = recent_item.usage_count;
                    }
                } else {
                    current.recent_used_items.push(recent_item);
                }
            }
            manager
                .save_launcher_data(&current)
                .map_err(|e| AppError::new("LAUNCHER_DATA_SAVE_ERROR", e))?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn export_to_file(
    manager: tauri::State<'_, ConfigManager>,
    path: String,
    format: String,
    include_launcher_data: bool,
    include_settings: bool,
    include_plugins: bool,
) -> AppResult<()> {
    let data = export_data(
        manager,
        include_launcher_data,
        include_settings,
        include_plugins,
    )?;

    let path = PathBuf::from(&path);

    match format.as_str() {
        "json" => {
            let content = serde_json::to_string_pretty(&data)
                .map_err(|e| AppError::new("SERIALIZE_ERROR", e.to_string()))?;
            fs::write(&path, content).map_err(|e| AppError::io_error(e.to_string()))?;
        }
        "zip" => {
            use std::io::Write;
            let file = fs::File::create(&path).map_err(|e| AppError::io_error(e.to_string()))?;
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::FileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);

            let json_content = serde_json::to_string_pretty(&data)
                .map_err(|e| AppError::new("SERIALIZE_ERROR", e.to_string()))?;

            zip.start_file("export.json", options)
                .map_err(|e| AppError::new("ZIP_ERROR", e.to_string()))?;
            zip.write_all(json_content.as_bytes())
                .map_err(|e| AppError::new("ZIP_ERROR", e.to_string()))?;

            zip.finish()
                .map_err(|e| AppError::new("ZIP_ERROR", e.to_string()))?;
        }
        _ => {
            return Err(AppError::invalid_input(format!(
                "Unsupported format: {}",
                format
            )))
        }
    }

    Ok(())
}

#[tauri::command]
pub fn export_data_to_file(path: String, format: String, data: serde_json::Value) -> AppResult<()> {
    let path = PathBuf::from(&path);
    let mut data = data;
    redact_ai_organizer_api_key_in_json_export(&mut data);

    match format.as_str() {
        "json" => {
            let content = serde_json::to_string_pretty(&data)
                .map_err(|e| AppError::new("SERIALIZE_ERROR", e.to_string()))?;
            fs::write(&path, content).map_err(|e| AppError::io_error(e.to_string()))?;
        }
        "zip" => {
            use std::io::Write;
            let file = fs::File::create(&path).map_err(|e| AppError::io_error(e.to_string()))?;
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::FileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);

            let json_content = serde_json::to_string_pretty(&data)
                .map_err(|e| AppError::new("SERIALIZE_ERROR", e.to_string()))?;

            zip.start_file("export.json", options)
                .map_err(|e| AppError::new("ZIP_ERROR", e.to_string()))?;
            zip.write_all(json_content.as_bytes())
                .map_err(|e| AppError::new("ZIP_ERROR", e.to_string()))?;

            zip.finish()
                .map_err(|e| AppError::new("ZIP_ERROR", e.to_string()))?;
        }
        _ => {
            return Err(AppError::invalid_input(format!(
                "Unsupported format: {}",
                format
            )))
        }
    }

    Ok(())
}

#[tauri::command]
pub fn import_from_file(
    manager: tauri::State<'_, ConfigManager>,
    path: String,
    merge_mode: bool,
) -> AppResult<ExportData> {
    let path = PathBuf::from(&path);

    let data: ExportData = if path.extension().map(|e| e == "zip").unwrap_or(false) {
        let file = fs::File::open(&path).map_err(|e| AppError::io_error(e.to_string()))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| AppError::new("ZIP_ERROR", e.to_string()))?;

        let mut json_file = archive
            .by_name("export.json")
            .map_err(|e| AppError::new("ZIP_ERROR", format!("File not found in zip: {}", e)))?;

        let mut content = String::new();
        std::io::Read::read_to_string(&mut json_file, &mut content)
            .map_err(|e| AppError::io_error(e.to_string()))?;

        serde_json::from_str(&content).map_err(|e| AppError::new("PARSE_ERROR", e.to_string()))?
    } else {
        let content = fs::read_to_string(&path).map_err(|e| AppError::io_error(e.to_string()))?;
        serde_json::from_str(&content).map_err(|e| AppError::new("PARSE_ERROR", e.to_string()))?
    };

    import_data(manager, data.clone(), merge_mode)?;

    Ok(redacted_export_data(&data))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn create_test_manager(base: &Path) -> ConfigManager {
        ConfigManager {
            app_data_dir: base.to_path_buf(),
            config_path: base.join("config.json"),
            launcher_data_path: base.join("launcher_data.json"),
            backups_dir: base.join("backups"),
            runtime_ai_organizer_api_key: Arc::new(Mutex::new(String::new())),
        }
    }

    fn create_test_base(prefix: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "air-icon-launcher-test-{prefix}-{}-{}",
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
    fn deserialize_app_config_missing_fields_uses_defaults() {
        let json = r#"{"theme":"dark","clipboard_max_records":200}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.theme, "dark");
        assert_eq!(config.clipboard_max_records, 200);
        assert_eq!(config.toggle_shortcut, "alt+space");
        assert_eq!(config.clipboard_max_image_size_mb, 1.0);
        assert_eq!(config.backup_frequency, "none");
        assert_eq!(config.home_section_layouts.pinned.preset, "1x5");
        assert_eq!(config.home_section_layouts.recent.cols, 5);
    }

    #[test]
    fn load_config_invalid_file_is_backed_up_and_recreated() {
        let base = create_test_base("invalid-config");

        let config_path = base.join("config.json");
        std::fs::write(&config_path, "{ this is not json").unwrap();

        let manager = create_test_manager(&base);

        let loaded = manager.load_config();
        assert_eq!(loaded.theme, "system");
        assert!(manager.config_path.exists());

        let content = std::fs::read_to_string(&manager.config_path).unwrap();
        let reparsed: AppConfig = serde_json::from_str(&content).unwrap();
        assert_eq!(reparsed.theme, "system");

        let entries = std::fs::read_dir(&base).unwrap();
        let mut found_backup = false;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("config.bad.") && name.ends_with(".json") {
                found_backup = true;
                break;
            }
        }
        assert!(found_backup);

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn save_config_does_not_persist_ai_organizer_api_key() {
        let base = create_test_base("redact-config");
        let manager = create_test_manager(&base);

        let mut config = AppConfig::default();
        config.ai_organizer_api_key = "sk-test-secret".to_string();
        manager.save_config_with_runtime_ai_key(&config).unwrap();

        let raw = std::fs::read_to_string(manager.config_path()).unwrap();
        assert!(!raw.contains("sk-test-secret"));
        assert!(raw.contains("\"ai_organizer_api_key\": \"\""));

        let loaded = manager.load_config();
        assert_eq!(loaded.ai_organizer_api_key, "sk-test-secret");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn create_backup_does_not_include_ai_organizer_api_key() {
        let base = create_test_base("redact-backup");
        let manager = create_test_manager(&base);
        std::fs::create_dir_all(manager.get_backups_dir()).unwrap();

        manager.set_ai_organizer_api_key("sk-backup-secret");
        let mut config = AppConfig::default();
        manager.apply_runtime_ai_organizer_api_key(&mut config);
        let launcher_data = LauncherData::default();

        let backup_path = manager.create_backup(&config, &launcher_data).unwrap();
        let raw = std::fs::read_to_string(backup_path).unwrap();
        assert!(!raw.contains("sk-backup-secret"));
        assert!(raw.contains("\"ai_organizer_api_key\": \"\""));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn load_config_migrates_legacy_plaintext_ai_key_from_disk() {
        let base = create_test_base("legacy-ai-key");
        let manager = create_test_manager(&base);

        let mut legacy = AppConfig::default();
        legacy.ai_organizer_api_key = "sk-legacy".to_string();
        let raw = serde_json::to_string_pretty(&legacy).unwrap();
        std::fs::write(manager.config_path(), raw).unwrap();

        let loaded = manager.load_config();
        assert_eq!(loaded.ai_organizer_api_key, "sk-legacy");

        let migrated_raw = std::fs::read_to_string(manager.config_path()).unwrap();
        assert!(!migrated_raw.contains("sk-legacy"));
        assert!(migrated_raw.contains("\"ai_organizer_api_key\": \"\""));

        let _ = std::fs::remove_dir_all(&base);
    }
}
