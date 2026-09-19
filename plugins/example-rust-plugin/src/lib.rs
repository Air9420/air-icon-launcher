//! Air Icon Launcher — 示例 Rust 能力插件（cdylib ABI v1）。
//!
//! 导出符号：
//! - `air_plugin_abi_version`
//! - `air_plugin_manifest`
//! - `air_plugin_init`
//! - `air_plugin_invoke`
//! - `air_plugin_on_event`（可选）
//! - `air_plugin_free_string`
//! - `air_plugin_shutdown`
//!
//! 构建（Windows）：
//! ```powershell
//! cd plugins/example-rust-plugin
//! cargo build --release
//! # 将 target/release/air_example_rust.dll 与 manifest.json
//! # 一并复制到 <repo>/plugins/com.air.example.rust/
//! # 或直接复制到本目录后通过 plugin_host_* 加载
//! ```

use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::Mutex;

pub const ABI_VERSION: u32 = 1;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct AirHostVTable {
    pub abi_version: u32,
    pub user_data: *mut c_void,
    pub log: extern "C" fn(*mut c_void, level: i32, msg: *const c_char),
    pub host_invoke:
        extern "C" fn(*mut c_void, method: *const c_char, args: *const c_char) -> *mut c_char,
}

/// 将 vtable 拆成 Send 友好字段存入 static（原始指针以 usize 保存）。
struct PluginState {
    user_data: usize,
    log_fn: Option<extern "C" fn(*mut c_void, i32, *const c_char)>,
    host_invoke_fn:
        Option<extern "C" fn(*mut c_void, *const c_char, *const c_char) -> *mut c_char>,
    greeting_count: u64,
}

static STATE: Mutex<PluginState> = Mutex::new(PluginState {
    user_data: 0,
    log_fn: None,
    host_invoke_fn: None,
    greeting_count: 0,
});

fn host_log(level: i32, msg: &str) {
    if let Ok(st) = STATE.lock() {
        if let Some(log_fn) = st.log_fn {
            if st.user_data != 0 {
                if let Ok(c) = CString::new(msg) {
                    log_fn(st.user_data as *mut c_void, level, c.as_ptr());
                }
            }
        }
    }
}

/// 调用宿主 host_invoke；返回解析后的 JSON Value（宿主信封 {"ok":...}）。
fn host_invoke(method: &str, args: &serde_json::Value) -> Result<serde_json::Value, String> {
    let (user_data, invoke_fn) = {
        let st = STATE
            .lock()
            .map_err(|_| "plugin state lock poisoned".to_string())?;
        (st.user_data, st.host_invoke_fn)
    };
    let invoke_fn = invoke_fn.ok_or_else(|| "host vtable not initialized".to_string())?;
    if user_data == 0 {
        return Err("host user_data is null".to_string());
    }

    let method_c = CString::new(method).map_err(|e| e.to_string())?;
    let args_c = CString::new(args.to_string()).map_err(|e| e.to_string())?;
    let raw = invoke_fn(
        user_data as *mut c_void,
        method_c.as_ptr(),
        args_c.as_ptr(),
    );
    if raw.is_null() {
        return Err("host_invoke returned null".to_string());
    }
    // 宿主约定：返回串由宿主持有并在卸载时释放；插件只拷贝。
    let json = unsafe { CStr::from_ptr(raw) }.to_string_lossy().into_owned();
    let value: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| format!("host_invoke parse: {}", e))?;
    if value.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        Ok(value.get("data").cloned().unwrap_or(serde_json::Value::Null))
    } else {
        let err = value
            .get("error")
            .map(|e| e.to_string())
            .unwrap_or_else(|| "host_invoke failed".to_string());
        Err(err)
    }
}

fn ok_envelope(data: serde_json::Value) -> CString {
    let env = serde_json::json!({ "ok": true, "data": data });
    CString::new(env.to_string()).unwrap_or_else(|_| CString::new("{\"ok\":true}").unwrap())
}

fn err_envelope(code: &str, message: &str) -> CString {
    let env = serde_json::json!({
        "ok": false,
        "error": { "code": code, "message": message }
    });
    CString::new(env.to_string())
        .unwrap_or_else(|_| CString::new("{\"ok\":false}").unwrap())
}

#[no_mangle]
pub extern "C" fn air_plugin_abi_version() -> u32 {
    ABI_VERSION
}

#[no_mangle]
pub extern "C" fn air_plugin_manifest() -> *mut c_char {
    // 与仓库内 manifest.json 保持一致（宿主会交叉校验 id）
    let json = include_str!("../manifest.json");
    match CString::new(json) {
        Ok(c) => c.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub extern "C" fn air_plugin_init(host: *const AirHostVTable, _user_data: *mut c_void) -> i32 {
    if host.is_null() {
        return -1;
    }
    let vt = unsafe { &*host };
    if vt.abi_version != ABI_VERSION {
        return -2;
    }
    if let Ok(mut st) = STATE.lock() {
        st.user_data = vt.user_data as usize;
        st.log_fn = Some(vt.log);
        st.host_invoke_fn = Some(vt.host_invoke);
        st.greeting_count = 0;
    }
    host_log(2, "air_example_rust initialized");
    0
}

#[no_mangle]
pub extern "C" fn air_plugin_invoke(
    method: *const c_char,
    args_json: *const c_char,
) -> *mut c_char {
    if method.is_null() {
        return err_envelope("INVALID_INPUT", "method is null").into_raw();
    }
    let method = unsafe { CStr::from_ptr(method) }
        .to_string_lossy()
        .into_owned();
    let args: serde_json::Value = if args_json.is_null() {
        serde_json::Value::Null
    } else {
        let raw = unsafe { CStr::from_ptr(args_json) }
            .to_string_lossy()
            .into_owned();
        serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null)
    };

    match method.as_str() {
        "hello" => {
            let name = args
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("World");
            let count = {
                let mut st = STATE.lock().unwrap();
                st.greeting_count += 1;
                st.greeting_count
            };
            // 演示 capability=log（始终允许）
            let _ = host_invoke(
                "log",
                &serde_json::json!({
                    "level": 2,
                    "message": format!("hello called for {}", name)
                }),
            );
            ok_envelope(serde_json::json!({
                "greeting": format!("Hello, {}! (from Rust plugin)", name),
                "plugin": "com.air.example.rust",
                "count": count,
            }))
            .into_raw()
        }
        "launcher_summary" => {
            // 演示 capability=launcher.read（未声明会被宿主 capability_denied）
            match host_invoke("launcher.read", &serde_json::json!({ "scope": "categories" })) {
                Ok(data) => ok_envelope(data).into_raw(),
                Err(e) => err_envelope("HOST_INVOKE_ERROR", &e).into_raw(),
            }
        }
        "emit_ping" => {
            // 演示 capability=events.emit
            match host_invoke(
                "events.emit",
                &serde_json::json!({
                    "event": "example.ping",
                    "payload": { "from": "com.air.example.rust", "msg": "pong" }
                }),
            ) {
                Ok(data) => ok_envelope(data).into_raw(),
                Err(e) => err_envelope("HOST_INVOKE_ERROR", &e).into_raw(),
            }
        }
        "try_launch" => {
            // 本示例 manifest 未声明 launcher.launch → 宿主应返回 capability_denied
            match host_invoke(
                "launcher.launch",
                &serde_json::json!({ "path": "https://example.com" }),
            ) {
                Ok(data) => ok_envelope(data).into_raw(),
                Err(e) => err_envelope("CAPABILITY_DENIED", &e).into_raw(),
            }
        }
        "echo" => ok_envelope(args).into_raw(),
        other => err_envelope(
            "METHOD_NOT_FOUND",
            &format!("Unknown plugin method '{}'", other),
        )
        .into_raw(),
    }
}

/// 可选：宿主事件通知。
#[no_mangle]
pub extern "C" fn air_plugin_on_event(event_json: *const c_char) {
    if event_json.is_null() {
        return;
    }
    let raw = unsafe { CStr::from_ptr(event_json) }
        .to_string_lossy()
        .into_owned();
    host_log(1, &format!("on_event: {}", raw));
}

#[no_mangle]
pub extern "C" fn air_plugin_free_string(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    unsafe {
        drop(CString::from_raw(ptr));
    }
}

#[no_mangle]
pub extern "C" fn air_plugin_shutdown() {
    host_log(2, "air_example_rust shutdown");
    if let Ok(mut st) = STATE.lock() {
        st.user_data = 0;
        st.log_fn = None;
        st.host_invoke_fn = None;
    }
}
