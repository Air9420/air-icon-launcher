//! Plugin Host manifest v2：Rust 能力插件的声明格式。

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const MANIFEST_VERSION: u32 = 2;
pub const RUNTIME_RUST: &str = "rust";

/// manifest.json v2 结构。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginHostManifest {
    pub manifest_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    /// 运行时标识，当前仅 `rust`（cdylib）。
    pub runtime: String,
    /// 插件入口产物文件名（Windows: `.dll`），相对插件目录。
    pub entry: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    /// 能力声明；未声明的能力在 host_invoke 时会被拒绝。
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub contributes: PluginHostContributes,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PluginHostContributes {
    #[serde(default)]
    pub commands: Vec<PluginHostCommandContribute>,
    #[serde(default)]
    pub menus: Vec<PluginHostMenuContribute>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginHostCommandContribute {
    pub id: String,
    #[serde(default)]
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginHostMenuContribute {
    pub id: String,
    #[serde(default)]
    pub title: String,
}

/// `plugin_host_list` 返回的运行时信息。
#[derive(Debug, Clone, Serialize)]
pub struct PluginHostRuntimeInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub runtime: String,
    pub description: String,
    pub author: String,
    pub entry: String,
    pub path: String,
    pub enabled: bool,
    pub loaded: bool,
    pub capabilities: Vec<String>,
    pub contributes: PluginHostContributes,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    pub log_count: usize,
}

impl PluginHostManifest {
    /// 是否为可加载的 Rust 能力插件。
    pub fn is_rust_plugin(&self) -> bool {
        self.manifest_version == MANIFEST_VERSION && self.runtime == RUNTIME_RUST
    }

    #[allow(dead_code)]
    pub fn has_capability(&self, cap: &str) -> bool {
        self.capabilities.iter().any(|c| c == cap)
    }
}

/// 从磁盘解析 manifest v2。
pub fn parse_manifest_str(content: &str) -> AppResult<PluginHostManifest> {
    let manifest: PluginHostManifest = serde_json::from_str(content)
        .map_err(|e| AppError::new("PARSE_ERROR", format!("Failed to parse plugin manifest: {}", e)))?;

    if manifest.manifest_version != MANIFEST_VERSION {
        return Err(AppError::new(
            "UNSUPPORTED_MANIFEST",
            format!(
                "Unsupported manifest_version {} (expected {})",
                manifest.manifest_version, MANIFEST_VERSION
            ),
        ));
    }

    if manifest.id.trim().is_empty() {
        return Err(AppError::invalid_input("manifest id must not be empty"));
    }
    if manifest.entry.trim().is_empty() {
        return Err(AppError::invalid_input("manifest entry must not be empty"));
    }
    if manifest.runtime != RUNTIME_RUST {
        return Err(AppError::new(
            "UNSUPPORTED_RUNTIME",
            format!(
                "Unsupported runtime '{}' (expected '{}')",
                manifest.runtime, RUNTIME_RUST
            ),
        ));
    }

    Ok(manifest)
}

pub fn read_manifest_file(path: &Path) -> AppResult<PluginHostManifest> {
    let content = fs::read_to_string(path)
        .map_err(|e| AppError::io_error(format!("Failed to read manifest {:?}: {}", path, e)))?;
    parse_manifest_str(&content)
}

/// 校验 entry 相对路径：禁止绝对路径、盘符前缀、`..` 逃逸插件目录。
pub fn resolve_plugin_entry(plugin_dir: &Path, entry: &str) -> AppResult<PathBuf> {
    use std::path::Component;

    let entry = entry.trim();
    if entry.is_empty() {
        return Err(AppError::invalid_input("plugin entry must not be empty"));
    }

    let entry_path = Path::new(entry);
    if entry_path.is_absolute() {
        return Err(AppError::invalid_input(format!(
            "plugin entry must be relative, got '{}'",
            entry
        )));
    }

    for component in entry_path.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir => {
                return Err(AppError::invalid_input(format!(
                    "plugin entry must not contain '..': '{}'",
                    entry
                )));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::invalid_input(format!(
                    "plugin entry must not be rooted: '{}'",
                    entry
                )));
            }
        }
    }

    // 规范化后必须仍位于插件目录内。
    let joined: PathBuf = plugin_dir.join(entry_path);
    let plugin_norm = normalize_path(plugin_dir);
    let joined_norm = normalize_path(&joined);
    if !joined_norm.starts_with(&plugin_norm) {
        return Err(AppError::invalid_input(format!(
            "plugin entry escapes plugin directory: '{}'",
            entry
        )));
    }

    Ok(joined)
}

/// 轻量路径规范化（不触碰文件系统，去掉 `.`，手工解析 `..` 已在组件层拒绝）。
fn normalize_path(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_json() -> String {
        serde_json::json!({
            "manifest_version": 2,
            "id": "com.air.example.rust",
            "name": "Rust示例插件",
            "version": "0.1.0",
            "runtime": "rust",
            "entry": "air_example_rust.dll",
            "description": "demo",
            "author": "Air",
            "capabilities": ["log", "launcher.read", "events.emit"],
            "contributes": {
                "commands": [{ "id": "example.hello", "title": "Hello from Rust" }],
                "menus": []
            }
        })
        .to_string()
    }

    #[test]
    fn parses_manifest_v2() {
        let m = parse_manifest_str(&sample_json()).unwrap();
        assert_eq!(m.id, "com.air.example.rust");
        assert_eq!(m.entry, "air_example_rust.dll");
        assert!(m.is_rust_plugin());
        assert!(m.has_capability("launcher.read"));
        assert!(!m.has_capability("launcher.launch"));
        assert_eq!(m.contributes.commands.len(), 1);
        assert_eq!(m.contributes.commands[0].id, "example.hello");
    }

    #[test]
    fn rejects_wrong_manifest_version() {
        let json = serde_json::json!({
            "manifest_version": 1,
            "id": "x",
            "name": "x",
            "version": "1",
            "runtime": "rust",
            "entry": "a.dll"
        })
        .to_string();
        let err = parse_manifest_str(&json).unwrap_err();
        assert_eq!(err.code, "UNSUPPORTED_MANIFEST");
    }

    #[test]
    fn rejects_non_rust_runtime() {
        let json = serde_json::json!({
            "manifest_version": 2,
            "id": "x",
            "name": "x",
            "version": "1",
            "runtime": "wasm",
            "entry": "a.wasm"
        })
        .to_string();
        let err = parse_manifest_str(&json).unwrap_err();
        assert_eq!(err.code, "UNSUPPORTED_RUNTIME");
    }

    #[test]
    fn entry_rejects_escape() {
        let dir = Path::new("plugins/com.air.example.rust");
        assert!(resolve_plugin_entry(dir, "air_example_rust.dll").is_ok());
        assert!(resolve_plugin_entry(dir, "./sub/ok.dll").is_ok());
        assert!(resolve_plugin_entry(dir, "../escape.dll").is_err());
        assert!(resolve_plugin_entry(dir, "..\\escape.dll").is_err());
        assert!(resolve_plugin_entry(dir, "C:\\Windows\\evil.dll").is_err());
        assert!(resolve_plugin_entry(dir, "/abs/evil.dll").is_err());
        assert!(resolve_plugin_entry(dir, "").is_err());
    }

    #[test]
    fn old_js_manifest_is_not_v2() {
        // 旧系统 manifest 无 manifest_version，解析应失败
        let old = r#"{"id":"com.example.welcome-plugin","name":"欢迎","version":"1.0.0","main":"main.js"}"#;
        assert!(parse_manifest_str(old).is_err());
    }
}
