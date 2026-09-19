//! cdylib ABI v1：跨 DLL 的 C ABI 类型与符号名。

use std::ffi::{c_char, c_void};

/// 当前宿主接受的插件 ABI 版本。
pub const AIR_PLUGIN_ABI_VERSION: u32 = 1;

// --- 插件导出符号名 ---
pub const SYM_ABI_VERSION: &[u8] = b"air_plugin_abi_version\0";
pub const SYM_MANIFEST: &[u8] = b"air_plugin_manifest\0";
pub const SYM_INIT: &[u8] = b"air_plugin_init\0";
pub const SYM_INVOKE: &[u8] = b"air_plugin_invoke\0";
pub const SYM_ON_EVENT: &[u8] = b"air_plugin_on_event\0";
pub const SYM_FREE_STRING: &[u8] = b"air_plugin_free_string\0";
pub const SYM_SHUTDOWN: &[u8] = b"air_plugin_shutdown\0";

/// 日志级别（与 HostVTable.log 的 level 参数一致）。
pub const LOG_TRACE: i32 = 0;
pub const LOG_DEBUG: i32 = 1;
pub const LOG_INFO: i32 = 2;
pub const LOG_WARN: i32 = 3;
pub const LOG_ERROR: i32 = 4;

/// 宿主提供给插件的 C 函数表。
///
/// 插件应在 `air_plugin_init` 中拷贝所需字段；`user_data` 在插件卸载前一直有效。
#[repr(C)]
pub struct AirHostVTable {
    pub abi_version: u32,
    pub user_data: *mut c_void,
    pub log: extern "C" fn(*mut c_void, level: i32, msg: *const c_char),
    pub host_invoke: extern "C" fn(
        *mut c_void,
        method: *const c_char,
        args: *const c_char,
    ) -> *mut c_char,
}

// --- 函数指针类型（libloading::Symbol 转换用） ---

pub type AbiVersionFn = unsafe extern "C" fn() -> u32;
pub type ManifestFn = unsafe extern "C" fn() -> *mut c_char;
pub type InitFn = unsafe extern "C" fn(*const AirHostVTable, *mut c_void) -> i32;
pub type InvokeFn = unsafe extern "C" fn(*const c_char, *const c_char) -> *mut c_char;
pub type OnEventFn = unsafe extern "C" fn(*const c_char);
pub type FreeStringFn = unsafe extern "C" fn(*mut c_char);
pub type ShutdownFn = unsafe extern "C" fn();

/// 已解析的插件函数表（不含 Library 生命周期，需与 Library 一并持有）。
#[derive(Clone, Copy)]
pub struct PluginFns {
    pub invoke: InvokeFn,
    pub free_string: FreeStringFn,
    pub shutdown: ShutdownFn,
    /// 可选符号 `air_plugin_on_event`。
    pub on_event: Option<OnEventFn>,
}

/// 插件 `air_plugin_invoke` 返回的 JSON 信封。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InvokeEnvelope {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<serde_json::Value>,
}

pub fn level_name(level: i32) -> &'static str {
    match level {
        LOG_TRACE => "TRACE",
        LOG_DEBUG => "DEBUG",
        LOG_INFO => "INFO",
        LOG_WARN => "WARN",
        LOG_ERROR => "ERROR",
        _ => "LOG",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn abi_version_is_one() {
        assert_eq!(AIR_PLUGIN_ABI_VERSION, 1);
    }

    #[test]
    fn level_names() {
        assert_eq!(level_name(LOG_INFO), "INFO");
        assert_eq!(level_name(99), "LOG");
    }

    #[test]
    fn invoke_envelope_roundtrip() {
        let env = InvokeEnvelope {
            ok: true,
            data: Some(serde_json::json!({"greeting": "hi"})),
            error: None,
        };
        let s = serde_json::to_string(&env).unwrap();
        let back: InvokeEnvelope = serde_json::from_str(&s).unwrap();
        assert!(back.ok);
        assert_eq!(back.data.unwrap()["greeting"], "hi");
    }
}
