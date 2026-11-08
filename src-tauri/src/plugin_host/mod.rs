//! Rust Plugin Host（P2）
//!
//! 并行于旧 iframe JS 插件系统（`plugins.rs`）的新子系统：
//! - manifest v2 + capability 强制
//! - cdylib ABI v1 + libloading
//! - Tauri 命令前缀 `plugin_host_`
//!
//! 与旧系统共存：旧命令仍注册，互不覆盖；目录均在 `plugins/`，
//! 新系统只识别 `manifest_version=2` 且 `runtime=rust` 的插件。

pub mod abi;
pub mod autostart;
pub mod capability;
pub mod commands;
pub mod loader;
pub mod manifest;
pub mod registry;

pub use registry::{init_plugin_host, PluginHostState};

use crate::error::{AppError, AppResult};
use manifest::{read_manifest_file, PluginHostManifest};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

/// 启动后在后台扫描并 load 所有已启用插件（不阻塞 setup）。
///
/// 正常启动与 `--autostart` 都会走这里；autostart 钩子在线程内另行调度，
/// 即使 load 已完成也会对已加载插件再次 invoke（幂等由 load 早退保证）。
pub fn schedule_load_enabled_plugins(app: AppHandle) {
    std::thread::spawn(move || {
        let state = match app.try_state::<PluginHostState>() {
            Some(s) => s,
            None => {
                log::warn!("[plugin-host] PluginHostState not ready");
                return;
            }
        };
        if let Err(e) = commands::scan_plugins_for_hooks(&state) {
            log::warn!("[plugin-host] startup scan failed: [{}] {}", e.code, e.message);
            return;
        }
        match commands::load_enabled_plugins(&state) {
            Ok(n) => log::info!("[plugin-host] startup loaded {} enabled plugin(s)", n),
            Err(e) => log::warn!("[plugin-host] load_enabled failed: [{}] {}", e.code, e.message),
        }
        let _ = app.emit(
            "plugin_host_bus",
            serde_json::json!({
                "plugin_id": "*",
                "event": "enabled_plugins_loaded",
                "payload": {},
            }),
        );
    });
}

/// 待删除的插件目录清单（卸载时 DLL 仍被映射导致删不掉）。
fn pending_delete_path() -> PathBuf {
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(app_data)
        .join("air-icon-launcher")
        .join("plugin-host")
        .join("pending-delete.json")
}

/// 记录一个下次启动时要删除的目录。
pub fn queue_pending_delete(dir: &Path) {
    let path = pending_delete_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut list: Vec<String> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
        .unwrap_or_default();
    let entry = dir.to_string_lossy().to_string();
    if !list.contains(&entry) {
        list.push(entry);
    }
    if let Ok(json) = serde_json::to_string_pretty(&list) {
        let _ = std::fs::write(&path, json);
    }
}

/// 启动早期处理待删清单：此时新进程还没加载任何插件 DLL，文件不会被占用。
pub fn flush_pending_deletes() {
    let path = pending_delete_path();
    let Ok(text) = std::fs::read_to_string(&path) else {
        return;
    };
    let list: Vec<String> = serde_json::from_str(&text).unwrap_or_default();
    let base = plugin_base_directory();
    let base_norm = std::fs::canonicalize(&base).unwrap_or(base);
    let mut remain = Vec::new();
    for entry in list {
        let dir = PathBuf::from(&entry);
        let dir_norm = std::fs::canonicalize(&dir).unwrap_or(dir.clone());
        // 只删插件基目录内的路径，防止清单被篡改后误删用户文件
        if !dir_norm.starts_with(&base_norm) || dir_norm == base_norm {
            continue;
        }
        if !dir.exists() {
            continue;
        }
        if std::fs::remove_dir_all(&dir).is_err() {
            remain.push(entry);
        }
    }
    if remain.is_empty() {
        let _ = std::fs::remove_file(&path);
    } else if let Ok(json) = serde_json::to_string_pretty(&remain) {
        let _ = std::fs::write(&path, json);
    }
}

/// 插件根目录：开发期优先 `<repo>/plugins`，否则 `%APPDATA%/air-icon-launcher/plugins`。
///
/// 与旧 `plugins.rs` 的 `get_plugin_base_directory` 保持一致，便于共存。
pub fn plugin_base_directory() -> PathBuf {
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
    PathBuf::from(app_data)
        .join("air-icon-launcher")
        .join("plugins")
}

/// 安装前校验源目录中的 manifest v2。
pub fn install_plugin_dir(source: &Path) -> AppResult<PluginHostManifest> {
    if !source.exists() || !source.is_dir() {
        return Err(AppError::not_found(format!(
            "Plugin source directory: {:?}",
            source
        )));
    }
    let manifest_path = source.join("manifest.json");
    if !manifest_path.exists() {
        return Err(AppError::invalid_input(
            "Source path does not contain manifest.json",
        ));
    }
    let manifest = read_manifest_file(&manifest_path)?;

    // 校验 entry 存在于源目录（允许用户先构建 dll 再安装）
    let entry_path = manifest::resolve_plugin_entry(source, &manifest.entry)?;
    if !entry_path.exists() {
        return Err(AppError::not_found(format!(
            "Plugin entry library not found in source: {:?}",
            entry_path
        )));
    }
    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_rejects_missing_dir() {
        let p = std::env::temp_dir().join("air-ph-no-such-install-src");
        let err = install_plugin_dir(&p).unwrap_err();
        assert_eq!(err.code, "NOT_FOUND");
    }

    #[test]
    fn install_rejects_dir_without_manifest() {
        let p = std::env::temp_dir().join(format!("air-ph-noman-{}", std::process::id()));
        std::fs::create_dir_all(&p).unwrap();
        let err = install_plugin_dir(&p).unwrap_err();
        assert_eq!(err.code, "INVALID_INPUT");
        let _ = std::fs::remove_dir_all(&p);
    }

    #[test]
    fn install_rejects_v1_manifest() {
        let p = std::env::temp_dir().join(format!("air-ph-v1-{}", std::process::id()));
        std::fs::create_dir_all(&p).unwrap();
        std::fs::write(
            p.join("manifest.json"),
            r#"{"id":"x","name":"x","version":"1","main":"m.js"}"#,
        )
        .unwrap();
        let err = install_plugin_dir(&p).unwrap_err();
        assert!(
            err.code == "PARSE_ERROR"
                || err.code == "UNSUPPORTED_MANIFEST"
                || err.code == "UNSUPPORTED_RUNTIME"
                || err.code == "INVALID_INPUT",
            "unexpected code {}",
            err.code
        );
        let _ = std::fs::remove_dir_all(&p);
    }
}
