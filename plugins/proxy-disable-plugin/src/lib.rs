//! Air Icon Launcher — 关闭系统代理插件（cdylib ABI v1）。
//!
//! 在 `run_on_autostart` / `disable` 中将
//! `HKCU\...\Internet Settings\ProxyEnable` 置 0，并刷新 WinINet。
//! 不修改 ProxyServer / PAC，不结束代理软件进程。

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

struct PluginState {
    user_data: usize,
    log_fn: Option<extern "C" fn(*mut c_void, i32, *const c_char)>,
    host_invoke_fn:
        Option<extern "C" fn(*mut c_void, *const c_char, *const c_char) -> *mut c_char>,
}

static STATE: Mutex<PluginState> = Mutex::new(PluginState {
    user_data: 0,
    log_fn: None,
    host_invoke_fn: None,
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

const INTERNET_SETTINGS_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";
const PROXY_ENABLE_VALUE: &str = "ProxyEnable";

/// 读取当前 `ProxyEnable`（缺省视为 0）。
pub fn read_proxy_enable() -> Result<u32, String> {
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let key = hkcu
            .open_subkey_with_flags(INTERNET_SETTINGS_KEY, KEY_READ)
            .map_err(|e| format!("open Internet Settings: {}", e))?;
        match key.get_value::<u32, _>(PROXY_ENABLE_VALUE) {
            Ok(v) => Ok(v),
            Err(_) => Ok(0),
        }
    }
    #[cfg(not(windows))]
    {
        Err("system proxy is Windows-only".to_string())
    }
}

/// 将 `ProxyEnable` 写为 0 并刷新 WinINet。返回写入前的值。
pub fn disable_system_proxy() -> Result<u32, String> {
    let previous = read_proxy_enable()?;

    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let key = hkcu
            .create_subkey(INTERNET_SETTINGS_KEY)
            .map_err(|e| format!("open Internet Settings for write: {}", e))?
            .0;
        key.set_value(PROXY_ENABLE_VALUE, &0u32)
            .map_err(|e| format!("set ProxyEnable=0: {}", e))?;
        refresh_wininet();
        let now = read_proxy_enable()?;
        if now != 0 {
            return Err(format!("ProxyEnable still {}", now));
        }
        Ok(previous)
    }

    #[cfg(not(windows))]
    {
        Err("system proxy is Windows-only".to_string())
    }
}

#[cfg(windows)]
fn refresh_wininet() {
    use windows_sys::Win32::Networking::WinInet::{
        InternetSetOptionW, INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED,
    };

    unsafe {
        InternetSetOptionW(
            std::ptr::null(),
            INTERNET_OPTION_SETTINGS_CHANGED,
            std::ptr::null(),
            0,
        );
        InternetSetOptionW(
            std::ptr::null(),
            INTERNET_OPTION_REFRESH,
            std::ptr::null(),
            0,
        );
    }
}

fn handle_disable() -> *mut c_char {
    match disable_system_proxy() {
        Ok(previous) => {
            let _ = host_invoke(
                "log",
                &serde_json::json!({
                    "level": 2,
                    "message": format!(
                        "system proxy disabled (ProxyEnable 0 -> was {})",
                        previous
                    )
                }),
            );
            host_log(2, "system proxy disabled");
            ok_envelope(serde_json::json!({
                "disabled": true,
                "previous_proxy_enable": previous,
            }))
            .into_raw()
        }
        Err(e) => {
            host_log(3, &format!("disable system proxy failed: {}", e));
            err_envelope("PROXY_DISABLE_FAILED", &e).into_raw()
        }
    }
}

#[no_mangle]
pub extern "C" fn air_plugin_abi_version() -> u32 {
    ABI_VERSION
}

#[no_mangle]
pub extern "C" fn air_plugin_manifest() -> *mut c_char {
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
    }
    host_log(2, "air_proxy_disable initialized");
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
    let _ = args_json;

    match method.as_str() {
        "run_on_autostart" | "disable" => handle_disable(),
        "status" => match read_proxy_enable() {
            Ok(v) => ok_envelope(serde_json::json!({ "proxy_enable": v })).into_raw(),
            Err(e) => err_envelope("PROXY_READ_FAILED", &e).into_raw(),
        },
        other => err_envelope(
            "METHOD_NOT_FOUND",
            &format!("Unknown plugin method '{}'", other),
        )
        .into_raw(),
    }
}

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
    host_log(2, "air_proxy_disable shutdown");
    if let Ok(mut st) = STATE.lock() {
        st.user_data = 0;
        st.log_fn = None;
        st.host_invoke_fn = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn disable_system_proxy_roundtrip() {
        let previous = read_proxy_enable().expect("read ProxyEnable");
        let prev2 = disable_system_proxy().expect("disable system proxy");
        assert_eq!(prev2, previous);
        assert_eq!(read_proxy_enable().unwrap(), 0);
        // restore
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let key = hkcu.create_subkey(INTERNET_SETTINGS_KEY).unwrap().0;
        key.set_value(PROXY_ENABLE_VALUE, &previous).unwrap();
        refresh_wininet();
        assert_eq!(read_proxy_enable().unwrap(), previous);
    }

    #[test]
    fn unknown_method_returns_method_not_found() {
        let m = CString::new("nope").unwrap();
        let ptr = air_plugin_invoke(m.as_ptr(), std::ptr::null());
        assert!(!ptr.is_null());
        let s = unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned();
        air_plugin_free_string(ptr);
        assert!(s.contains("METHOD_NOT_FOUND"));
    }
}
