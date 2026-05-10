pub mod types;

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
pub use types::*;

pub const CONFIG_VERSION: &str = "1.0";
const AI_ORGANIZER_API_KEY_ENV_VAR: &str = "AIR_ICON_LAUNCHER_AI_API_KEY";

fn write_json_pretty_atomically<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let temp_path = path.with_extension("tmp");
    let result = (|| {
        let file = fs::File::create(&temp_path).map_err(|e| e.to_string())?;
        let mut writer = BufWriter::new(file);
        serde_json::to_writer_pretty(&mut writer, value).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())
    })();

    if let Err(err) = result {
        let _ = fs::remove_file(&temp_path);
        return Err(err);
    }

    fs::rename(&temp_path, path).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        e.to_string()
    })
}

fn write_json_pretty_to_file<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let file = fs::File::create(path).map_err(|e| AppError::io_error(e.to_string()))?;
    let mut writer = BufWriter::new(file);
    serde_json::to_writer_pretty(&mut writer, value)
        .map_err(|e| AppError::new("SERIALIZE_ERROR", e.to_string()))?;
    writer
        .flush()
        .map_err(|e| AppError::io_error(e.to_string()))
}

fn release_operation_memory() {
    release_operation_memory_impl();
}

#[cfg(target_os = "windows")]
fn release_operation_memory_impl() {
    use windows::Win32::System::Memory::{GetProcessHeap, HeapCompact, HEAP_FLAGS};
    use windows::Win32::System::ProcessStatus::EmptyWorkingSet;
    use windows::Win32::System::Threading::GetCurrentProcess;

    unsafe {
        if let Ok(heap) = GetProcessHeap() {
            let _ = HeapCompact(heap, HEAP_FLAGS(0));
        }
        let _ = EmptyWorkingSet(GetCurrentProcess());
    }
}

#[cfg(not(target_os = "windows"))]
fn release_operation_memory_impl() {}

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

fn insert_config_value_if_missing<T: serde::Serialize>(
    config: &mut serde_json::Map<String, serde_json::Value>,
    field: &str,
    aliases: &[&str],
    value: T,
) -> Result<(), String> {
    if aliases.iter().any(|alias| config.contains_key(*alias)) {
        return Ok(());
    }

    let serialized = serde_json::to_value(value).map_err(|e| e.to_string())?;
    config.insert(field.to_string(), serialized);
    Ok(())
}

fn preserve_missing_imported_config_fields(
    config_value: &mut serde_json::Value,
    current: &AppConfig,
) -> Result<(), String> {
    let Some(config) = config_value.as_object_mut() else {
        return Ok(());
    };

    insert_config_value_if_missing(
        config,
        "ctrl_drag_enabled",
        &["ctrl_drag_enabled", "ctrlDragEnabled"],
        current.ctrl_drag_enabled,
    )?;
    insert_config_value_if_missing(
        config,
        "auto_hide_after_launch",
        &["auto_hide_after_launch", "autoHideAfterLaunch"],
        current.auto_hide_after_launch,
    )?;
    insert_config_value_if_missing(
        config,
        "show_guide_on_startup",
        &["show_guide_on_startup", "showGuideOnStartup"],
        current.show_guide_on_startup,
    )?;
    insert_config_value_if_missing(
        config,
        "hide_on_ctrl_right_click",
        &["hide_on_ctrl_right_click", "hideOnCtrlRightClick"],
        current.hide_on_ctrl_right_click,
    )?;
    insert_config_value_if_missing(
        config,
        "corner_hotspot_enabled",
        &["corner_hotspot_enabled", "cornerHotspotEnabled"],
        current.corner_hotspot_enabled,
    )?;
    insert_config_value_if_missing(
        config,
        "corner_hotspot_position",
        &["corner_hotspot_position", "cornerHotspotPosition"],
        current.corner_hotspot_position.as_str(),
    )?;
    insert_config_value_if_missing(
        config,
        "corner_hotspot_sensitivity",
        &["corner_hotspot_sensitivity", "cornerHotspotSensitivity"],
        current.corner_hotspot_sensitivity.as_str(),
    )?;
    insert_config_value_if_missing(
        config,
        "performance_mode",
        &["performance_mode", "performanceMode"],
        current.performance_mode,
    )?;
    insert_config_value_if_missing(
        config,
        "window_effect_type",
        &["window_effect_type", "windowEffectType"],
        current.window_effect_type.as_str(),
    )?;
    insert_config_value_if_missing(
        config,
        "strong_shortcut_mode",
        &["strong_shortcut_mode", "strongShortcutMode"],
        current.strong_shortcut_mode,
    )?;
    insert_config_value_if_missing(
        config,
        "auto_hide_countdown_seconds",
        &["auto_hide_countdown_seconds", "autoHideCountdownSeconds"],
        current.auto_hide_countdown_seconds,
    )?;
    insert_config_value_if_missing(
        config,
        "auto_hide_enabled",
        &["auto_hide_enabled", "autoHideEnabled"],
        current.auto_hide_enabled,
    )?;
    insert_config_value_if_missing(
        config,
        "plugin_sandbox_enabled",
        &["plugin_sandbox_enabled", "pluginSandboxEnabled"],
        current.plugin_sandbox_enabled,
    )?;

    Ok(())
}

#[derive(Deserialize)]
struct RawExportData {
    version: String,
    export_time: u64,
    launcher_data: Option<LauncherData>,
    settings: Option<serde_json::Value>,
    plugins: Option<Vec<PluginData>>,
}

fn export_data_from_raw(
    mut raw: RawExportData,
    current_config: &AppConfig,
) -> AppResult<ExportData> {
    if let Some(settings) = raw.settings.as_mut() {
        preserve_missing_imported_config_fields(settings, current_config)
            .map_err(|e| AppError::new("PARSE_ERROR", e))?;
    }

    let settings = raw
        .settings
        .map(serde_json::from_value)
        .transpose()
        .map_err(|e| AppError::new("PARSE_ERROR", e.to_string()))?;

    Ok(ExportData {
        version: raw.version,
        export_time: raw.export_time,
        launcher_data: raw.launcher_data,
        settings,
        plugins: raw.plugins,
    })
}

fn deserialize_export_data_reader_with_current_config<R: Read>(
    reader: R,
    current_config: &AppConfig,
) -> AppResult<ExportData> {
    let raw: RawExportData =
        serde_json::from_reader(reader).map_err(|e| AppError::new("PARSE_ERROR", e.to_string()))?;
    export_data_from_raw(raw, current_config)
}

#[cfg(test)]
fn deserialize_export_data_with_current_config(
    content: &str,
    current_config: &AppConfig,
) -> AppResult<ExportData> {
    let raw: RawExportData =
        serde_json::from_str(content).map_err(|e| AppError::new("PARSE_ERROR", e.to_string()))?;
    export_data_from_raw(raw, current_config)
}

fn apply_app_config_patch(config: &mut AppConfig, patch: AppConfigPatch) {
    if let Some(value) = patch.theme {
        config.theme = value;
    }
    if let Some(value) = patch.category_cols {
        config.category_cols = value;
    }
    if let Some(value) = patch.launcher_cols {
        config.launcher_cols = value;
    }
    if let Some(value) = patch.home_section_layouts {
        config.home_section_layouts = value;
    }
    if let Some(value) = patch.toggle_shortcut {
        config.toggle_shortcut = value;
    }
    if let Some(value) = patch.clipboard_shortcut {
        config.clipboard_shortcut = value;
    }
    if let Some(value) = patch.display_shortcut {
        config.display_shortcut = value;
    }
    if let Some(value) = patch.follow_mouse_on_show {
        config.follow_mouse_on_show = value;
    }
    if let Some(value) = patch.follow_mouse_y_anchor {
        config.follow_mouse_y_anchor = value;
    }
    if let Some(value) = patch.ctrl_drag_enabled {
        config.ctrl_drag_enabled = value;
    }
    if let Some(value) = patch.auto_hide_after_launch {
        config.auto_hide_after_launch = value;
    }
    if let Some(value) = patch.show_guide_on_startup {
        config.show_guide_on_startup = value;
    }
    if let Some(value) = patch.hide_on_ctrl_right_click {
        config.hide_on_ctrl_right_click = value;
    }
    if let Some(value) = patch.corner_hotspot_enabled {
        config.corner_hotspot_enabled = value;
    }
    if let Some(value) = patch.corner_hotspot_position {
        config.corner_hotspot_position = value;
    }
    if let Some(value) = patch.corner_hotspot_sensitivity {
        config.corner_hotspot_sensitivity = value;
    }
    if let Some(value) = patch.performance_mode {
        config.performance_mode = value;
    }
    if let Some(value) = patch.window_effect_type {
        config.window_effect_type = value;
    }
    if let Some(value) = patch.strong_shortcut_mode {
        config.strong_shortcut_mode = value;
    }
    if let Some(value) = patch.auto_hide_countdown_seconds {
        config.auto_hide_countdown_seconds = value;
    }
    if let Some(value) = patch.auto_hide_enabled {
        config.auto_hide_enabled = value;
    }
    if let Some(value) = patch.plugin_sandbox_enabled {
        config.plugin_sandbox_enabled = value;
    }
    if let Some(value) = patch.clipboard_history_enabled {
        config.clipboard_history_enabled = value;
    }
    if let Some(value) = patch.ai_organizer_base_url {
        config.ai_organizer_base_url = value;
    }
    if let Some(value) = patch.ai_organizer_model {
        config.ai_organizer_model = value;
    }
    if let Some(value) = patch.ai_organizer_api_key {
        config.ai_organizer_api_key = value;
    }
}

fn normalize_optional_string_field(value: &mut Option<String>) {
    let normalized = value
        .as_ref()
        .map(|current| current.trim())
        .filter(|current| !current.is_empty())
        .map(|current| current.to_string());
    *value = normalized;
}

fn sanitize_launcher_item(item: &mut LauncherItemData) {
    item.item_type = if item.item_type.trim().eq_ignore_ascii_case("url") {
        "url".to_string()
    } else {
        "file".to_string()
    };

    normalize_optional_string_field(&mut item.icon_base64);
    normalize_optional_string_field(&mut item.original_icon_base64);

    let legacy_has_custom_icon = match &item.original_icon_base64 {
        Some(original_icon) => item.icon_base64.as_ref() != Some(original_icon),
        None => false,
    };
    item.has_custom_icon = item.has_custom_icon || legacy_has_custom_icon;

    if item.item_type == "file" && !item.has_custom_icon {
        item.icon_base64 = None;
    }

    item.original_icon_base64 = None;
}

fn sanitize_launcher_data(mut launcher_data: LauncherData) -> LauncherData {
    let mut item_ids = HashSet::new();
    let mut item_refs = HashSet::new();

    for category in &mut launcher_data.categories {
        if category.id.trim().is_empty() {
            continue;
        }

        for item in &mut category.items {
            sanitize_launcher_item(item);
            if item.id.trim().is_empty() {
                continue;
            }

            item_ids.insert(item.id.clone());
            item_refs.insert(format!("{}:{}", category.id, item.id));
        }
    }

    launcher_data
        .favorite_item_ids
        .retain(|item_id| item_ids.contains(item_id));
    launcher_data.recent_used_items.retain(|item| {
        if item.category_id.trim().is_empty() || item.item_id.trim().is_empty() {
            return false;
        }

        item_refs.contains(&format!("{}:{}", item.category_id, item.item_id))
    });

    launcher_data
}

fn current_export_data(manager: &ConfigManager) -> ExportData {
    let export_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    ExportData {
        version: CONFIG_VERSION.to_string(),
        export_time,
        launcher_data: Some(sanitize_launcher_data(manager.load_launcher_data())),
        settings: Some(redacted_config(&manager.load_config())),
        plugins: None,
    }
}

fn restore_persisted_snapshot(
    manager: &ConfigManager,
    config: &AppConfig,
    launcher_data: &LauncherData,
    app_handle: Option<&AppHandle>,
    clipboard_state: Option<&Arc<crate::clipboard::ClipboardState>>,
) -> Result<(), String> {
    manager.save_config_with_runtime_ai_key(config)?;
    manager.save_launcher_data(launcher_data)?;

    if let (Some(app_handle), Some(clipboard_state)) = (app_handle, clipboard_state) {
        crate::clipboard::sync_runtime_config_from_app_config(app_handle, clipboard_state, config)?;
        crate::clipboard::apply_monitoring_state_from_app_config(
            app_handle,
            clipboard_state,
            config,
        );
    }

    Ok(())
}

fn sync_runtime_state_after_import(
    manager: &ConfigManager,
    app_handle: Option<&AppHandle>,
    clipboard_state: Option<&Arc<crate::clipboard::ClipboardState>>,
) -> Result<(), String> {
    if let (Some(app_handle), Some(clipboard_state)) = (app_handle, clipboard_state) {
        let config = manager.load_config();
        crate::clipboard::sync_runtime_config_from_app_config(
            app_handle,
            clipboard_state,
            &config,
        )?;
        crate::clipboard::apply_monitoring_state_from_app_config(
            app_handle,
            clipboard_state,
            &config,
        );
    }

    Ok(())
}

fn redact_ai_organizer_api_key_in_json_export(data: &mut serde_json::Value) {
    if let Some(settings) = data
        .get_mut("settings")
        .and_then(serde_json::Value::as_object_mut)
    {
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
        let redacted = redacted_config(config);
        write_json_pretty_atomically(&self.config_path, &redacted)
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
                Ok(data) => sanitize_launcher_data(data),
                Err(_) => LauncherData::default(),
            },
            Err(_) => LauncherData::default(),
        }
    }

    pub fn save_launcher_data(&self, data: &LauncherData) -> Result<(), String> {
        let sanitized = sanitize_launcher_data(data.clone());
        write_json_pretty_atomically(&self.launcher_data_path, &sanitized)
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

        #[derive(Serialize)]
        struct BackupData<'a> {
            version: &'static str,
            backup_time: u64,
            config: AppConfig,
            launcher_data: &'a LauncherData,
        }

        write_json_pretty_atomically(
            &backup_path,
            &BackupData {
                version: CONFIG_VERSION,
                backup_time: timestamp,
                config: redacted,
                launcher_data,
            },
        )?;
        release_operation_memory();

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

        let mut backup: serde_json::Value =
            serde_json::from_reader(fs::File::open(&backup_path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        let current_config = self.load_config();

        if let Some(config) = backup.get_mut("config") {
            preserve_missing_imported_config_fields(config, &current_config)?;
        }

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

    #[allow(dead_code)]
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
pub fn save_config(
    app_handle: AppHandle,
    manager: tauri::State<'_, ConfigManager>,
    clipboard_state: tauri::State<'_, Arc<crate::clipboard::ClipboardState>>,
    config: AppConfig,
) -> AppResult<()> {
    manager
        .save_config_with_runtime_ai_key(&config)
        .map_err(|e| AppError::new("CONFIG_SAVE_ERROR", e))?;
    crate::clipboard::sync_runtime_config_from_app_config(
        &app_handle,
        clipboard_state.inner(),
        &config,
    )
    .map_err(|e| AppError::new("CLIPBOARD_RUNTIME_SYNC_ERROR", e))?;
    crate::clipboard::apply_monitoring_state_from_app_config(
        &app_handle,
        clipboard_state.inner(),
        &config,
    );
    Ok(())
}

#[tauri::command]
pub fn patch_config(
    app_handle: AppHandle,
    manager: tauri::State<'_, ConfigManager>,
    clipboard_state: tauri::State<'_, Arc<crate::clipboard::ClipboardState>>,
    patch: AppConfigPatch,
) -> AppResult<AppConfig> {
    let mut current = manager.load_config();
    apply_app_config_patch(&mut current, patch);
    manager
        .save_config_with_runtime_ai_key(&current)
        .map_err(|e| AppError::new("CONFIG_SAVE_ERROR", e))?;
    crate::clipboard::sync_runtime_config_from_app_config(
        &app_handle,
        clipboard_state.inner(),
        &current,
    )
    .map_err(|e| AppError::new("CLIPBOARD_RUNTIME_SYNC_ERROR", e))?;
    crate::clipboard::apply_monitoring_state_from_app_config(
        &app_handle,
        clipboard_state.inner(),
        &current,
    );
    Ok(current)
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
    let launcher_data = sanitize_launcher_data(manager.load_launcher_data());
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
    app_handle: AppHandle,
    manager: tauri::State<'_, ConfigManager>,
    clipboard_state: tauri::State<'_, Arc<crate::clipboard::ClipboardState>>,
    filename: String,
) -> AppResult<ExportData> {
    let previous_config = manager.load_config();
    let previous_launcher_data = manager.load_launcher_data();
    let (mut config, launcher_data) = manager
        .restore_backup(&filename)
        .map_err(|e| AppError::new("RESTORE_BACKUP_ERROR", e))?;
    let launcher_data = sanitize_launcher_data(launcher_data);
    if !normalize_api_key(&config.ai_organizer_api_key).is_empty() {
        manager.set_ai_organizer_api_key(&config.ai_organizer_api_key);
    }
    redact_ai_organizer_api_key(&mut config);
    if let Err(err) = manager
        .save_config(&config)
        .map_err(|e| AppError::new("CONFIG_SAVE_ERROR", e))
    {
        let _ = restore_persisted_snapshot(
            &manager,
            &previous_config,
            &previous_launcher_data,
            Some(&app_handle),
            Some(clipboard_state.inner()),
        );
        release_operation_memory();
        return Err(err);
    }
    if let Err(err) = manager
        .save_launcher_data(&launcher_data)
        .map_err(|e| AppError::new("LAUNCHER_DATA_SAVE_ERROR", e))
    {
        let _ = restore_persisted_snapshot(
            &manager,
            &previous_config,
            &previous_launcher_data,
            Some(&app_handle),
            Some(clipboard_state.inner()),
        );
        release_operation_memory();
        return Err(err);
    }
    if let Err(err) =
        sync_runtime_state_after_import(&manager, Some(&app_handle), Some(clipboard_state.inner()))
            .map_err(|e| AppError::new("CLIPBOARD_RUNTIME_SYNC_ERROR", e))
    {
        let _ = restore_persisted_snapshot(
            &manager,
            &previous_config,
            &previous_launcher_data,
            Some(&app_handle),
            Some(clipboard_state.inner()),
        );
        release_operation_memory();
        return Err(err);
    }

    drop(previous_launcher_data);
    drop(previous_config);
    drop(launcher_data);
    drop(config);
    let current = current_export_data(&manager);
    release_operation_memory();
    Ok(current)
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
        Some(sanitize_launcher_data(manager.load_launcher_data()))
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

fn import_data_internal(
    manager: &ConfigManager,
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
            current.ctrl_drag_enabled = settings.ctrl_drag_enabled;
            current.auto_hide_after_launch = settings.auto_hide_after_launch;
            current.show_guide_on_startup = settings.show_guide_on_startup;
            current.hide_on_ctrl_right_click = settings.hide_on_ctrl_right_click;
            current.corner_hotspot_enabled = settings.corner_hotspot_enabled;
            current.corner_hotspot_position = settings.corner_hotspot_position;
            current.corner_hotspot_sensitivity = settings.corner_hotspot_sensitivity;
            current.performance_mode = settings.performance_mode;
            current.window_effect_type = settings.window_effect_type;
            current.strong_shortcut_mode = settings.strong_shortcut_mode;
            current.auto_hide_countdown_seconds = settings.auto_hide_countdown_seconds;
            current.auto_hide_enabled = settings.auto_hide_enabled;
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
            let launcher_data = sanitize_launcher_data(launcher_data);
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
            let current = sanitize_launcher_data(current);
            manager
                .save_launcher_data(&current)
                .map_err(|e| AppError::new("LAUNCHER_DATA_SAVE_ERROR", e))?;
        }
    }

    Ok(())
}

fn import_data_with_rollback(
    manager: &ConfigManager,
    data: ExportData,
    merge_mode: bool,
    app_handle: Option<&AppHandle>,
    clipboard_state: Option<&Arc<crate::clipboard::ClipboardState>>,
) -> AppResult<()> {
    let previous_config = manager.load_config();
    let previous_launcher_data = manager.load_launcher_data();

    if let Err(err) = import_data_internal(manager, data, merge_mode) {
        let _ = restore_persisted_snapshot(
            manager,
            &previous_config,
            &previous_launcher_data,
            app_handle,
            clipboard_state,
        );
        release_operation_memory();
        return Err(err);
    }

    if let Err(err) = sync_runtime_state_after_import(manager, app_handle, clipboard_state)
        .map_err(|e| AppError::new("CLIPBOARD_RUNTIME_SYNC_ERROR", e))
    {
        let _ = restore_persisted_snapshot(
            manager,
            &previous_config,
            &previous_launcher_data,
            app_handle,
            clipboard_state,
        );
        release_operation_memory();
        return Err(err);
    }

    drop(previous_launcher_data);
    drop(previous_config);
    release_operation_memory();
    Ok(())
}

#[tauri::command]
pub fn import_data(
    app_handle: AppHandle,
    manager: tauri::State<'_, ConfigManager>,
    clipboard_state: tauri::State<'_, Arc<crate::clipboard::ClipboardState>>,
    data: ExportData,
    merge_mode: bool,
) -> AppResult<()> {
    import_data_with_rollback(
        &manager,
        data,
        merge_mode,
        Some(&app_handle),
        Some(clipboard_state.inner()),
    )
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
            write_json_pretty_to_file(&path, &data)?;
        }
        "zip" => {
            let file = fs::File::create(&path).map_err(|e| AppError::io_error(e.to_string()))?;
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::FileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);

            zip.start_file("export.json", options)
                .map_err(|e| AppError::new("ZIP_ERROR", e.to_string()))?;
            serde_json::to_writer_pretty(&mut zip, &data)
                .map_err(|e| AppError::new("SERIALIZE_ERROR", e.to_string()))?;

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

    drop(data);
    release_operation_memory();
    Ok(())
}

#[tauri::command]
pub fn export_data_to_file(path: String, format: String, data: serde_json::Value) -> AppResult<()> {
    let path = PathBuf::from(&path);
    let mut data = data;
    redact_ai_organizer_api_key_in_json_export(&mut data);

    match format.as_str() {
        "json" => {
            write_json_pretty_to_file(&path, &data)?;
        }
        "zip" => {
            let file = fs::File::create(&path).map_err(|e| AppError::io_error(e.to_string()))?;
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::FileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);

            zip.start_file("export.json", options)
                .map_err(|e| AppError::new("ZIP_ERROR", e.to_string()))?;
            serde_json::to_writer_pretty(&mut zip, &data)
                .map_err(|e| AppError::new("SERIALIZE_ERROR", e.to_string()))?;

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

    drop(data);
    release_operation_memory();
    Ok(())
}

#[tauri::command]
pub fn import_from_file(
    app_handle: AppHandle,
    manager: tauri::State<'_, ConfigManager>,
    clipboard_state: tauri::State<'_, Arc<crate::clipboard::ClipboardState>>,
    path: String,
    merge_mode: bool,
) -> AppResult<ExportData> {
    let path = PathBuf::from(&path);

    let current_config = manager.load_config();
    let data: ExportData = if path.extension().map(|e| e == "zip").unwrap_or(false) {
        let file = fs::File::open(&path).map_err(|e| AppError::io_error(e.to_string()))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| AppError::new("ZIP_ERROR", e.to_string()))?;

        let mut json_file = archive
            .by_name("export.json")
            .map_err(|e| AppError::new("ZIP_ERROR", format!("File not found in zip: {}", e)))?;

        deserialize_export_data_reader_with_current_config(&mut json_file, &current_config)?
    } else {
        let file = fs::File::open(&path).map_err(|e| AppError::io_error(e.to_string()))?;
        deserialize_export_data_reader_with_current_config(file, &current_config)?
    };

    import_data_with_rollback(
        &manager,
        data,
        merge_mode,
        Some(&app_handle),
        Some(clipboard_state.inner()),
    )?;

    let current = current_export_data(&manager);
    release_operation_memory();
    Ok(current)
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
    fn write_json_pretty_atomically_writes_valid_json_without_prebuilt_string() {
        let base = create_test_base("json-writer");
        let path = base.join("data.json");
        let value = serde_json::json!({
            "settings": {
                "theme": "dark"
            },
            "launcher_data": {
                "categories": []
            }
        });

        write_json_pretty_atomically(&path, &value).unwrap();

        let raw = std::fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed, value);
        assert!(raw.contains('\n'));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn write_json_pretty_atomically_removes_temp_file_after_serialize_error() {
        use serde::ser::{Serialize, Serializer};

        struct FailingSerialize;

        impl Serialize for FailingSerialize {
            fn serialize<S>(&self, _serializer: S) -> Result<S::Ok, S::Error>
            where
                S: Serializer,
            {
                Err(serde::ser::Error::custom("forced serialize failure"))
            }
        }

        let base = create_test_base("json-writer-fail");
        let path = base.join("data.json");

        let err = write_json_pretty_atomically(&path, &FailingSerialize).unwrap_err();

        assert!(err.contains("forced serialize failure"));
        assert!(!path.exists());
        assert!(!path.with_extension("tmp").exists());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn deserialize_app_config_missing_fields_uses_defaults() {
        let json = r#"{"theme":"dark","clipboard_max_records":200}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.theme, "dark");
        assert_eq!(config.clipboard_max_records, 200);
        assert_eq!(config.toggle_shortcut, "alt+space");
        assert!(config.ctrl_drag_enabled);
        assert!(!config.auto_hide_after_launch);
        assert!(config.show_guide_on_startup);
        assert!(!config.hide_on_ctrl_right_click);
        assert!(!config.corner_hotspot_enabled);
        assert_eq!(config.corner_hotspot_position, "top-right");
        assert_eq!(config.corner_hotspot_sensitivity, "medium");
        assert!(!config.performance_mode);
        assert_eq!(config.window_effect_type, "blur");
        assert!(config.strong_shortcut_mode);
        assert_eq!(config.auto_hide_countdown_seconds, 30);
        assert!(config.auto_hide_enabled);
        assert_eq!(config.clipboard_max_image_size_mb, 1.0);
        assert_eq!(config.backup_frequency, "none");
        assert_eq!(config.home_section_layouts.pinned.preset, "1x5");
        assert_eq!(config.home_section_layouts.recent.cols, 5);
    }

    #[test]
    fn deserialize_app_config_accepts_legacy_camel_case_window_effect_fields() {
        let json = r#"{
            "theme":"dark",
            "performanceMode": false,
            "windowEffectType": "Acrylic",
            "ctrlDragEnabled": false,
            "showGuideOnStartup": false
        }"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();

        assert_eq!(config.theme, "dark");
        assert!(!config.performance_mode);
        assert_eq!(config.window_effect_type, "acrylic");
        assert!(!config.ctrl_drag_enabled);
        assert!(!config.show_guide_on_startup);
    }

    #[test]
    fn deserialize_export_data_preserves_current_values_for_missing_new_config_fields() {
        let mut current_config = AppConfig::default();
        current_config.ctrl_drag_enabled = false;
        current_config.auto_hide_after_launch = true;
        current_config.show_guide_on_startup = false;
        current_config.hide_on_ctrl_right_click = true;
        current_config.corner_hotspot_enabled = true;
        current_config.corner_hotspot_position = "bottom-left".to_string();
        current_config.corner_hotspot_sensitivity = "high".to_string();
        current_config.performance_mode = true;
        current_config.window_effect_type = "acrylic".to_string();
        current_config.strong_shortcut_mode = false;

        let raw = r#"{
            "version":"1.0",
            "export_time":1,
            "settings":{
                "theme":"transparent",
                "toggle_shortcut":"alt+m"
            },
            "launcher_data":{
                "version":"1.0",
                "categories":[],
                "favorite_item_ids":[],
                "recent_used_items":[]
            }
        }"#;

        let parsed = deserialize_export_data_with_current_config(raw, &current_config).unwrap();
        let settings = parsed.settings.unwrap();

        assert_eq!(settings.theme, "transparent");
        assert_eq!(settings.toggle_shortcut, "alt+m");
        assert!(!settings.ctrl_drag_enabled);
        assert!(settings.auto_hide_after_launch);
        assert!(!settings.show_guide_on_startup);
        assert!(settings.hide_on_ctrl_right_click);
        assert!(settings.corner_hotspot_enabled);
        assert_eq!(settings.corner_hotspot_position, "bottom-left");
        assert_eq!(settings.corner_hotspot_sensitivity, "high");
        assert!(settings.performance_mode);
        assert_eq!(settings.window_effect_type, "acrylic");
        assert!(!settings.strong_shortcut_mode);
        assert_eq!(settings.auto_hide_countdown_seconds, 30);
        assert!(settings.auto_hide_enabled);
    }

    #[test]
    fn app_config_patch_only_updates_provided_fields() {
        let mut config = AppConfig::default();
        config.theme = "dark".to_string();
        config.category_cols = 5;
        config.launcher_cols = 6;
        config.home_section_layouts = HomeSectionLayouts {
            pinned: HomeSectionLayout {
                preset: "1x5".to_string(),
                rows: 1,
                cols: 5,
            },
            recent: HomeSectionLayout {
                preset: "1x5".to_string(),
                rows: 1,
                cols: 5,
            },
        };
        config.ctrl_drag_enabled = true;
        config.performance_mode = false;
        config.window_effect_type = "blur".to_string();
        config.strong_shortcut_mode = true;
        config.auto_hide_countdown_seconds = 60;
        config.auto_hide_enabled = false;
        config.clipboard_history_enabled = true;

        apply_app_config_patch(
            &mut config,
            AppConfigPatch {
                category_cols: Some(7),
                launcher_cols: Some(4),
                home_section_layouts: Some(HomeSectionLayouts {
                    pinned: HomeSectionLayout {
                        preset: "2x4".to_string(),
                        rows: 2,
                        cols: 4,
                    },
                    recent: HomeSectionLayout {
                        preset: "1x6".to_string(),
                        rows: 1,
                        cols: 6,
                    },
                }),
                performance_mode: Some(true),
                corner_hotspot_position: Some("bottom-left".to_string()),
                strong_shortcut_mode: Some(false),
                auto_hide_countdown_seconds: Some(45),
                auto_hide_enabled: Some(true),
                clipboard_history_enabled: Some(false),
                ..AppConfigPatch::default()
            },
        );

        assert_eq!(config.theme, "dark");
        assert_eq!(config.category_cols, 7);
        assert_eq!(config.launcher_cols, 4);
        assert_eq!(config.home_section_layouts.pinned.preset, "2x4");
        assert_eq!(config.home_section_layouts.pinned.rows, 2);
        assert_eq!(config.home_section_layouts.pinned.cols, 4);
        assert_eq!(config.home_section_layouts.recent.preset, "1x6");
        assert_eq!(config.home_section_layouts.recent.rows, 1);
        assert_eq!(config.home_section_layouts.recent.cols, 6);
        assert!(config.ctrl_drag_enabled);
        assert!(config.performance_mode);
        assert_eq!(config.window_effect_type, "blur");
        assert_eq!(config.corner_hotspot_position, "bottom-left");
        assert!(!config.strong_shortcut_mode);
        assert_eq!(config.auto_hide_countdown_seconds, 45);
        assert!(config.auto_hide_enabled);
        assert!(!config.clipboard_history_enabled);
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

    #[test]
    fn sanitize_launcher_data_migrates_legacy_original_icon_fields() {
        let sanitized = sanitize_launcher_data(LauncherData {
            version: CONFIG_VERSION.to_string(),
            categories: vec![CategoryData {
                id: "cat-1".to_string(),
                name: "工具".to_string(),
                custom_icon_base64: None,
                items: vec![
                    LauncherItemData {
                        id: "file-default".to_string(),
                        name: "Default".to_string(),
                        path: "C:\\A.exe".to_string(),
                        icon_base64: Some("icon-a".to_string()),
                        original_icon_base64: Some("icon-a".to_string()),
                        ..LauncherItemData::default()
                    },
                    LauncherItemData {
                        id: "file-custom".to_string(),
                        name: "Custom".to_string(),
                        path: "C:\\B.exe".to_string(),
                        icon_base64: Some("custom-b".to_string()),
                        original_icon_base64: Some("origin-b".to_string()),
                        ..LauncherItemData::default()
                    },
                    LauncherItemData {
                        id: "url-item".to_string(),
                        name: "URL".to_string(),
                        path: String::new(),
                        url: Some("https://example.com".to_string()),
                        item_type: "url".to_string(),
                        icon_base64: Some("icon-url".to_string()),
                        original_icon_base64: Some("icon-url".to_string()),
                        ..LauncherItemData::default()
                    },
                ],
            }],
            favorite_item_ids: Vec::new(),
            recent_used_items: Vec::new(),
        });

        let items = &sanitized.categories[0].items;
        assert_eq!(items[0].icon_base64, None);
        assert!(!items[0].has_custom_icon);
        assert_eq!(items[0].original_icon_base64, None);

        assert_eq!(items[1].icon_base64.as_deref(), Some("custom-b"));
        assert!(items[1].has_custom_icon);
        assert_eq!(items[1].original_icon_base64, None);

        assert_eq!(items[2].item_type, "url");
        assert_eq!(items[2].icon_base64.as_deref(), Some("icon-url"));
        assert!(!items[2].has_custom_icon);
        assert_eq!(items[2].original_icon_base64, None);
    }

    #[test]
    fn save_launcher_data_omits_original_icon_base64_from_disk() {
        let base = create_test_base("launcher-icon-migration");
        let manager = create_test_manager(&base);

        let launcher_data = LauncherData {
            version: CONFIG_VERSION.to_string(),
            categories: vec![CategoryData {
                id: "cat-1".to_string(),
                name: "工具".to_string(),
                custom_icon_base64: None,
                items: vec![
                    LauncherItemData {
                        id: "file-default".to_string(),
                        name: "Default".to_string(),
                        path: "C:\\A.exe".to_string(),
                        icon_base64: Some("icon-a".to_string()),
                        original_icon_base64: Some("icon-a".to_string()),
                        ..LauncherItemData::default()
                    },
                    LauncherItemData {
                        id: "file-custom".to_string(),
                        name: "Custom".to_string(),
                        path: "C:\\B.exe".to_string(),
                        icon_base64: Some("custom-b".to_string()),
                        original_icon_base64: Some("origin-b".to_string()),
                        ..LauncherItemData::default()
                    },
                ],
            }],
            favorite_item_ids: Vec::new(),
            recent_used_items: Vec::new(),
        };

        manager.save_launcher_data(&launcher_data).unwrap();

        let raw = std::fs::read_to_string(manager.launcher_data_path()).unwrap();
        assert!(!raw.contains("original_icon_base64"));
        assert!(raw.contains("\"icon_base64\": null"));
        assert!(raw.contains("\"has_custom_icon\": true"));
        assert!(!raw.contains("\"has_custom_icon\": false"));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn import_data_with_rollback_exposes_final_merged_state() {
        let base = create_test_base("import-merged-state");
        let manager = create_test_manager(&base);

        let mut current_config = AppConfig::default();
        current_config.theme = "dark".to_string();
        manager.save_config(&current_config).unwrap();

        let current_launcher_data = LauncherData {
            version: CONFIG_VERSION.to_string(),
            categories: vec![CategoryData {
                id: "cat-existing".to_string(),
                name: "现有分类".to_string(),
                custom_icon_base64: None,
                items: vec![LauncherItemData {
                    id: "item-existing".to_string(),
                    name: "Existing".to_string(),
                    path: "C:\\Existing.exe".to_string(),
                    ..LauncherItemData::default()
                }],
            }],
            favorite_item_ids: vec!["item-existing".to_string(), "missing-current".to_string()],
            recent_used_items: vec![RecentUsedItemData {
                category_id: "cat-existing".to_string(),
                item_id: "missing-current".to_string(),
                used_at: 50,
                usage_count: 1,
            }],
        };
        manager.save_launcher_data(&current_launcher_data).unwrap();

        let imported = ExportData {
            version: CONFIG_VERSION.to_string(),
            export_time: 1,
            settings: Some(AppConfig {
                theme: "light".to_string(),
                ..AppConfig::default()
            }),
            launcher_data: Some(LauncherData {
                version: CONFIG_VERSION.to_string(),
                categories: vec![CategoryData {
                    id: "cat-imported".to_string(),
                    name: "导入分类".to_string(),
                    custom_icon_base64: None,
                    items: vec![LauncherItemData {
                        id: "item-imported".to_string(),
                        name: "Imported".to_string(),
                        path: "C:\\Imported.exe".to_string(),
                        ..LauncherItemData::default()
                    }],
                }],
                favorite_item_ids: vec![
                    "item-imported".to_string(),
                    "missing-imported".to_string(),
                ],
                recent_used_items: vec![
                    RecentUsedItemData {
                        category_id: "cat-imported".to_string(),
                        item_id: "item-imported".to_string(),
                        used_at: 100,
                        usage_count: 2,
                    },
                    RecentUsedItemData {
                        category_id: "cat-imported".to_string(),
                        item_id: "missing-imported".to_string(),
                        used_at: 101,
                        usage_count: 1,
                    },
                ],
            }),
            plugins: None,
        };

        import_data_with_rollback(&manager, imported, true, None, None).unwrap();

        let exported = current_export_data(&manager);
        let settings = exported.settings.unwrap();
        let launcher_data = exported.launcher_data.unwrap();

        assert_eq!(settings.theme, "light");
        assert_eq!(launcher_data.categories.len(), 2);
        assert!(launcher_data
            .categories
            .iter()
            .any(|category| category.id == "cat-existing"));
        assert!(launcher_data
            .categories
            .iter()
            .any(|category| category.id == "cat-imported"));
        assert!(launcher_data
            .favorite_item_ids
            .iter()
            .any(|item_id| item_id == "item-existing"));
        assert!(launcher_data
            .favorite_item_ids
            .iter()
            .any(|item_id| item_id == "item-imported"));
        assert_eq!(launcher_data.favorite_item_ids.len(), 2);
        assert_eq!(launcher_data.recent_used_items.len(), 1);
        assert_eq!(launcher_data.recent_used_items[0].item_id, "item-imported");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn restore_backup_preserves_current_values_for_missing_new_config_fields() {
        let base = create_test_base("restore-backup-preserve-missing");
        let manager = create_test_manager(&base);
        std::fs::create_dir_all(manager.get_backups_dir()).unwrap();

        let mut current_config = AppConfig::default();
        current_config.window_effect_type = "acrylic".to_string();
        current_config.performance_mode = true;
        current_config.ctrl_drag_enabled = false;
        current_config.corner_hotspot_enabled = true;
        current_config.corner_hotspot_position = "bottom-left".to_string();
        current_config.corner_hotspot_sensitivity = "high".to_string();
        current_config.strong_shortcut_mode = false;
        manager.save_config(&current_config).unwrap();

        let backup_path = manager.get_backups_dir().join("legacy-backup.json");
        let backup_content = serde_json::json!({
            "version": CONFIG_VERSION,
            "backup_time": 1,
            "config": {
                "theme": "transparent",
                "toggle_shortcut": "alt+m"
            },
            "launcher_data": {
                "version": CONFIG_VERSION,
                "categories": [],
                "favorite_item_ids": [],
                "recent_used_items": []
            }
        });
        std::fs::write(
            &backup_path,
            serde_json::to_string_pretty(&backup_content).unwrap(),
        )
        .unwrap();

        let (restored, _) = manager.restore_backup("legacy-backup.json").unwrap();

        assert_eq!(restored.theme, "transparent");
        assert_eq!(restored.toggle_shortcut, "alt+m");
        assert_eq!(restored.window_effect_type, "acrylic");
        assert!(restored.performance_mode);
        assert!(!restored.ctrl_drag_enabled);
        assert!(restored.corner_hotspot_enabled);
        assert_eq!(restored.corner_hotspot_position, "bottom-left");
        assert_eq!(restored.corner_hotspot_sensitivity, "high");
        assert!(!restored.strong_shortcut_mode);

        let _ = std::fs::remove_dir_all(&base);
    }
}
