use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::command;

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
}

fn get_plugin_base_directory() -> PathBuf {
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
    let dir = get_plugin_base_directory();
    dir.join(&plugin_id).to_string_lossy().to_string()
}

#[command]
pub fn scan_plugins() -> Result<Vec<PluginManifest>, String> {
    let plugin_dir = get_plugin_base_directory();
    
    if !plugin_dir.exists() {
        let _ = fs::create_dir_all(&plugin_dir);
        return Ok(Vec::new());
    }

    let mut manifests = Vec::new();

    let entries = fs::read_dir(&plugin_dir).map_err(|e| e.to_string())?;
    
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        
        if path.is_dir() {
            let manifest_path = path.join("manifest.json");
            if manifest_path.exists() {
                match fs::read_to_string(&manifest_path) {
                    Ok(content) => {
                        match serde_json::from_str::<PluginManifest>(&content) {
                            Ok(manifest) => manifests.push(manifest),
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

    Ok(manifests)
}

#[command]
pub fn read_plugin_manifest(plugin_path: String) -> Result<PluginManifest, String> {
    let manifest_path = PathBuf::from(&plugin_path).join("manifest.json");
    
    if !manifest_path.exists() {
        return Err(format!("Manifest not found at {:?}", manifest_path));
    }

    let content = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
    let manifest: PluginManifest = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    
    Ok(manifest)
}

#[command]
pub fn read_plugin_file(plugin_path: String, file_name: String) -> Result<String, String> {
    let file_path = PathBuf::from(&plugin_path).join(&file_name);
    
    if !file_path.exists() {
        return Err(format!("File not found at {:?}", file_path));
    }

    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    Ok(content)
}

#[command]
pub fn install_plugin(source_path: String) -> Result<bool, String> {
    let source = PathBuf::from(&source_path);
    
    if !source.exists() {
        return Err(format!("Source path does not exist: {:?}", source));
    }

    let manifest_path = source.join("manifest.json");
    if !manifest_path.exists() {
        return Err("Source path does not contain a manifest.json file".to_string());
    }

    let content = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
    let manifest: PluginManifest = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let plugin_dir = get_plugin_base_directory();
    let dest_dir = plugin_dir.join(&manifest.id);

    if dest_dir.exists() {
        fs::remove_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    }

    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
        if !dst.exists() {
            fs::create_dir_all(dst).map_err(|e| e.to_string())?;
        }

        for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let src_path = entry.path();
            let dst_path = dst.join(entry.file_name());

            if src_path.is_dir() {
                copy_dir_recursive(&src_path, &dst_path)?;
            } else {
                fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
            }
        }

        Ok(())
    }

    copy_dir_recursive(&source, &dest_dir)?;

    Ok(true)
}

#[command]
pub fn uninstall_plugin(plugin_id: String) -> Result<bool, String> {
    let plugin_dir = get_plugin_base_directory();
    let plugin_path = plugin_dir.join(&plugin_id);

    if plugin_path.exists() {
        fs::remove_dir_all(&plugin_path).map_err(|e| e.to_string())?;
    }

    Ok(true)
}

#[command]
pub fn launch_item(path: String) -> Result<(), String> {
    let path = PathBuf::from(&path);
    
    if !path.exists() {
        return Err(format!("Path does not exist: {:?}", path));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path.to_string_lossy()])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
