//! Tauri 命令：`plugin_host_*` 前缀，供前端 P3（Cordis）调用。

use crate::error::{AppError, AppResult};
use crate::plugin_host::loader;
use crate::plugin_host::manifest::{
    read_manifest_file, resolve_plugin_entry, PluginHostManifest, PluginHostRuntimeInfo,
};
use crate::plugin_host::registry::LoadedPlugin;
use crate::plugin_host::PluginHostState;
use crate::plugin_host::{install_plugin_dir, plugin_base_directory};
use std::path::{Path, PathBuf};
use tauri::command;
use tauri::State;

fn state_registry<'a>(
    state: &'a State<'_, PluginHostState>,
) -> AppResult<std::sync::MutexGuard<'a, crate::plugin_host::registry::Registry>> {
    state
        .registry
        .lock()
        .map_err(|_| AppError::internal("Plugin host registry lock poisoned"))
}

/// 列出运行时状态（需先 scan 或已加载）。
#[command]
pub fn plugin_host_list(
    state: State<'_, PluginHostState>,
) -> AppResult<Vec<PluginHostRuntimeInfo>> {
    let empty = {
        let reg = state_registry(&state)?;
        reg.list_runtime().is_empty()
    };
    if empty {
        // 首次调用自动 scan
        scan_plugins_inner(&state)?;
    }
    let reg = state_registry(&state)?;
    Ok(reg.list_runtime())
}

/// 安装目录是否含可加载 entry（dll）。
fn entry_file_exists(dir: &Path, manifest: &PluginHostManifest) -> bool {
    resolve_plugin_entry(dir, &manifest.entry)
        .map(|p| p.exists())
        .unwrap_or(false)
}

fn scan_plugins_inner(state: &State<'_, PluginHostState>) -> AppResult<Vec<PluginHostManifest>> {
    let base = {
        let reg = state_registry(state)?;
        reg.plugin_base().to_path_buf()
    };

    if !base.exists() {
        let _ = std::fs::create_dir_all(&base);
        return Ok(Vec::new());
    }

    let mut found: Vec<(String, PathBuf, PluginHostManifest)> = Vec::new();
    let entries = std::fs::read_dir(&base)
        .map_err(|e| AppError::io_error(format!("read plugin base {:?}: {}", base, e)))?;

    for entry in entries {
        let entry = entry.map_err(|e| AppError::io_error(e.to_string()))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        // 开发用 crate 源码目录（含 Cargo.toml + src）不是安装目录，扫描应跳过。
        if path.join("Cargo.toml").exists() && path.join("src").is_dir() {
            continue;
        }
        if let Some((manifest, dir)) = loader::try_read_manifest_in_dir(&path) {
            found.push((manifest.id.clone(), dir, manifest));
        }
    }

    // 同 id 多目录时：优先 entry dll 存在的安装目录；并列时目录名==id 优先。
    found.sort_by(|a, b| {
        let a_has = entry_file_exists(&a.1, &a.2);
        let b_has = entry_file_exists(&b.1, &b.2);
        a_has.cmp(&b_has).then_with(|| {
            let a_named = a.1.file_name().map(|n| n == a.0.as_str()).unwrap_or(false);
            let b_named = b.1.file_name().map(|n| n == b.0.as_str()).unwrap_or(false);
            a_named.cmp(&b_named)
        })
    });

    let mut reg = state_registry(state)?;
    for (id, dir, manifest) in &found {
        // 已有条目若已指向含 dll 的路径，不用缺 dll 的目录覆盖。
        if let Some(existing_dir) = reg.resolve_dir(id) {
            let existing_ok = entry_file_exists(&existing_dir, manifest);
            let incoming_ok = entry_file_exists(dir, manifest);
            if existing_ok && !incoming_ok {
                if let Some(existing) = reg.get_mut(id) {
                    existing.manifest = manifest.clone();
                }
                continue;
            }
        }
        reg.remember_path(id, dir.clone());
        if let Some(existing) = reg.get_mut(id) {
            existing.manifest = manifest.clone();
            if entry_file_exists(dir, manifest) {
                existing.plugin_dir = dir.clone();
            }
        } else {
            reg.insert(LoadedPlugin {
                manifest: manifest.clone(),
                plugin_dir: dir.clone(),
                enabled: true,
                loaded: false,
                last_error: None,
                library: None,
                fns: None,
                abi_storage: None,
            });
        }
    }
    reg.load_enabled_store();

    // list 以 registry 为准；返回本次扫描到的 manifest（按 id）。
    let mut seen = std::collections::HashSet::new();
    let mut manifests: Vec<PluginHostManifest> = Vec::new();
    for (_, dir, m) in &found {
        if seen.insert(m.id.clone()) {
            let _ = dir;
            manifests.push(m.clone());
        }
    }
    manifests.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(manifests)
}

/// 扫描 `plugins/` 下 manifest v2（runtime=rust）的插件。
#[command]
pub fn plugin_host_scan(state: State<'_, PluginHostState>) -> AppResult<Vec<PluginHostManifest>> {
    scan_plugins_inner(&state)
}

/// 加载插件 cdylib。
#[command]
pub fn plugin_host_load(state: State<'_, PluginHostState>, id: String) -> AppResult<()> {
    {
        let missing = {
            let reg = state_registry(&state)?;
            reg.get(&id).is_none() && reg.resolve_dir(&id).is_none()
        };
        if missing {
            scan_plugins_inner(&state)?;
        }
    }

    let (plugin_dir, manifest, enabled, app) = {
        let reg = state_registry(&state)?;
        let base_dir = reg
            .resolve_dir(&id)
            .ok_or_else(|| AppError::not_found(format!("Plugin '{}'", id)))?;
        let manifest = if let Some(p) = reg.get(&id) {
            if p.loaded {
                return Ok(());
            }
            p.manifest.clone()
        } else {
            read_manifest_file(&base_dir.join("manifest.json"))?
        };
        // 优先解析到真正含 entry dll 的目录（安装目录 plugins/<id>）。
        let plugin_dir = reg.resolve_load_dir(&id, &manifest.entry).unwrap_or(base_dir);
        let enabled = reg.get(&id).map(|p| p.enabled).unwrap_or(true);
        (plugin_dir, manifest, enabled, state.app_handle())
    };

    let loaded = loader::load_plugin_dll(&plugin_dir, &manifest, enabled, app)?;

    let mut reg = state_registry(&state)?;
    // 若已有旧实例，先卸载
    if let Some(old) = reg.get_mut(&id) {
        if old.loaded {
            let _ = loader::unload_plugin(old);
        }
    }
    reg.insert(loaded);
    reg.persist_enabled()?;
    Ok(())
}

/// 卸载插件（保留 manifest 登记与 enabled 状态）。
#[command]
pub fn plugin_host_unload(state: State<'_, PluginHostState>, id: String) -> AppResult<()> {
    let mut reg = state_registry(&state)?;
    let plugin = reg
        .get_mut(&id)
        .ok_or_else(|| AppError::not_found(format!("Plugin '{}'", id)))?;
    loader::unload_plugin(plugin)?;
    Ok(())
}

/// 调用插件方法。`args` 为任意 JSON。
#[command]
pub fn plugin_host_invoke(
    state: State<'_, PluginHostState>,
    id: String,
    method: String,
    args: serde_json::Value,
) -> AppResult<serde_json::Value> {
    let reg = state_registry(&state)?;
    let plugin = reg
        .get(&id)
        .ok_or_else(|| AppError::not_found(format!("Plugin '{}'", id)))?;
    loader::invoke_plugin(plugin, &method, &args)
}

/// 启用/禁用插件（持久化）。禁用时若已加载则卸载。
#[command]
pub fn plugin_host_set_enabled(
    state: State<'_, PluginHostState>,
    id: String,
    enabled: bool,
) -> AppResult<()> {
    let mut reg = state_registry(&state)?;
    let plugin = reg
        .get_mut(&id)
        .ok_or_else(|| AppError::not_found(format!("Plugin '{}'", id)))?;
    plugin.enabled = enabled;
    if !enabled && plugin.loaded {
        loader::unload_plugin(plugin)?;
    }
    reg.persist_enabled()?;
    Ok(())
}

/// 安装插件：`path` 为包含 manifest.json v2 的源目录，复制到 `plugins/<id>/`。
#[command]
pub fn plugin_host_install(state: State<'_, PluginHostState>, path: String) -> AppResult<PluginHostManifest> {
    let source = PathBuf::from(&path);
    let manifest = install_plugin_dir(&source)?;

    let base = {
        let reg = state_registry(&state)?;
        reg.plugin_base().to_path_buf()
    };
    let dest = base.join(&manifest.id);
    copy_dir_recursive(&source, &dest)?;

    let mut reg = state_registry(&state)?;
    reg.insert(LoadedPlugin {
        manifest: manifest.clone(),
        plugin_dir: dest,
        enabled: true,
        loaded: false,
        last_error: None,
        library: None,
        fns: None,
        abi_storage: None,
    });
    reg.load_enabled_store();
    reg.persist_enabled()?;
    Ok(manifest)
}

/// 卸载并删除插件目录。
#[command]
pub fn plugin_host_uninstall(state: State<'_, PluginHostState>, id: String) -> AppResult<()> {
    let plugin_dir = {
        let mut reg = state_registry(&state)?;
        let dir = reg
            .resolve_dir(&id)
            .ok_or_else(|| AppError::not_found(format!("Plugin '{}'", id)))?;
        if let Some(p) = reg.get_mut(&id) {
            loader::unload_plugin(p)?;
        }
        reg.remove(&id);
        reg.persist_enabled()?;
        dir
    };

    // 安全：只删除 plugins 基目录下的子目录
    let base = plugin_base_directory();
    let base_norm = std::fs::canonicalize(&base).unwrap_or(base.clone());
    let dir_norm = std::fs::canonicalize(&plugin_dir).unwrap_or(plugin_dir.clone());
    if dir_norm.starts_with(&base_norm) && dir_norm != base_norm {
        if plugin_dir.exists() {
            std::fs::remove_dir_all(&plugin_dir).map_err(|e| {
                AppError::io_error(format!("remove plugin dir {:?}: {}", plugin_dir, e))
            })?;
        }
    } else {
        return Err(AppError::invalid_input(
            "Refusing to remove a path outside the plugin base directory",
        ));
    }
    Ok(())
}

/// 读取插件环形日志。
#[command]
pub fn plugin_host_get_log(
    state: State<'_, PluginHostState>,
    id: String,
) -> AppResult<Vec<String>> {
    let reg = state_registry(&state)?;
    let plugin = reg
        .get(&id)
        .ok_or_else(|| AppError::not_found(format!("Plugin '{}'", id)))?;
    Ok(plugin.log_lines())
}

/// 向已加载插件投递事件（可选符号 air_plugin_on_event）。
#[command]
pub fn plugin_host_emit_event(
    state: State<'_, PluginHostState>,
    id: String,
    event: serde_json::Value,
) -> AppResult<()> {
    let reg = state_registry(&state)?;
    let plugin = reg
        .get(&id)
        .ok_or_else(|| AppError::not_found(format!("Plugin '{}'", id)))?;
    let json = serde_json::to_string(&event)?;
    loader::notify_plugin_event(plugin, &json)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> AppResult<()> {
    if !dst.exists() {
        std::fs::create_dir_all(dst)
            .map_err(|e| AppError::io_error(format!("create {:?}: {}", dst, e)))?;
    }
    for entry in std::fs::read_dir(src)
        .map_err(|e| AppError::io_error(format!("read {:?}: {}", src, e)))?
    {
        let entry = entry.map_err(|e| AppError::io_error(e.to_string()))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path).map_err(|e| {
                AppError::io_error(format!("copy {:?} -> {:?}: {}", src_path, dst_path, e))
            })?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn command_names_documented() {
        // 稳定 API 契约（P3 依赖）
        let names = [
            "plugin_host_scan",
            "plugin_host_list",
            "plugin_host_load",
            "plugin_host_unload",
            "plugin_host_invoke",
            "plugin_host_set_enabled",
            "plugin_host_install",
            "plugin_host_uninstall",
            "plugin_host_get_log",
        ];
        assert_eq!(names.len(), 9);
        assert!(names.iter().all(|n| n.starts_with("plugin_host_")));
    }
}
