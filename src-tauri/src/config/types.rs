use serde::{Deserialize, Serialize};

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
    pub plugins: Option<Vec<PluginData>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginData {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub config: Option<serde_json::Value>,
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
