//! libloading 加载器 + HostVTable 分发（capability 门在 host_invoke 内强制）。

use crate::error::{AppError, AppResult};
use crate::plugin_host::abi::{
    self, AirHostVTable, InvokeEnvelope, PluginFns, AIR_PLUGIN_ABI_VERSION,
};
use crate::plugin_host::capability::{self, CAP_EVENTS_EMIT, CAP_LAUNCHER_LAUNCH, CAP_LAUNCHER_READ};
use crate::plugin_host::manifest::{
    parse_manifest_str, read_manifest_file, resolve_plugin_entry, PluginHostManifest,
};
use crate::plugin_host::registry::{push_log, LoadedPlugin, RingLog, LOG_RING_CAPACITY};
use std::collections::HashSet;
use std::ffi::{c_char, c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

/// 持有跨 DLL 的 ABI 指针（AirHostVTable + HostUserData）。
///
/// raw pointer 本身不是 Send/Sync；宿主保证这些指针只在 PluginHostState 的
/// Mutex 注册表内使用，且 HostUserData 字段自身可跨线程。
pub struct PluginAbiStorage {
    vtable: *mut AirHostVTable,
    userdata: *mut HostUserData,
}

unsafe impl Send for PluginAbiStorage {}
unsafe impl Sync for PluginAbiStorage {}

impl PluginAbiStorage {
    pub fn from_boxes(vtable: Box<AirHostVTable>, userdata: Box<HostUserData>) -> Self {
        let userdata_ptr = Box::into_raw(userdata);
        // vtable.user_data 在构造时已指向同一 HostUserData
        let vtable_ptr = Box::into_raw(vtable);
        Self {
            vtable: vtable_ptr,
            userdata: userdata_ptr,
        }
    }

    #[allow(dead_code)]
    pub fn vtable_ptr(&self) -> *const AirHostVTable {
        self.vtable as *const AirHostVTable
    }

    pub fn userdata(&self) -> Option<&HostUserData> {
        if self.userdata.is_null() {
            None
        } else {
            Some(unsafe { &*self.userdata })
        }
    }
}

impl Drop for PluginAbiStorage {
    fn drop(&mut self) {
        if !self.vtable.is_null() {
            unsafe { drop(Box::from_raw(self.vtable)) };
            self.vtable = std::ptr::null_mut();
        }
        if !self.userdata.is_null() {
            unsafe { drop(Box::from_raw(self.userdata)) };
            self.userdata = std::ptr::null_mut();
        }
    }
}

/// 传给插件 `air_plugin_init` 的 user_data。
pub struct HostUserData {
    pub plugin_id: String,
    pub capabilities: HashSet<String>,
    pub app: Option<AppHandle>,
    pub log: Arc<Mutex<RingLog>>,
    /// host_invoke 返回字符串，卸载时统一释放。
    pub host_strings: Mutex<Vec<CString>>,
}

impl HostUserData {
    fn append_host_string(&self, s: CString) -> *mut c_char {
        let ptr = s.as_ptr() as *mut c_char;
        if let Ok(mut guard) = self.host_strings.lock() {
            // 防止无限增长：超过阈值时丢弃旧指针的持有（插件应已拷贝）。
            // 注意：过早 drop 会导致悬垂指针，因此仅在极端情况下清空且文档约定插件立即拷贝。
            if guard.len() > 512 {
                guard.clear();
            }
            guard.push(s);
        } else {
            // lock 失败时泄漏该字符串，避免 UAF
            std::mem::forget(s);
        }
        ptr
    }
}

impl Drop for HostUserData {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.host_strings.lock() {
            guard.clear();
        }
    }
}

// --- HostVTable extern "C" 实现 ---

extern "C" fn host_log_cb(user_data: *mut c_void, level: i32, msg: *const c_char) {
    if user_data.is_null() || msg.is_null() {
        return;
    }
    let ud = unsafe { &*(user_data as *const HostUserData) };
    let text = unsafe { CStr::from_ptr(msg) }.to_string_lossy().into_owned();
    push_log(&ud.log, level, &text);
}

extern "C" fn host_invoke_cb(
    user_data: *mut c_void,
    method: *const c_char,
    args: *const c_char,
) -> *mut c_char {
    if user_data.is_null() || method.is_null() {
        return std::ptr::null_mut();
    }
    let ud = unsafe { &*(user_data as *const HostUserData) };
    let method = unsafe { CStr::from_ptr(method) }
        .to_string_lossy()
        .into_owned();
    let args_json: serde_json::Value = if args.is_null() {
        serde_json::Value::Null
    } else {
        let raw = unsafe { CStr::from_ptr(args) }.to_string_lossy().into_owned();
        serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null)
    };

    let envelope = match dispatch_host_invoke(ud, &method, &args_json) {
        Ok(data) => InvokeEnvelope {
            ok: true,
            data: Some(data),
            error: None,
        },
        Err(e) => InvokeEnvelope {
            ok: false,
            data: None,
            error: Some(serde_json::json!({
                "code": e.code,
                "message": e.message,
                "details": e.details,
            })),
        },
    };

    let json = serde_json::to_string(&envelope)
        .unwrap_or_else(|_| r#"{"ok":false,"error":{"code":"INTERNAL_ERROR","message":"serialize failed"}}"#.to_string());
    match CString::new(json) {
        Ok(c) => ud.append_host_string(c),
        Err(_) => std::ptr::null_mut(),
    }
}

/// 宿主能力分发：**所有敏感 method 在此做 capability 强制**。
pub fn dispatch_host_invoke(
    ud: &HostUserData,
    method: &str,
    args: &serde_json::Value,
) -> AppResult<serde_json::Value> {
    // 真实 capability 检查（未声明则 capability_denied）
    capability::enforce(&ud.capabilities, method)?;

    let method = method.trim();
    match method {
        // --- log：始终允许 ---
        m if m == "log"
            || m.starts_with("log.")
            || capability::required_capability(m).is_none() =>
        {
            let level = args
                .get("level")
                .and_then(|v| v.as_i64())
                .unwrap_or(abi::LOG_INFO as i64) as i32;
            let message = args
                .get("message")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| args.to_string());
            push_log(&ud.log, level, &message);
            Ok(serde_json::json!({ "logged": true }))
        }

        // --- launcher.read ---
        m if m == CAP_LAUNCHER_READ || m.starts_with("launcher.read") => {
            handle_launcher_read(ud, args)
        }

        // --- launcher.launch ---
        m if m == CAP_LAUNCHER_LAUNCH || m.starts_with("launcher.launch") => {
            handle_launcher_launch(ud, args)
        }

        // --- events.emit ---
        m if m == CAP_EVENTS_EMIT || m.starts_with("events.") => handle_events_emit(ud, args),

        // --- fs / net：能力检查已通过则尚未实现 ---
        m if m.starts_with("fs.") || m.starts_with("net.") => Err(AppError::new(
            "NOT_IMPLEMENTED",
            format!("Host method '{}' is not implemented yet", m),
        )),

        // --- 未知但已声明同名 capability ---
        m => Err(AppError::new(
            "NOT_IMPLEMENTED",
            format!("Host method '{}' is not implemented", m),
        )),
    }
}

fn handle_launcher_read(
    ud: &HostUserData,
    args: &serde_json::Value,
) -> AppResult<serde_json::Value> {
    let Some(app) = ud.app.as_ref() else {
        // 受控 stub：能力已注册但宿主未注入 AppHandle
        return Ok(serde_json::json!({
            "stub": true,
            "capability": CAP_LAUNCHER_READ,
            "categories": [],
            "note": "launcher.read capability granted; AppHandle unavailable"
        }));
    };

    let scope = args
        .get("scope")
        .and_then(|v| v.as_str())
        .unwrap_or("all");

    let manager = app.state::<crate::config::ConfigManager>();
    let data = manager.load_launcher_data();

    match scope {
        "categories" => Ok(serde_json::json!({
            "categories": data.categories.iter().map(|c| serde_json::json!({
                "id": c.id,
                "name": c.name,
                "item_count": c.items.len(),
            })).collect::<Vec<_>>(),
        })),
        "favorites" => Ok(serde_json::json!({
            "favorite_item_ids": data.favorite_item_ids,
        })),
        "recent" => Ok(serde_json::json!({
            "recent": data.recent_used_items,
        })),
        _ => Ok(serde_json::to_value(&data).map_err(|e| {
            AppError::new("SERIALIZE_ERROR", format!("launcher data serialize: {}", e))
        })?),
    }
}

fn handle_launcher_launch(
    ud: &HostUserData,
    args: &serde_json::Value,
) -> AppResult<serde_json::Value> {
    let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::invalid_input("launcher.launch requires args.path"))?;
    let item_type = args.get("item_type").and_then(|v| v.as_str()).map(|s| s.to_string());

    // 复用既有 system 能力（不修改 clipboard/config/search 领域实现）
    if item_type.as_deref() == Some("url")
        || path.starts_with("http://")
        || path.starts_with("https://")
    {
        crate::system::open_url(path.to_string())?;
    } else {
        crate::system::open_path(path.to_string())?;
    }

    push_log(
        &ud.log,
        abi::LOG_INFO,
        &format!("launcher.launch ok: {}", path),
    );
    Ok(serde_json::json!({ "launched": path }))
}

fn handle_events_emit(ud: &HostUserData, args: &serde_json::Value) -> AppResult<serde_json::Value> {
    let event_name = args
        .get("event")
        .or_else(|| args.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("plugin.event");
    let payload = args.get("payload").cloned().unwrap_or(serde_json::Value::Null);

    let body = serde_json::json!({
        "plugin_id": ud.plugin_id,
        "event": event_name,
        "payload": payload,
    });

    if let Some(app) = ud.app.as_ref() {
        let _ = app.emit("plugin_host_event", &body);
        // 同时发一条通用总线事件，便于前端统一订阅
        let _ = app.emit("plugin_host_bus", &body);
    }

    push_log(
        &ud.log,
        abi::LOG_INFO,
        &format!("events.emit: {}", event_name),
    );
    Ok(serde_json::json!({ "emitted": true, "event": event_name }))
}

// --- DLL 加载 ---

/// 从插件目录加载 cdylib 并完成 init。
pub fn load_plugin_dll(
    plugin_dir: &Path,
    manifest: &PluginHostManifest,
    enabled: bool,
    app: Option<AppHandle>,
) -> AppResult<LoadedPlugin> {
    let dll_path = resolve_plugin_entry(plugin_dir, &manifest.entry)?;
    if !dll_path.exists() {
        return Err(AppError::not_found(format!(
            "Plugin library not found: {:?}",
            dll_path
        )));
    }

    let log = Arc::new(Mutex::new(RingLog::new(LOG_RING_CAPACITY)));
    let capabilities = capability::parse_capabilities(&manifest.capabilities);

    let host_userdata = Box::new(HostUserData {
        plugin_id: manifest.id.clone(),
        capabilities,
        app,
        log: log.clone(),
        host_strings: Mutex::new(Vec::new()),
    });
    let userdata_ptr = host_userdata.as_ref() as *const HostUserData as *mut c_void;

    let vtable = Box::new(AirHostVTable {
        abi_version: AIR_PLUGIN_ABI_VERSION,
        user_data: userdata_ptr,
        log: host_log_cb,
        host_invoke: host_invoke_cb,
    });
    let vtable_ptr = vtable.as_ref() as *const AirHostVTable;

    let library = unsafe { libloading::Library::new(&dll_path) }.map_err(|e| {
        AppError::new(
            "PLUGIN_LOAD_ERROR",
            format!("Failed to load plugin library {:?}: {}", dll_path, e),
        )
    })?;

    // 必需符号
    let abi_fn: libloading::Symbol<abi::AbiVersionFn> = unsafe {
        library
            .get(abi::SYM_ABI_VERSION)
            .map_err(|e| missing_sym("air_plugin_abi_version", e))?
    };
    let manifest_fn: libloading::Symbol<abi::ManifestFn> = unsafe {
        library
            .get(abi::SYM_MANIFEST)
            .map_err(|e| missing_sym("air_plugin_manifest", e))?
    };
    let init_fn: libloading::Symbol<abi::InitFn> = unsafe {
        library
            .get(abi::SYM_INIT)
            .map_err(|e| missing_sym("air_plugin_init", e))?
    };
    let invoke_fn: libloading::Symbol<abi::InvokeFn> = unsafe {
        library
            .get(abi::SYM_INVOKE)
            .map_err(|e| missing_sym("air_plugin_invoke", e))?
    };
    let free_fn: libloading::Symbol<abi::FreeStringFn> = unsafe {
        library
            .get(abi::SYM_FREE_STRING)
            .map_err(|e| missing_sym("air_plugin_free_string", e))?
    };
    let shutdown_fn: libloading::Symbol<abi::ShutdownFn> = unsafe {
        library
            .get(abi::SYM_SHUTDOWN)
            .map_err(|e| missing_sym("air_plugin_shutdown", e))?
    };

    // 可选符号
    let on_event_fn: Option<libloading::Symbol<abi::OnEventFn>> =
        unsafe { library.get(abi::SYM_ON_EVENT).ok() };

    let abi_version = unsafe { abi_fn() };
    if abi_version != AIR_PLUGIN_ABI_VERSION {
        return Err(AppError::new(
            "ABI_MISMATCH",
            format!(
                "Plugin ABI version {} is not supported (host expects {})",
                abi_version, AIR_PLUGIN_ABI_VERSION
            ),
        ));
    }

    // DLL 内嵌 manifest（与文件 manifest 校验一致性）
    let dll_manifest_raw = unsafe { manifest_fn() };
    if !dll_manifest_raw.is_null() {
        let json = unsafe { CStr::from_ptr(dll_manifest_raw) }
            .to_string_lossy()
            .into_owned();
        unsafe { free_fn(dll_manifest_raw) };
        if let Ok(embedded) = parse_manifest_str(&json) {
            if embedded.id != manifest.id {
                return Err(AppError::new(
                    "MANIFEST_MISMATCH",
                    format!(
                        "DLL manifest id '{}' does not match folder manifest id '{}'",
                        embedded.id, manifest.id
                    ),
                ));
            }
        }
    }

    // init
    let rc = unsafe { init_fn(vtable_ptr, userdata_ptr) };
    if rc != 0 {
        return Err(AppError::new(
            "PLUGIN_INIT_ERROR",
            format!("Plugin init returned {}", rc),
        ));
    }

    // 拷贝函数指针（Symbol 生命周期绑定 Library，这里转成裸 fn）
    let fns = PluginFns {
        invoke: *invoke_fn,
        free_string: *free_fn,
        shutdown: *shutdown_fn,
        on_event: on_event_fn.map(|s| *s),
    };

    push_log(
        &log,
        abi::LOG_INFO,
        &format!("Plugin loaded from {:?}", dll_path),
    );

    let storage = PluginAbiStorage::from_boxes(vtable, host_userdata);
    // HostUserData 地址在 from_boxes 前已写入 vtable.user_data
    let _ = &storage;

    Ok(LoadedPlugin {
        manifest: manifest.clone(),
        plugin_dir: plugin_dir.to_path_buf(),
        enabled,
        loaded: true,
        last_error: None,
        library: Some(library),
        fns: Some(fns),
        abi_storage: Some(storage),
    })
}

fn missing_sym(name: &str, e: libloading::Error) -> AppError {
    AppError::new(
        "PLUGIN_SYMBOL_MISSING",
        format!("Required plugin symbol '{}' missing: {}", name, e),
    )
}

/// 卸载：shutdown → drop Library / vtable / userdata。
pub fn unload_plugin(plugin: &mut LoadedPlugin) -> AppResult<()> {
    if !plugin.loaded {
        return Ok(());
    }
    if let Some(fns) = plugin.fns.take() {
        unsafe { (fns.shutdown)() };
    }
    // 可选 on_event 不需要单独清理
    plugin.library = None;
    plugin.abi_storage = None;
    plugin.loaded = false;
    Ok(())
}

/// 调用插件 `air_plugin_invoke`。
pub fn invoke_plugin(
    plugin: &LoadedPlugin,
    method: &str,
    args: &serde_json::Value,
) -> AppResult<serde_json::Value> {
    if !plugin.loaded {
        return Err(AppError::new(
            "PLUGIN_NOT_LOADED",
            format!("Plugin '{}' is not loaded", plugin.manifest.id),
        ));
    }
    if !plugin.enabled {
        return Err(AppError::new(
            "PLUGIN_DISABLED",
            format!("Plugin '{}' is disabled", plugin.manifest.id),
        ));
    }

    let fns = plugin
        .fns
        .ok_or_else(|| AppError::internal("Plugin function table missing"))?;

    let method_c = CString::new(method)
        .map_err(|_| AppError::invalid_input("method contains NUL"))?;
    let args_str = if args.is_null() {
        "{}".to_string()
    } else {
        serde_json::to_string(args)?
    };
    let args_c =
        CString::new(args_str).map_err(|_| AppError::invalid_input("args contain NUL"))?;

    let raw = unsafe { (fns.invoke)(method_c.as_ptr(), args_c.as_ptr()) };
    if raw.is_null() {
        return Err(AppError::internal(format!(
            "Plugin '{}' invoke('{}') returned null",
            plugin.manifest.id, method
        )));
    }

    let json = unsafe { CStr::from_ptr(raw) }
        .to_string_lossy()
        .into_owned();
    unsafe { (fns.free_string)(raw) };

    let envelope: InvokeEnvelope = serde_json::from_str(&json)
        .map_err(|e| AppError::new("PARSE_ERROR", format!("Plugin invoke envelope: {}", e)))?;

    if envelope.ok {
        Ok(envelope.data.unwrap_or(serde_json::Value::Null))
    } else {
        let err_val = envelope.error.unwrap_or(serde_json::Value::Null);
        let code = err_val
            .get("code")
            .and_then(|v| v.as_str())
            .unwrap_or("PLUGIN_INVOKE_ERROR")
            .to_string();
        let message = err_val
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("plugin invoke failed")
            .to_string();
        Err(AppError::new(code, message).with_details(err_val))
    }
}

/// 通知插件事件（可选符号）。
pub fn notify_plugin_event(plugin: &LoadedPlugin, event_json: &str) -> AppResult<()> {
    if !plugin.loaded {
        return Ok(());
    }
    if let Some(fns) = plugin.fns {
        if let Some(on_event) = fns.on_event {
            let c = CString::new(event_json)
                .map_err(|_| AppError::invalid_input("event contains NUL"))?;
            unsafe { on_event(c.as_ptr()) };
        }
    }
    Ok(())
}

/// 读取插件目录中的 manifest（scan 用）。
pub fn try_read_manifest_in_dir(dir: &Path) -> Option<(PluginHostManifest, PathBuf)> {
    let manifest_path = dir.join("manifest.json");
    if !manifest_path.exists() {
        return None;
    }
    read_manifest_file(&manifest_path)
        .ok()
        .filter(|m| m.is_rust_plugin())
        .map(|m| (m, dir.to_path_buf()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_host::registry::RingLog;

    fn make_ud(caps: &[&str]) -> HostUserData {
        HostUserData {
            plugin_id: "test".into(),
            capabilities: caps.iter().map(|s| s.to_string()).collect(),
            app: None,
            log: Arc::new(Mutex::new(RingLog::new(16))),
            host_strings: Mutex::new(Vec::new()),
        }
    }

    #[test]
    fn host_invoke_log_allowed_without_capability() {
        let ud = make_ud(&[]);
        let r = dispatch_host_invoke(
            &ud,
            "log",
            &serde_json::json!({"level": 2, "message": "hello host"}),
        );
        assert!(r.is_ok());
        let lines = ud.log.lock().unwrap().to_vec();
        assert!(lines.iter().any(|l| l.contains("hello host")));
    }

    #[test]
    fn host_invoke_denies_undeclared_capability() {
        let ud = make_ud(&["log"]);
        let err = dispatch_host_invoke(&ud, "launcher.launch", &serde_json::json!({"path": "x"}))
            .unwrap_err();
        assert_eq!(err.code, capability::ERROR_CAPABILITY_DENIED);
    }

    #[test]
    fn host_invoke_launcher_read_stub_without_app() {
        let ud = make_ud(&["launcher.read"]);
        let r = dispatch_host_invoke(&ud, "launcher.read", &serde_json::Value::Null).unwrap();
        // 无 AppHandle 时返回受控 stub
        assert_eq!(r["capability"], CAP_LAUNCHER_READ);
        assert_eq!(r["stub"], true);
    }

    #[test]
    fn host_invoke_events_emit_without_app_still_ok() {
        let ud = make_ud(&["events.emit"]);
        let r = dispatch_host_invoke(
            &ud,
            "events.emit",
            &serde_json::json!({"event": "ping", "payload": {"n": 1}}),
        )
        .unwrap();
        assert_eq!(r["emitted"], true);
        assert_eq!(r["event"], "ping");
    }

    #[test]
    fn host_invoke_fs_not_implemented_after_capability() {
        let ud = make_ud(&["fs"]);
        let err = dispatch_host_invoke(&ud, "fs.read_text", &serde_json::json!({})).unwrap_err();
        assert_eq!(err.code, "NOT_IMPLEMENTED");
    }

    #[test]
    fn missing_dll_returns_not_found() {
        use crate::plugin_host::manifest::PluginHostContributes;
        let manifest = PluginHostManifest {
            manifest_version: 2,
            id: "com.air.none".into(),
            name: "none".into(),
            version: "0.0.0".into(),
            runtime: "rust".into(),
            entry: "missing.dll".into(),
            description: String::new(),
            author: String::new(),
            capabilities: vec![],
            contributes: PluginHostContributes::default(),
        };
        let dir = std::env::temp_dir().join("air-ph-missing-dll");
        let _ = std::fs::create_dir_all(&dir);
        let err = match load_plugin_dll(&dir, &manifest, true, None) {
            Err(e) => e,
            Ok(_) => panic!("expected missing dll error"),
        };
        assert_eq!(err.code, "NOT_FOUND");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
