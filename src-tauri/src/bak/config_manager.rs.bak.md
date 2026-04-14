use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use crate::error::{AppError, AppResult};

pub const CONFIG\_VERSION: \&str = "1.0";

fn write\_atomically(path: \&Path, data: &\[u8]) -> Result<(), String> {
let temp\_path = path.with\_extension("tmp");
fs::write(\&temp\_path, data).map\_err(|e| e.to\_string())?;
fs::rename(\&temp\_path, path).map\_err(|e| e.to\_string())
}

\#\[derive(Debug, Clone, Serialize, Deserialize)]
\#\[serde(default)]
pub struct HomeSectionLayout {
pub preset: String,
pub rows: u32,
pub cols: u32,
}

impl Default for HomeSectionLayout {
fn default() -> Self {
Self {
preset: "1x5".to\_string(),
rows: 1,
cols: 5,
}
}
}

\#\[derive(Debug, Clone, Serialize, Deserialize)]
\#\[serde(default)]
pub struct HomeSectionLayouts {
pub pinned: HomeSectionLayout,
pub recent: HomeSectionLayout,
}

impl Default for HomeSectionLayouts {
fn default() -> Self {
Self {
pinned: HomeSectionLasave\_config\_cmdyout::default(),
recent: HomeSectionLayout::default(),
}
}
}

\#\[derive(Debug, Clone, Serialize, Deserialize)]
\#\[serde(default)]
pub struct AppConfig {
pub version: String,
pub theme: String,
pub category\_cols: u32,
pub launcher\_cols: u32,
pub toggle\_shortcut: String,
pub clipboard\_shortcut: String,
pub follow\_mouse\_on\_show: bool,
pub follow\_mouse\_y\_anchor: String,
pub clipboard\_history\_enabled: bool,
pub home\_section\_layouts: HomeSectionLayouts,
pub clipboard\_max\_records: usize,
pub clipboard\_max\_image\_size\_mb: f64,
pub clipboard\_encrypted: bool,
pub clipboard\_storage\_path: Option<String>,
pub backup\_on\_exit: bool,
pub backup\_frequency: String,
pub backup\_retention: usize,
}

impl Default for AppConfig {
fn default() -> Self {
Self {
version: CONFIG\_VERSION.to\_string(),
theme: "system".to\_string(),
category\_cols: 5,
launcher\_cols: 5,
toggle\_shortcut: "alt+space".to\_string(),
clipboard\_shortcut: "alt+v".to\_string(),
follow\_mouse\_on\_show: false,
follow\_mouse\_y\_anchor: "center".to\_string(),
clipboard\_history\_enabled: true,
home\_section\_layouts: HomeSectionLayouts::default(),
clipboard\_max\_records: 100,
clipboard\_max\_image\_size\_mb: 1.0,
clipboard\_encrypted: false,
clipboard\_storage\_path: None,
backup\_on\_exit: false,
backup\_frequency: "none".to\_string(),
backup\_retention: 10,
}
}
}

\#\[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherData {
pub version: String,
pub categories: Vec<CategoryData>,
pub favorite\_item\_ids: Vec<String>,
pub recent\_used\_items: Vec<RecentUsedItemData>,
}

impl Default for LauncherData {
fn default() -> Self {
Self {
version: CONFIG\_VERSION.to\_string(),
categories: Vec::new(),
favorite\_item\_ids: Vec::new(),
recent\_used\_items: Vec::new(),
}
}
}

\#\[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryData {
pub id: String,
pub name: String,
pub custom\_icon\_base64: Option<String>,
pub items: Vec<LauncherItemData>,
}

\#\[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherItemData {
pub id: String,
pub name: String,
pub path: String,
pub is\_directory: bool,
pub icon\_base64: Option<String>,
pub original\_icon\_base64: Option<String>,
pub is\_favorite: bool,
pub last\_used\_at: Option<u64>,
}

\#\[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentUsedItemData {
pub category\_id: String,
pub item\_id: String,
pub used\_at: u64,
}

\#\[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportData {
pub version: String,
pub export\_time: u64,
pub launcher\_data: Option<LauncherData>,
pub settings: Option<AppConfig>,
pub plugins: Option\<Vec<PluginData>>,
}

\#\[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginData {
pub id: String,
pub name: String,
pub enabled: bool,
pub config: Option\<serde\_json::Value>,
}

\#\[derive(Debug, Clone)]
pub struct ConfigManager {
app\_data\_dir: PathBuf,
config\_path: PathBuf,
launcher\_data\_path: PathBuf,
backups\_dir: PathBuf,
}

impl ConfigManager {
pub fn new(app\_handle: \&AppHandle) -> Self {
let app\_data\_dir = app\_handle
.path()
.app\_data\_dir()
.unwrap\_or\_else(|\_| std::env::temp\_dir());

```
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
    write_atomically(&self.config_path, content.as_bytes())
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
    write_atomically(&self.launcher_data_path, content.as_bytes())
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

    write_atomically(&backup_path, content.as_bytes())?;

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

#[allow(dead_code)]
pub fn cleanup_old_backups(&self, retention: usize) -> AppResult<()> {
    let backups = self.list_backups().map_err(|e| AppError::internal(e))?;

    if backups.len() > retention {
        let to_delete: Vec<_> = backups.into_iter().skip(retention).collect();
        for backup in to_delete {
            self.delete_backup(&backup.filename).map_err(|e| AppError::internal(e))?;
        }
    }

    Ok(())
}

pub fn get_backups_dir(&self) -> PathBuf {
    self.backups_dir.clone()
}
```

}

\#\[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupInfo {
pub filename: String,
pub path: String,
pub created\_at: u64,
pub size: u64,
}

\#\[derive(Debug, Clone, Serialize)]
pub struct ConfigPaths {
pub app\_data\_dir: String,
pub config\_path: String,
pub launcher\_data\_path: String,
pub backups\_dir: String,
}

/// 获取应用配置文件的实际路径信息。
\#\[tauri::command]
pub fn get\_config\_paths(manager: tauri::State<'\_, ConfigManager>) -> AppResult<ConfigPaths> {
Ok(ConfigPaths {
app\_data\_dir: manager.app\_data\_dir().to\_string\_lossy().to\_string(),
config\_path: manager.config\_path().to\_string\_lossy().to\_string(),
launcher\_data\_path: manager.launcher\_data\_path().to\_string\_lossy().to\_string(),
backups\_dir: manager.get\_backups\_dir().to\_string\_lossy().to\_string(),
})
}

/// 读取当前 config.json 的原始文本（用于诊断）。
\#\[tauri::command]
pub fn read\_raw\_config\_json(manager: tauri::State<'\_, ConfigManager>) -> AppResult<String> {
let path = manager.config\_path();
if !path.exists() {
return Err(AppError::not\_found(format!("config.json at {:?}", path)));
}
fs::read\_to\_string(\&path).map\_err(|e| AppError::io\_error(format!("Failed to read config.json: {}", e)))
}

\#\[tauri::command]
pub fn get\_config(manager: tauri::State<'\_, ConfigManager>) -> AppResult<AppConfig> {
Ok(manager.load\_config())
}

\#\[tauri::command]
pub fn save\_config(manager: tauri::State<'\_, ConfigManager>, config: AppConfig) -> AppResult<()> {
manager.save\_config(\&config).map\_err(|e| AppError::new("CONFIG\_SAVE\_ERROR", e))
}

\#\[tauri::command]
pub fn get\_launcher\_data(manager: tauri::State<'\_, ConfigManager>) -> AppResult<LauncherData> {
Ok(manager.load\_launcher\_data())
}

\#\[tauri::command]
pub fn save\_launcher\_data(manager: tauri::State<'\_, ConfigManager>, data: LauncherData) -> AppResult<()> {
manager.save\_launcher\_data(\&data).map\_err(|e| AppError::new("LAUNCHER\_DATA\_SAVE\_ERROR", e))
}

\#\[tauri::command]
pub fn create\_backup(manager: tauri::State<'\_, ConfigManager>) -> AppResult<String> {
let config = manager.load\_config();
let launcher\_data = manager.load\_launcher\_data();
manager.create\_backup(\&config, \&launcher\_data).map\_err(|e| AppError::new("BACKUP\_ERROR", e))
}

\#\[tauri::command]
pub fn list\_backups(manager: tauri::State<'\_, ConfigManager>) -> AppResult\<Vec<BackupInfo>> {
manager.list\_backups().map\_err(|e| AppError::new("LIST\_BACKUPS\_ERROR", e))
}

\#\[tauri::command]
pub fn restore\_backup(manager: tauri::State<'\_, ConfigManager>, filename: String) -> AppResult\<serde\_json::Value> {
let (config, launcher\_data) = manager.restore\_backup(\&filename).map\_err(|e| AppError::new("RESTORE\_BACKUP\_ERROR", e))?;
manager.save\_config(\&config).map\_err(|e| AppError::new("CONFIG\_SAVE\_ERROR", e))?;
manager.save\_launcher\_data(\&launcher\_data).map\_err(|e| AppError::new("LAUNCHER\_DATA\_SAVE\_ERROR", e))?;

```
Ok(serde_json::json!({
    "settings": config,
    "launcher_data": launcher_data,
}))
```

}

\#\[tauri::command]
pub fn delete\_backup(manager: tauri::State<'\_, ConfigManager>, filename: String) -> AppResult<()> {
manager.delete\_backup(\&filename).map\_err(|e| AppError::new("DELETE\_BACKUP\_ERROR", e))
}

\#\[tauri::command]
pub fn export\_data(
manager: tauri::State<'\_, ConfigManager>,
include\_launcher\_data: bool,
include\_settings: bool,
include\_plugins: bool,
) -> AppResult<ExportData> {
let export\_time = std::time::SystemTime::now()
.duration\_since(std::time::UNIX\_EPOCH)
.map(|d| d.as\_secs())
.unwrap\_or(0);

```
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
```

}

\#\[tauri::command]
pub fn import\_data(
manager: tauri::State<'\_, ConfigManager>,
data: ExportData,
merge\_mode: bool,
) -> AppResult<()> {
if let Some(settings) = data.settings {
if !merge\_mode {
manager.save\_config(\&settings).map\_err(|e| AppError::new("CONFIG\_SAVE\_ERROR", e))?;
} else {
let mut current = manager.load\_config();
current.theme = settings.theme;
current.category\_cols = settings.category\_cols;
current.launcher\_cols = settings.launcher\_cols;
current.toggle\_shortcut = settings.toggle\_shortcut;
current.clipboard\_shortcut = settings.clipboard\_shortcut;
current.follow\_mouse\_on\_show = settings.follow\_mouse\_on\_show;
current.follow\_mouse\_y\_anchor = settings.follow\_mouse\_y\_anchor;
current.clipboard\_history\_enabled = settings.clipboard\_history\_enabled;
current.home\_section\_layouts = settings.home\_section\_layouts;
current.clipboard\_max\_records = settings.clipboard\_max\_records;
current.clipboard\_max\_image\_size\_mb = settings.clipboard\_max\_image\_size\_mb;
current.clipboard\_encrypted = settings.clipboard\_encrypted;
current.clipboard\_storage\_path = settings.clipboard\_storage\_path;
current.backup\_on\_exit = settings.backup\_on\_exit;
current.backup\_frequency = settings.backup\_frequency;
current.backup\_retention = settings.backup\_retention;
manager.save\_config(\&current).map\_err(|e| AppError::new("CONFIG\_SAVE\_ERROR", e))?;
}
}

```
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
        for pinned_id in launcher_data.favorite_item_ids {
            if !current.favorite_item_ids.iter().any(|id| id == &pinned_id) {
                current.favorite_item_ids.push(pinned_id);
            }
        }
        for recent_item in launcher_data.recent_used_items {
            if let Some(existing) = current
                .recent_used_items
                .iter_mut()
                .find(|item| item.category_id == recent_item.category_id && item.item_id == recent_item.item_id)
            {
                if recent_item.used_at > existing.used_at {
                    existing.used_at = recent_item.used_at;
                }
            } else {
                current.recent_used_items.push(recent_item);
            }
        }
        manager.save_launcher_data(&current).map_err(|e| AppError::new("LAUNCHER_DATA_SAVE_ERROR", e))?;
    }
}

Ok(())
```

}

\#\[tauri::command]
pub fn export\_to\_file(
manager: tauri::State<'\_, ConfigManager>,
path: String,
format: String,
include\_launcher\_data: bool,
include\_settings: bool,
include\_plugins: bool,
) -> AppResult<()> {
let data = export\_data(
manager,
include\_launcher\_data,
include\_settings,
include\_plugins,
)?;

```
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
```

}

\#\[tauri::command]
pub fn export\_data\_to\_file(
path: String,
format: String,
data: serde\_json::Value,
) -> AppResult<()> {
let path = PathBuf::from(\&path);

```
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
```

}

\#\[tauri::command]
pub fn import\_from\_file(
manager: tauri::State<'\_, ConfigManager>,
path: String,
merge\_mode: bool,
) -> AppResult<ExportData> {
let path = PathBuf::from(\&path);

```
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
```

}

\#\[cfg(test)]
mod tests {
use super::\*;

```
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
```

}
