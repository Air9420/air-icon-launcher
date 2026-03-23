use std::fs;
use std::path::PathBuf;
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tauri::command;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub main: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keywords: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub manifest: PluginManifest,
    pub path: String,
}

static PLUGIN_PATHS: std::sync::OnceLock<std::sync::RwLock<HashMap<String, String>>> = std::sync::OnceLock::new();

fn get_plugin_paths() -> &'static std::sync::RwLock<HashMap<String, String>> {
    PLUGIN_PATHS.get_or_init(|| std::sync::RwLock::new(HashMap::new()))
}

fn get_plugin_base_directory() -> PathBuf {
    #[cfg(debug_assertions)]
    {
        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            let dev_plugin_dir = PathBuf::from(manifest_dir)
                .parent()
                .map(|p| p.join("plugins"))
                .unwrap_or_else(|| PathBuf::from("plugins"));

            if dev_plugin_dir.exists() {
                return dev_plugin_dir;
            }
        }
    }

    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(app_data).join("air-icon-launcher").join("plugins")
}

#[command]
pub fn get_plugin_directory() -> String {
    let dir = get_plugin_base_directory();
    dir.to_string_lossy().to_string()
}

#[command]
pub fn get_plugin_path(plugin_id: String) -> String {
    let paths = get_plugin_paths().read().unwrap();
    if let Some(path) = paths.get(&plugin_id) {
        return path.clone();
    }
    drop(paths);

    let dir = get_plugin_base_directory();
    dir.join(&plugin_id).to_string_lossy().to_string()
}

#[command]
pub fn scan_plugins() -> AppResult<Vec<PluginManifest>> {
    let plugin_dir = get_plugin_base_directory();

    if !plugin_dir.exists() {
        let _ = fs::create_dir_all(&plugin_dir);
        return Ok(Vec::new());
    }

    let mut manifests = Vec::new();
    let mut path_map = HashMap::new();

    let entries = fs::read_dir(&plugin_dir).map_err(|e| AppError::io_error(e.to_string()))?;

    for entry in entries {
        let entry = entry.map_err(|e| AppError::io_error(e.to_string()))?;
        let path = entry.path();

        if path.is_dir() {
            let manifest_path = path.join("manifest.json");
            if manifest_path.exists() {
                match fs::read_to_string(&manifest_path) {
                    Ok(content) => {
                        match serde_json::from_str::<PluginManifest>(&content) {
                            Ok(manifest) => {
                                path_map.insert(manifest.id.clone(), path.to_string_lossy().to_string());
                                manifests.push(manifest);
                            }
                            Err(e) => {
                                eprintln!("Failed to parse manifest at {:?}: {}", manifest_path, e);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed to read manifest at {:?}: {}", manifest_path, e);
                    }
                }
            }
        }
    }

    let mut paths = get_plugin_paths().write().unwrap();
    *paths = path_map;

    Ok(manifests)
}

#[command]
pub fn read_plugin_manifest(plugin_path: String) -> AppResult<PluginManifest> {
    let manifest_path = PathBuf::from(&plugin_path).join("manifest.json");

    if !manifest_path.exists() {
        return Err(AppError::not_found(format!("Manifest at {:?}", manifest_path)));
    }

    let content = fs::read_to_string(&manifest_path)
        .map_err(|e| AppError::io_error(format!("Failed to read manifest: {}", e)))?;
    let manifest: PluginManifest = serde_json::from_str(&content)
        .map_err(|e| AppError::new("PARSE_ERROR", format!("Failed to parse manifest: {}", e)))?;

    Ok(manifest)
}

#[command]
pub fn read_plugin_file(plugin_path: String, file_name: String) -> AppResult<String> {
    let file_path = PathBuf::from(&plugin_path).join(&file_name);

    if !file_path.exists() {
        return Err(AppError::not_found(format!("File at {:?}", file_path)));
    }

    let content = fs::read_to_string(&file_path)
        .map_err(|e| AppError::io_error(format!("Failed to read file: {}", e)))?;
    Ok(content)
}

#[command]
pub fn install_plugin(source_path: String) -> AppResult<bool> {
    let source = PathBuf::from(&source_path);

    if !source.exists() {
        return Err(AppError::not_found(format!("Source path: {:?}", source)));
    }

    let manifest_path = source.join("manifest.json");
    if !manifest_path.exists() {
        return Err(AppError::invalid_input("Source path does not contain manifest.json"));
    }

    let content = fs::read_to_string(&manifest_path)
        .map_err(|e| AppError::io_error(format!("Failed to read manifest: {}", e)))?;
    let manifest: PluginManifest = serde_json::from_str(&content)
        .map_err(|e| AppError::new("PARSE_ERROR", format!("Failed to parse manifest: {}", e)))?;

    let plugin_dir = get_plugin_base_directory();
    let dest_dir = plugin_dir.join(&manifest.id);

    if dest_dir.exists() {
        fs::remove_dir_all(&dest_dir)
            .map_err(|e| AppError::io_error(format!("Failed to remove existing plugin: {}", e)))?;
    }

    fs::create_dir_all(&dest_dir)
        .map_err(|e| AppError::io_error(format!("Failed to create plugin directory: {}", e)))?;

    fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> AppResult<()> {
        if !dst.exists() {
            fs::create_dir_all(dst)
                .map_err(|e| AppError::io_error(format!("Failed to create directory: {}", e)))?;
        }

        for entry in fs::read_dir(src)
            .map_err(|e| AppError::io_error(format!("Failed to read directory: {}", e)))? {
            let entry = entry.map_err(|e| AppError::io_error(e.to_string()))?;
            let src_path = entry.path();
            let dst_path = dst.join(entry.file_name());

            if src_path.is_dir() {
                copy_dir_recursive(&src_path, &dst_path)?;
            } else {
                fs::copy(&src_path, &dst_path)
                    .map_err(|e| AppError::io_error(format!("Failed to copy file: {}", e)))?;
            }
        }

        Ok(())
    }

    copy_dir_recursive(&source, &dest_dir)?;

    Ok(true)
}

#[command]
pub fn uninstall_plugin(plugin_id: String) -> AppResult<bool> {
    let paths = get_plugin_paths().read().unwrap();
    let plugin_path = paths.get(&plugin_id).cloned();
    drop(paths);

    let plugin_path = if let Some(path) = plugin_path {
        PathBuf::from(path)
    } else {
        let plugin_dir = get_plugin_base_directory();
        plugin_dir.join(&plugin_id)
    };

    if plugin_path.exists() {
        fs::remove_dir_all(&plugin_path)
            .map_err(|e| AppError::io_error(format!("Failed to remove plugin: {}", e)))?;
    }

    let mut paths = get_plugin_paths().write().unwrap();
    paths.remove(&plugin_id);

    Ok(true)
}

#[command]
pub fn launch_item(path: String) -> AppResult<()> {
    let path = PathBuf::from(&path);

    if !path.exists() {
        return Err(AppError::not_found(format!("Path: {:?}", path)));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path.to_string_lossy()])
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to launch: {}", e)))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to launch: {}", e)))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to launch: {}", e)))?;
    }

    Ok(())
}
