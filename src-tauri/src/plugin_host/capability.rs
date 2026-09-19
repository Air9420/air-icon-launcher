//! Capability 解析与强制：插件未声明的能力无法通过 host_invoke 调用。

use crate::error::{AppError, AppResult};
use std::collections::HashSet;

/// 能力标识常量。
#[allow(dead_code)]
pub const CAP_LOG: &str = "log";
#[allow(dead_code)]
pub const CAP_LAUNCHER_READ: &str = "launcher.read";
#[allow(dead_code)]
pub const CAP_LAUNCHER_LAUNCH: &str = "launcher.launch";
#[allow(dead_code)]
pub const CAP_EVENTS_EMIT: &str = "events.emit";
#[allow(dead_code)]
pub const CAP_FS: &str = "fs";
#[allow(dead_code)]
pub const CAP_NET: &str = "net";

pub const ERROR_CAPABILITY_DENIED: &str = "capability_denied";

/// 将 manifest 中的 capabilities 规范化为集合。
pub fn parse_capabilities(list: &[String]) -> HashSet<String> {
    list.iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// host_invoke 方法所需能力。`None` 表示始终允许（如 log）。
pub fn required_capability(method: &str) -> Option<&'static str> {
    let method = method.trim();
    match method {
        // 日志始终允许，便于插件在任何状态下输出诊断信息。
        "log" | "log.write" | "log.trace" | "log.debug" | "log.info" | "log.warn" | "log.error" => {
            None
        }
        m if m == CAP_LAUNCHER_READ || m.starts_with("launcher.read") => Some(CAP_LAUNCHER_READ),
        m if m == CAP_LAUNCHER_LAUNCH || m.starts_with("launcher.launch") => {
            Some(CAP_LAUNCHER_LAUNCH)
        }
        m if m == CAP_EVENTS_EMIT || m.starts_with("events.") => Some(CAP_EVENTS_EMIT),
        m if m.starts_with("fs.") || m == CAP_FS => Some(CAP_FS),
        m if m.starts_with("net.") || m == CAP_NET => Some(CAP_NET),
        // 未知 method：要求插件显式声明同名 capability。
        m if !m.is_empty() => {
            // 泄漏静态生命周期：仅用于错误信息时可直接用 method 本身。
            // 这里返回 None 不合适；用特殊约定：返回 Some 无法带自定义字符串。
            // 改由 enforce_unknown 处理。
            let _ = m;
            Some("__unknown__")
        }
        _ => Some("__unknown__"),
    }
}

/// 强制 capability 检查。
///
/// - 未声明能力 → `capability_denied`
/// - 未知 method 且未声明同名 capability → `capability_denied`
/// - 已知 method 但宿主未实现 → 由调用方返回 `not_implemented`
pub fn enforce(capabilities: &HashSet<String>, method: &str) -> AppResult<RequiredAction> {
    let method = method.trim();
    if method.is_empty() {
        return Err(AppError::invalid_input("host method must not be empty"));
    }

    match required_capability(method) {
        None => Ok(RequiredAction::Allow),
        Some("__unknown__") => {
            if capabilities.contains(method) {
                Ok(RequiredAction::Allow)
            } else {
                Err(denied(method, method))
            }
        }
        Some(required) => {
            if capabilities.contains(required) {
                Ok(RequiredAction::Allow)
            } else {
                Err(denied(method, required))
            }
        }
    }
}

#[derive(Debug)]
pub enum RequiredAction {
    Allow,
}

fn denied(method: &str, required: &str) -> AppError {
    AppError::new(
        ERROR_CAPABILITY_DENIED,
        format!(
            "Plugin is not permitted to call host method '{}'; required capability '{}'",
            method, required
        ),
    )
    .with_details(serde_json::json!({
        "method": method,
        "required_capability": required,
        "error": ERROR_CAPABILITY_DENIED,
    }))
}

/// 宿主实际实现的 method 前缀（用于 not_implemented 与文档）。
#[allow(dead_code)]
pub fn is_known_host_method(method: &str) -> bool {
    matches!(
        required_capability(method),
        None | Some(CAP_LAUNCHER_READ) | Some(CAP_LAUNCHER_LAUNCH) | Some(CAP_EVENTS_EMIT)
    ) && required_capability(method) != Some("__unknown__")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn caps(list: &[&str]) -> HashSet<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn log_always_allowed() {
        let c = caps(&[]);
        assert!(enforce(&c, "log").is_ok());
        assert!(enforce(&c, "log.info").is_ok());
    }

    #[test]
    fn launcher_read_requires_capability() {
        let denied = caps(&["log"]);
        let err = enforce(&denied, "launcher.read").unwrap_err();
        assert_eq!(err.code, ERROR_CAPABILITY_DENIED);

        let allowed = caps(&["log", "launcher.read"]);
        assert!(enforce(&allowed, "launcher.read").is_ok());
    }

    #[test]
    fn launcher_launch_requires_capability() {
        let denied = caps(&["launcher.read"]);
        let err = enforce(&denied, "launcher.launch").unwrap_err();
        assert_eq!(err.code, ERROR_CAPABILITY_DENIED);
        assert!(err.details.is_some());

        let allowed = caps(&["launcher.launch"]);
        assert!(enforce(&allowed, "launcher.launch").is_ok());
    }

    #[test]
    fn events_emit_requires_capability() {
        let denied = caps(&["log"]);
        assert!(enforce(&denied, "events.emit").is_err());
        let allowed = caps(&["events.emit"]);
        assert!(enforce(&allowed, "events.emit").is_ok());
    }

    #[test]
    fn fs_net_denied_without_capability() {
        let c = caps(&["log"]);
        assert_eq!(
            enforce(&c, "fs.read_text").unwrap_err().code,
            ERROR_CAPABILITY_DENIED
        );
        assert_eq!(
            enforce(&c, "net.fetch").unwrap_err().code,
            ERROR_CAPABILITY_DENIED
        );
        let c2 = caps(&["fs", "net"]);
        assert!(enforce(&c2, "fs.read_text").is_ok());
        assert!(enforce(&c2, "net.fetch").is_ok());
    }

    #[test]
    fn unknown_method_needs_explicit_capability() {
        let denied = caps(&["log"]);
        let err = enforce(&denied, "custom.thing").unwrap_err();
        assert_eq!(err.code, ERROR_CAPABILITY_DENIED);

        let allowed = caps(&["custom.thing"]);
        assert!(enforce(&allowed, "custom.thing").is_ok());
    }

    #[test]
    fn known_method_detection() {
        assert!(is_known_host_method("log"));
        assert!(is_known_host_method("launcher.launch"));
        assert!(!is_known_host_method("totally.unknown"));
    }
}
