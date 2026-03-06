use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub const CONFIG_VERSION: &str = "1.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub clipboard_max_records: usize,
    pub clipboard_max_image_size_mb: f64,
    pub clipboard_encrypted: bool,
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
            clipboard_max_records: 100,
            clipboard_max_image_size_mb: 1.0,
            clipboard_encrypted: false,
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

pub struct ConfigManager {
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
            config_path,
            launcher_data_path,
            backups_dir,
        }
    }
    
    pub fn load_config(&self) -> AppConfig {
        if !self.config_path.exists() {
            return AppConfig::default();
        }
        
        match fs::read_to_string(&self.config_path) {
            Ok(content) => {
                match serde_json::from_str::<AppConfig>(&content) {
                    Ok(config) => config,
                    Err(_) => AppConfig::default(),
                }
            }
            Err(_) => AppConfig::default(),
        }
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

#[tauri::command]
pub fn get_config(app: AppHandle) -> Result<AppConfig, String> {
    let manager = ConfigManager::new(&app);
    Ok(manager.load_config())
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    let manager = ConfigManager::new(&app);
    manager.save_config(&config)
}

#[tauri::command]
pub fn get_launcher_data(app: AppHandle) -> Result<LauncherData, String> {
    let manager = ConfigManager::new(&app);
    Ok(manager.load_launcher_data())
}

#[tauri::command]
pub fn save_launcher_data(app: AppHandle, data: LauncherData) -> Result<(), String> {
    let manager = ConfigManager::new(&app);
    manager.save_launcher_data(&data)
}

#[tauri::command]
pub fn create_backup(app: AppHandle) -> Result<String, String> {
    let manager = ConfigManager::new(&app);
    let config = manager.load_config();
    let launcher_data = manager.load_launcher_data();
    manager.create_backup(&config, &launcher_data)
}

#[tauri::command]
pub fn list_backups(app: AppHandle) -> Result<Vec<BackupInfo>, String> {
    let manager = ConfigManager::new(&app);
    manager.list_backups()
}

#[tauri::command]
pub fn restore_backup(app: AppHandle, filename: String) -> Result<serde_json::Value, String> {
    let manager = ConfigManager::new(&app);
    let (config, launcher_data) = manager.restore_backup(&filename)?;
    manager.save_config(&config)?;
    manager.save_launcher_data(&launcher_data)?;
    
    Ok(serde_json::json!({
        "settings": config,
        "launcher_data": launcher_data,
    }))
}

#[tauri::command]
pub fn delete_backup(app: AppHandle, filename: String) -> Result<(), String> {
    let manager = ConfigManager::new(&app);
    manager.delete_backup(&filename)
}

#[tauri::command]
pub fn export_data(
    app: AppHandle,
    include_launcher_data: bool,
    include_settings: bool,
    include_clipboard: bool,
    include_plugins: bool,
) -> Result<ExportData, String> {
    let manager = ConfigManager::new(&app);
    
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
    app: AppHandle,
    data: ExportData,
    merge_mode: bool,
) -> Result<(), String> {
    let manager = ConfigManager::new(&app);
    
    if let Some(settings) = data.settings {
        if !merge_mode {
            manager.save_config(&settings)?;
        } else {
            let mut current = manager.load_config();
            if settings.theme != "system" {
                current.theme = settings.theme;
            }
            manager.save_config(&current)?;
        }
    }
    
    if let Some(launcher_data) = data.launcher_data {
        if !merge_mode {
            manager.save_launcher_data(&launcher_data)?;
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
            manager.save_launcher_data(&current)?;
        }
    }
    
    Ok(())
}

#[tauri::command]
pub fn export_to_file(
    app: AppHandle,
    path: String,
    format: String,
    include_launcher_data: bool,
    include_settings: bool,
    include_clipboard: bool,
    include_plugins: bool,
) -> Result<(), String> {
    let data = export_data(
        app,
        include_launcher_data,
        include_settings,
        include_clipboard,
        include_plugins,
    )?;
    
    let path = PathBuf::from(&path);
    
    match format.as_str() {
        "json" => {
            let content = serde_json::to_string_pretty(&data)
                .map_err(|e| e.to_string())?;
            fs::write(&path, content)
                .map_err(|e| e.to_string())?;
        }
        "zip" => {
            use std::io::Write;
            let file = fs::File::create(&path)
                .map_err(|e| e.to_string())?;
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::FileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            
            let json_content = serde_json::to_string_pretty(&data)
                .map_err(|e| e.to_string())?;
            
            zip.start_file("export.json", options)
                .map_err(|e| e.to_string())?;
            zip.write_all(json_content.as_bytes())
                .map_err(|e| e.to_string())?;
            
            zip.finish()
                .map_err(|e| e.to_string())?;
        }
        _ => return Err("Unsupported format".to_string()),
    }
    
    Ok(())
}

#[tauri::command]
pub fn export_data_to_file(
    path: String,
    format: String,
    data: serde_json::Value,
) -> Result<(), String> {
    let path = PathBuf::from(&path);
    
    match format.as_str() {
        "json" => {
            let content = serde_json::to_string_pretty(&data)
                .map_err(|e| e.to_string())?;
            fs::write(&path, content)
                .map_err(|e| e.to_string())?;
        }
        "zip" => {
            use std::io::Write;
            let file = fs::File::create(&path)
                .map_err(|e| e.to_string())?;
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::FileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            
            let json_content = serde_json::to_string_pretty(&data)
                .map_err(|e| e.to_string())?;
            
            zip.start_file("export.json", options)
                .map_err(|e| e.to_string())?;
            zip.write_all(json_content.as_bytes())
                .map_err(|e| e.to_string())?;
            
            zip.finish()
                .map_err(|e| e.to_string())?;
        }
        _ => return Err("Unsupported format".to_string()),
    }
    
    Ok(())
}

#[tauri::command]
pub fn import_from_file(
    app: AppHandle,
    path: String,
    merge_mode: bool,
) -> Result<ExportData, String> {
    let path = PathBuf::from(&path);
    
    let data: ExportData = if path.extension().map(|e| e == "zip").unwrap_or(false) {
        let file = fs::File::open(&path)
            .map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| e.to_string())?;
        
        let mut json_file = archive.by_name("export.json")
            .map_err(|e| e.to_string())?;
        
        let mut content = String::new();
        std::io::Read::read_to_string(&mut json_file, &mut content)
            .map_err(|e| e.to_string())?;
        
        serde_json::from_str(&content)
            .map_err(|e| e.to_string())?
    } else {
        let content = fs::read_to_string(&path)
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&content)
            .map_err(|e| e.to_string())?
    };
    
    import_data(app.clone(), data.clone(), merge_mode)?;
    
    Ok(data)
}
