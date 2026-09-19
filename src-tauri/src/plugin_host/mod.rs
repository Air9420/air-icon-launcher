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
pub mod capability;
pub mod commands;
pub mod loader;
pub mod manifest;
pub mod registry;

pub use registry::{init_plugin_host, PluginHostState};

use crate::error::{AppError, AppResult};
use manifest::{read_manifest_file, PluginHostManifest};
use std::path::{Path, PathBuf};

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
