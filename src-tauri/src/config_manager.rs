use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use crate::error::{AppError, AppResult};

pub const CONFIG_VERSION: &str = "1.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct HomeSectionLayout {
    pub preset: String,
    pub rows: u32,
    pub cols: u32,
}

impl Default for HomeSectionLayout {
    fn default() -> Self {
        Self {
            preset: "1x5".to_string(),
            rows: 1,
            cols: 5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct HomeSectionLayouts {
    pub pinned: HomeSectionLayout,
    pub recent: HomeSectionLayout,
}

impl Default for HomeSectionLayouts {
    fn default() -> Self {
        Self {
            pinned: HomeSectionLayout::default(),
            recent: HomeSectionLayout::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub version: String,
    pub theme: String,
    pub category_cols: u32,
    pub launcher_cols: u32,
    pub toggle_shortcut: String,
    pub clipboard_shortcut: String,
    pub follow_mouse_on_show: bool,
    pub follow_mouse_y_anchor: String,
    pub clipboard_history_enabled: bool,
    pub home_section_layouts: HomeSectionLayouts,
    pub clipboard_max_records: usize,
    pub clipboard_max_image_size_mb: f64,
    pub clipboard_encrypted: bool,
    pub clipboard_storage_path: Option<String>,
    pub backup_on_exit: bool,
    pub backup_frequency: String,
    pub backup_retention: usize,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION.to_string(),
            theme: "system".to_string(),
            category_cols: 5,
            launcher_cols: 5,
            toggle_shortcut: "alt+space".to_string(),
            clipboard_shortcut: "alt+v".to_string(),
            follow_mouse_on_show: false,
            follow_mouse_y_anchor: "center".to_string(),
            clipboard_history_enabled: true,
            home_section_layouts: HomeSectionLayouts::default(),
            clipboard_max_records: 100,
            clipboard_max_image_size_mb: 1.0,
            clipboard_encrypted: false,
            clipboard_storage_path: None,
            backup_on_exit: false,
            backup_frequency: "none".to_string(),
            backup_retention: 10,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherData {
    pub version: String,
    pub categories: Vec<CategoryData>,
    pub favorite_item_ids: Vec<String>,
    pub recent_used_items: Vec<RecentUsedItemData>,
}

impl Default for LauncherData {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION.to_string(),
            categories: Vec::new(),
            favorite_item_ids: Vec::new(),
            recent_used_items: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryData {
    pub id: String,
    pub name: String,
    pub custom_icon_base64: Option<String>,
    pub items: Vec<LauncherItemData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherItemData {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub icon_base64: Option<String>,
    pub original_icon_base64: Option<String>,
    pub is_favorite: bool,
    pub last_used_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentUsedItemData {
    pub category_id: String,
    pub item_id: String,
    pub used_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportData {
    pub version: String,
    pub export_time: u64,
    pub launcher_data: Option<LauncherData>,
    pub settings: Option<AppConfig>,
    pub clipboard_history: Option<Vec<ClipboardRecordData>>,
    pub plugins: Option<Vec<PluginData>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardRecordData {
    pub id: String,
    pub content: String,
    pub record_type: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginData {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub config: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct ConfigManager {
    app_data_dir: PathBuf,
    config_path: PathBuf,
    launcher_data_path: PathBuf,
    backups_dir: PathBuf,
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
        
        let _ = fs::create_dir_all(&backups_dir);
        
        Self {
            app_data_dir,
            config_path,
            launcher_data_path,
            backups_dir,
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
    
    pub fn load_config(&self) -> AppConfig {
        if !self.config_path.exists() {
            return AppConfig::default();
        }
        
        match fs::read_to_string(&self.config_path) {
            Ok(content) => {
                match serde_json::from_str::<AppConfig>(&content) {
                    Ok(config) => config,
                    Err(e) => {
                        eprintln!(
                            "Failed to parse config file ({}): {}",
                            self.config_path.to_string_lossy(),
                            e
                        );
                        let _ = self.backup_bad_config_file();
                        let default_config = AppConfig::default();
                        let _ = self.save_config(&default_config);
                        default_config
                    }
                }
            }
            Err(e) => {
                eprintln!(
                    "Failed to read config file ({}): {}",
                    self.config_path.to_string_lossy(),
                    e
                );
                AppConfig::default()
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
        let content = serde_json::to_string_pretty(config)
            .map_err(|e| e.to_string())?;
        fs::write(&self.config_path, content)
            .map_err(|e| e.to_string())
    }
    
    pub fn load_launcher_data(&self) -> LauncherData {
        if !self.launcher_data_path.exists() {
            return LauncherData::default();
        }
        
        match fs::read_to_string(&self.launcher_data_path) {
            Ok(content) => {
                match serde_json::from_str::<LauncherData>(&content) {
                    Ok(data) => data,
                    Err(_) => LauncherData::default(),
                }
            }
            Err(_) => LauncherData::default(),
        }
    }
    
    pub fn save_launcher_data(&self, data: &LauncherData) -> Result<(), String> {
        let content = serde_json::to_string_pretty(data)
            .map_err(|e| e.to_string())?;
        fs::write(&self.launcher_data_path, content)
            .map_err(|e| e.to_string())
    }
    
    pub fn create_backup(&self, config: &AppConfig, launcher_data: &LauncherData) -> Result<String, String> {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        
        let backup_name = format!("backup_{}.json", timestamp);
        let backup_path = self.backups_dir.join(&backup_name);
        
        let backup_data = serde_json::json!({
            "version": CONFIG_VERSION,
            "backup_time": timestamp,
            "config": config,
            "launcher_data": launcher_data,
        });
        
        let content = serde_json::to_string_pretty(&backup_data)
            .map_err(|e| e.to_string())?;
        
        fs::write(&backup_path, &content)
            .map_err(|e| e.to_string())?;
        
        Ok(backup_path.to_string_lossy().to_string())
    }
    
    pub fn list_backups(&self) -> Result<Vec<BackupInfo>, String> {
        let mut backups = Vec::new();
        
        let entries = fs::read_dir(&self.backups_dir)
            .map_err(|e| e.to_string())?;
        
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.extension().map(|e| e == "json").unwrap_or(false) {
                    if let Some(name) = path.file_name() {
                        if let Some(name_str) = name.to_str() {
                            if name_str.starts_with("backup_") {
                                if let Ok(metadata) = entry.metadata() {
                                    let created = metadata.created()
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
        
        let content = fs::read_to_string(&backup_path)
            .map_err(|e| e.to_string())?;
        
        let backup: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| e.to_string())?;
        
        let config: AppConfig = backup.get("config")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        
        let launcher_data: LauncherData = backup.get("launcher_data")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        
        Ok((config, launcher_data))
    }
    
    pub fn delete_backup(&self, filename: &str) -> Result<(), String> {
        let backup_path = self.backups_dir.join(filename);
        fs::remove_file(&backup_path)
            .map_err(|e| e.to_string())
    }
    
    pub fn cleanup_old_backups(&self, retention: usize) -> Result<(), String> {
        let mut backups = self.list_backups()?;
        
        if backups.len() > retention {
            backups.truncate(retention);
            for backup in backups.into_iter().skip(retention) {
                let _ = self.delete_backup(&backup.filename);
            }
        }
        
        Ok(())
    }
    
    pub fn get_backups_dir(&self) -> PathBuf {
        self.backups_dir.clone()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupInfo {
    pub filename: String,
    pub path: String,
    pub created_at: u64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConfigPaths {
    pub app_data_dir: String,
    pub config_path: String,
    pub launcher_data_path: String,
    pub backups_dir: String,
}

/// 获取应用配置文件的实际路径信息。
#[tauri::command]
pub fn get_config_paths(manager: tauri::State<'_, ConfigManager>) -> AppResult<ConfigPaths> {
    Ok(ConfigPaths {
        app_data_dir: manager.app_data_dir().to_string_lossy().to_string(),
        config_path: manager.config_path().to_string_lossy().to_string(),
        launcher_data_path: manager.launcher_data_path().to_string_lossy().to_string(),
        backups_dir: manager.get_backups_dir().to_string_lossy().to_string(),
    })
}

/// 读取当前 config.json 的原始文本（用于诊断）。
#[tauri::command]
pub fn read_raw_config_json(manager: tauri::State<'_, ConfigManager>) -> AppResult<String> {
    let path = manager.config_path();
    if !path.exists() {
        return Err(AppError::not_found(format!("config.json at {:?}", path)));
    }
    fs::read_to_string(&path).map_err(|e| AppError::io_error(format!("Failed to read config.json: {}", e)))
}

#[tauri::command]
pub fn get_config(manager: tauri::State<'_, ConfigManager>) -> AppResult<AppConfig> {
    Ok(manager.load_config())
}

#[tauri::command]
pub fn save_config(manager: tauri::State<'_, ConfigManager>, config: AppConfig) -> AppResult<()> {
    manager.save_config(&config).map_err(|e| AppError::new("CONFIG_SAVE_ERROR", e))
}

#[tauri::command]
pub fn get_launcher_data(manager: tauri::State<'_, ConfigManager>) -> AppResult<LauncherData> {
    Ok(manager.load_launcher_data())
}

#[tauri::command]
pub fn save_launcher_data(manager: tauri::State<'_, ConfigManager>, data: LauncherData) -> AppResult<()> {
    manager.save_launcher_data(&data).map_err(|e| AppError::new("LAUNCHER_DATA_SAVE_ERROR", e))
}

#[tauri::command]
pub fn create_backup(manager: tauri::State<'_, ConfigManager>) -> AppResult<String> {
    let config = manager.load_config();
    let launcher_data = manager.load_launcher_data();
    manager.create_backup(&config, &launcher_data).map_err(|e| AppError::new("BACKUP_ERROR", e))
}

#[tauri::command]
pub fn list_backups(manager: tauri::State<'_, ConfigManager>) -> AppResult<Vec<BackupInfo>> {
    manager.list_backups().map_err(|e| AppError::new("LIST_BACKUPS_ERROR", e))
}

#[tauri::command]
pub fn restore_backup(manager: tauri::State<'_, ConfigManager>, filename: String) -> AppResult<serde_json::Value> {
    let (config, launcher_data) = manager.restore_backup(&filename).map_err(|e| AppError::new("RESTORE_BACKUP_ERROR", e))?;
    manager.save_config(&config).map_err(|e| AppError::new("CONFIG_SAVE_ERROR", e))?;
    manager.save_launcher_data(&launcher_data).map_err(|e| AppError::new("LAUNCHER_DATA_SAVE_ERROR", e))?;

    Ok(serde_json::json!({
        "settings": config,
        "launcher_data": launcher_data,
    }))
}

#[tauri::command]
pub fn delete_backup(manager: tauri::State<'_, ConfigManager>, filename: String) -> AppResult<()> {
    manager.delete_backup(&filename).map_err(|e| AppError::new("DELETE_BACKUP_ERROR", e))
}

#[tauri::command]
pub fn export_data(
    manager: tauri::State<'_, ConfigManager>,
    include_launcher_data: bool,
    include_settings: bool,
    include_clipboard: bool,
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
        Some(manager.load_config())
    } else {
        None
    };

    let clipboard_history = if include_clipboard {
        None
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
        clipboard_history,
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
        if !merge_mode {
            manager.save_config(&settings).map_err(|e| AppError::new("CONFIG_SAVE_ERROR", e))?;
        } else {
            let mut current = manager.load_config();
            if settings.theme != "system" {
                current.theme = settings.theme;
            }
            manager.save_config(&current).map_err(|e| AppError::new("CONFIG_SAVE_ERROR", e))?;
        }
    }

    if let Some(launcher_data) = data.launcher_data {
        if !merge_mode {
            manager.save_launcher_data(&launcher_data).map_err(|e| AppError::new("LAUNCHER_DATA_SAVE_ERROR", e))?;
        } else {
            let mut current = manager.load_launcher_data();
            for category in launcher_data.categories {
                if let Some(existing) = current.categories.iter_mut().find(|c| c.id == category.id) {
                    for item in category.items {
                        if !existing.items.iter().any(|i| i.id == item.id) {
                            existing.items.push(item);
                        }
                    }
                } else {
                    current.categories.push(category);
                }
            }
            manager.save_launcher_data(&current).map_err(|e| AppError::new("LAUNCHER_DATA_SAVE_ERROR", e))?;
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
    include_clipboard: bool,
    include_plugins: bool,
) -> AppResult<()> {
    let data = export_data(
        manager,
        include_launcher_data,
        include_settings,
        include_clipboard,
        include_plugins,
    )?;

    let path = PathBuf::from(&path);

    match format.as_str() {
        "json" => {
            let content = serde_json::to_string_pretty(&data)
                .map_err(|e| AppError::new("SERIALIZE_ERROR", e.to_string()))?;
            fs::write(&path, content)
                .map_err(|e| AppError::io_error(e.to_string()))?;
        }
        "zip" => {
            use std::io::Write;
            let file = fs::File::create(&path)
                .map_err(|e| AppError::io_error(e.to_string()))?;
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
        _ => return Err(AppError::invalid_input(format!("Unsupported format: {}", format))),
    }

    Ok(())
}

#[tauri::command]
pub fn export_data_to_file(
    path: String,
    format: String,
    data: serde_json::Value,
) -> AppResult<()> {
    let path = PathBuf::from(&path);

    match format.as_str() {
        "json" => {
            let content = serde_json::to_string_pretty(&data)
                .map_err(|e| AppError::new("SERIALIZE_ERROR", e.to_string()))?;
            fs::write(&path, content)
                .map_err(|e| AppError::io_error(e.to_string()))?;
        }
        "zip" => {
            use std::io::Write;
            let file = fs::File::create(&path)
                .map_err(|e| AppError::io_error(e.to_string()))?;
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
        _ => return Err(AppError::invalid_input(format!("Unsupported format: {}", format))),
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
        let file = fs::File::open(&path)
            .map_err(|e| AppError::io_error(e.to_string()))?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| AppError::new("ZIP_ERROR", e.to_string()))?;

        let mut json_file = archive.by_name("export.json")
            .map_err(|e| AppError::new("ZIP_ERROR", format!("File not found in zip: {}", e)))?;

        let mut content = String::new();
        std::io::Read::read_to_string(&mut json_file, &mut content)
            .map_err(|e| AppError::io_error(e.to_string()))?;

        serde_json::from_str(&content)
            .map_err(|e| AppError::new("PARSE_ERROR", e.to_string()))?
    } else {
        let content = fs::read_to_string(&path)
            .map_err(|e| AppError::io_error(e.to_string()))?;
        serde_json::from_str(&content)
            .map_err(|e| AppError::new("PARSE_ERROR", e.to_string()))?
    };
    
    import_data(manager, data.clone(), merge_mode)?;
    
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let base = std::env::temp_dir().join(format!(
            "air-icon-launcher-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&base).unwrap();

        let config_path = base.join("config.json");
        fs::write(&config_path, "{ this is not json").unwrap();

        let manager = ConfigManager {
            app_data_dir: base.clone(),
            config_path: config_path.clone(),
            launcher_data_path: base.join("launcher_data.json"),
            backups_dir: base.join("backups"),
        };

        let loaded = manager.load_config();
        assert_eq!(loaded.theme, "system");
        assert!(manager.config_path.exists());

        let content = fs::read_to_string(&manager.config_path).unwrap();
        let reparsed: AppConfig = serde_json::from_str(&content).unwrap();
        assert_eq!(reparsed.theme, "system");

        let entries = fs::read_dir(&base).unwrap();
        let mut found_backup = false;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("config.bad.") && name.ends_with(".json") {
                found_backup = true;
                break;
            }
        }
        assert!(found_backup);

        let _ = fs::remove_dir_all(&base);
    }
}
