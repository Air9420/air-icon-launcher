//! Plugin Host 注册表：已扫描/已加载插件状态 + 环形日志 + enabled 持久化。

use crate::error::{AppError, AppResult};
use crate::plugin_host::abi::PluginFns;
use crate::plugin_host::loader::PluginAbiStorage;
use crate::plugin_host::manifest::{PluginHostManifest, PluginHostRuntimeInfo};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

/// 单插件环形日志容量。
pub const LOG_RING_CAPACITY: usize = 200;

/// host_invoke / 插件 log 写入的环形缓冲。
#[derive(Debug)]
pub struct RingLog {
    items: VecDeque<String>,
    capacity: usize,
}

impl RingLog {
    pub fn new(capacity: usize) -> Self {
        Self {
            items: VecDeque::with_capacity(capacity.min(64)),
            capacity: capacity.max(1),
        }
    }

    pub fn push(&mut self, line: impl Into<String>) {
        if self.items.len() >= self.capacity {
            self.items.pop_front();
        }
        self.items.push_back(line.into());
    }

    pub fn to_vec(&self) -> Vec<String> {
        self.items.iter().cloned().collect()
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

/// 插件加载态。
pub struct LoadedPlugin {
    pub manifest: PluginHostManifest,
    pub plugin_dir: PathBuf,
    pub enabled: bool,
    pub loaded: bool,
    pub last_error: Option<String>,
    /// libloading 库句柄；unload 时 drop。
    pub library: Option<libloading::Library>,
    pub fns: Option<PluginFns>,
    /// HostVTable + HostUserData（Send/Sync 包装，插件生命周期内保持有效）。
    pub abi_storage: Option<PluginAbiStorage>,
}

impl LoadedPlugin {
    pub fn runtime_info(&self) -> PluginHostRuntimeInfo {
        PluginHostRuntimeInfo {
            id: self.manifest.id.clone(),
            name: self.manifest.name.clone(),
            version: self.manifest.version.clone(),
            runtime: self.manifest.runtime.clone(),
            description: self.manifest.description.clone(),
            author: self.manifest.author.clone(),
            entry: self.manifest.entry.clone(),
            path: self.plugin_dir.to_string_lossy().to_string(),
            enabled: self.enabled,
            loaded: self.loaded,
            capabilities: self.manifest.capabilities.clone(),
            contributes: self.manifest.contributes.clone(),
            last_error: self.last_error.clone(),
            log_count: self
                .abi_storage
                .as_ref()
                .and_then(|s| s.userdata())
                .map(|u| u.log.lock().map(|g| g.len()).unwrap_or(0))
                .unwrap_or(0),
        }
    }

    pub fn log_lines(&self) -> Vec<String> {
        self.abi_storage
            .as_ref()
            .and_then(|s| s.userdata())
            .and_then(|u| u.log.lock().ok().map(|g| g.to_vec()))
            .unwrap_or_default()
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct EnabledStore {
    /// plugin_id -> enabled（缺省 true）
    #[serde(default)]
    plugins: HashMap<String, bool>,
}

pub struct Registry {
    /// id -> plugin entry
    plugins: HashMap<String, LoadedPlugin>,
    /// 扫描到但尚未 load 的路径
    known_paths: HashMap<String, PathBuf>,
    /// 插件根目录
    plugin_base: PathBuf,
    /// enabled 持久化路径
    enabled_path: PathBuf,
}

impl Registry {
    pub fn new(plugin_base: PathBuf, enabled_path: PathBuf) -> Self {
        Self {
            plugins: HashMap::new(),
            known_paths: HashMap::new(),
            plugin_base,
            enabled_path,
        }
    }

    pub fn plugin_base(&self) -> &Path {
        &self.plugin_base
    }

    pub fn load_enabled_store(&mut self) {
        if !self.enabled_path.exists() {
            return;
        }
        if let Ok(content) = std::fs::read_to_string(&self.enabled_path) {
            if let Ok(store) = serde_json::from_str::<EnabledStore>(&content) {
                for (id, enabled) in store.plugins {
                    if let Some(p) = self.plugins.get_mut(&id) {
                        p.enabled = enabled;
                    }
                }
            }
        }
    }

    pub fn persist_enabled(&self) -> AppResult<()> {
        let mut store = EnabledStore::default();
        for (id, p) in &self.plugins {
            store.plugins.insert(id.clone(), p.enabled);
        }
        if let Some(parent) = self.enabled_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::io_error(format!("create enabled store dir: {}", e)))?;
        }
        let json = serde_json::to_string_pretty(&store)
            .map_err(|e| AppError::new("SERIALIZE_ERROR", e.to_string()))?;
        std::fs::write(&self.enabled_path, json)
            .map_err(|e| AppError::io_error(format!("write enabled store: {}", e)))?;
        Ok(())
    }

    pub fn remember_path(&mut self, id: &str, dir: PathBuf) {
        self.known_paths.insert(id.to_string(), dir.clone());
        if let Some(p) = self.plugins.get_mut(id) {
            p.plugin_dir = dir;
        }
    }

    pub fn resolve_dir(&self, id: &str) -> Option<PathBuf> {
        if let Some(p) = self.plugins.get(id) {
            return Some(p.plugin_dir.clone());
        }
        if let Some(d) = self.known_paths.get(id) {
            return Some(d.clone());
        }
        // 安装约定：plugins/<manifest.id>/
        let candidate = self.plugin_base.join(id);
        if candidate.exists() {
            return Some(candidate);
        }
        None
    }

    /// 若当前目录缺少 entry dll，尝试 `plugin_base/<id>` 安装目录。
    pub fn resolve_load_dir(&self, id: &str, entry: &str) -> Option<PathBuf> {
        let candidates = [
            self.resolve_dir(id),
            Some(self.plugin_base.join(id)),
        ];
        for dir in candidates.into_iter().flatten() {
            if crate::plugin_host::manifest::resolve_plugin_entry(&dir, entry)
                .map(|p| p.exists())
                .unwrap_or(false)
            {
                return Some(dir);
            }
        }
        self.resolve_dir(id)
    }

    pub fn get(&self, id: &str) -> Option<&LoadedPlugin> {
        self.plugins.get(id)
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut LoadedPlugin> {
        self.plugins.get_mut(id)
    }

    pub fn insert(&mut self, plugin: LoadedPlugin) {
        self.known_paths
            .insert(plugin.manifest.id.clone(), plugin.plugin_dir.clone());
        self.plugins.insert(plugin.manifest.id.clone(), plugin);
    }

    pub fn remove(&mut self, id: &str) -> Option<LoadedPlugin> {
        self.known_paths.remove(id);
        self.plugins.remove(id)
    }

    pub fn list_runtime(&self) -> Vec<PluginHostRuntimeInfo> {
        let mut list: Vec<PluginHostRuntimeInfo> =
            self.plugins.values().map(|p| p.runtime_info()).collect();
        list.sort_by(|a, b| a.id.cmp(&b.id));
        list
    }

    #[allow(dead_code)]
    pub fn manifests(&self) -> Vec<PluginHostManifest> {
        let mut list: Vec<PluginHostManifest> =
            self.plugins.values().map(|p| p.manifest.clone()).collect();
        list.sort_by(|a, b| a.id.cmp(&b.id));
        list
    }

    #[allow(dead_code)]
    pub fn enabled_map(&self) -> HashMap<String, bool> {
        self.plugins
            .iter()
            .map(|(k, v)| (k.clone(), v.enabled))
            .collect()
    }
}

/// Tauri State：注册表 + AppHandle。
pub struct PluginHostState {
    pub registry: Mutex<Registry>,
    pub app: Mutex<Option<AppHandle>>,
}

impl PluginHostState {
    pub fn new(plugin_base: PathBuf, enabled_path: PathBuf, app: AppHandle) -> Self {
        let mut registry = Registry::new(plugin_base, enabled_path);
        registry.load_enabled_store();
        Self {
            registry: Mutex::new(registry),
            app: Mutex::new(Some(app)),
        }
    }

    pub fn app_handle(&self) -> Option<AppHandle> {
        self.app.lock().ok().and_then(|g| g.clone())
    }
}

/// 初始化并 manage PluginHostState。在 `setup` 中调用。
pub fn init_plugin_host(handle: &AppHandle) {
    let plugin_base = crate::plugin_host::plugin_base_directory();
    let enabled_path = host_state_path(handle);
    let _ = std::fs::create_dir_all(&plugin_base);
    if let Some(parent) = enabled_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let state = PluginHostState::new(plugin_base, enabled_path, handle.clone());
    handle.manage(state);
}

fn host_state_path(handle: &AppHandle) -> PathBuf {
    let app_data = handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    app_data
        .join("plugin-host")
        .join("enabled.json")
}

/// 共享日志写入（供 loader / host_invoke 使用）。
pub fn push_log(log: &Arc<Mutex<RingLog>>, level: i32, message: &str) {
    use crate::plugin_host::abi::level_name;
    let ts = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let line = format!("[{}] [{}] {}", ts, level_name(level), message);
    if let Ok(mut guard) = log.lock() {
        guard.push(line);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_host::manifest::PluginHostContributes;

    fn sample_manifest(id: &str) -> PluginHostManifest {
        PluginHostManifest {
            manifest_version: 2,
            id: id.to_string(),
            name: format!("Plugin {}", id),
            version: "0.1.0".into(),
            runtime: "rust".into(),
            entry: "p.dll".into(),
            description: String::new(),
            author: "Air".into(),
            capabilities: vec!["log".into()],
            contributes: PluginHostContributes::default(),
        }
    }

    #[test]
    fn ring_log_caps() {
        let mut log = RingLog::new(3);
        for i in 0..5 {
            log.push(format!("line{}", i));
        }
        let v = log.to_vec();
        assert_eq!(v.len(), 3);
        assert_eq!(v[0], "line2");
        assert_eq!(v[2], "line4");
    }

    #[test]
    fn registry_insert_list_remove() {
        let base = std::env::temp_dir().join("air-ph-test-reg");
        let enabled = base.join("enabled.json");
        let mut reg = Registry::new(base, enabled);
        let plugin_dir = PathBuf::from("plugins/com.air.example.rust");
        reg.insert(LoadedPlugin {
            manifest: sample_manifest("com.air.example.rust"),
            plugin_dir: plugin_dir.clone(),
            enabled: true,
            loaded: false,
            last_error: None,
            library: None,
            fns: None,
            abi_storage: None,
        });
        let list = reg.list_runtime();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "com.air.example.rust");
        assert!(list[0].enabled);
        assert!(!list[0].loaded);
        assert_eq!(
            reg.resolve_dir("com.air.example.rust").unwrap(),
            plugin_dir
        );
        let removed = reg.remove("com.air.example.rust").unwrap();
        assert_eq!(removed.manifest.id, "com.air.example.rust");
        assert!(reg.list_runtime().is_empty());
    }

    #[test]
    fn enabled_persist_roundtrip() {
        let dir = std::env::temp_dir().join(format!(
            "air-ph-enabled-{}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&dir);
        let enabled_path = dir.join("enabled.json");
        {
            let mut reg = Registry::new(dir.join("plugins"), enabled_path.clone());
            reg.insert(LoadedPlugin {
                manifest: sample_manifest("p1"),
                plugin_dir: dir.join("plugins/p1"),
                enabled: false,
                loaded: false,
                last_error: None,
                library: None,
                fns: None,
                abi_storage: None,
            });
            reg.persist_enabled().unwrap();
        }
        {
            let mut reg = Registry::new(dir.join("plugins"), enabled_path.clone());
            // 模拟 scan 后再 load enabled store
            reg.insert(LoadedPlugin {
                manifest: sample_manifest("p1"),
                plugin_dir: dir.join("plugins/p1"),
                enabled: true,
                loaded: false,
                last_error: None,
                library: None,
                fns: None,
                abi_storage: None,
            });
            reg.load_enabled_store();
            assert!(!reg.get("p1").unwrap().enabled);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
