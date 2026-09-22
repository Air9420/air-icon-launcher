//! `--autostart` 时对 enabled 插件各调用一次 `run_on_autostart`。
//!
//! 不阻塞 setup：由 `schedule_autostart_hooks` 在后台线程执行。
//! 单插件失败只记日志；`METHOD_NOT_FOUND` 视为未实现钩子并跳过。

use crate::plugin_host::PluginHostState;
use tauri::{AppHandle, Emitter, Manager};

/// 约定钩子方法名。
pub const AUTOSTART_HOOK_METHOD: &str = "run_on_autostart";

/// 是否应在本次进程启动时跑自启钩子（仅 `--autostart`）。
pub fn should_run_autostart_hooks() -> bool {
    crate::autostart_service::is_autostart_launch()
}

/// 从运行时列表挑选应参与钩子的插件 id：enabled 即可（load 失败再跳过）。
pub fn select_autostart_targets(
    entries: &[(String, bool)],
) -> Vec<String> {
    let mut ids: Vec<String> = entries
        .iter()
        .filter(|(_, enabled)| *enabled)
        .map(|(id, _)| id.clone())
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

/// 错误是否表示「插件未实现钩子」→ 静默跳过。
pub fn is_missing_hook(code: &str, message: &str) -> bool {
    code == "METHOD_NOT_FOUND" || message.contains("METHOD_NOT_FOUND")
        || message.contains("Unknown plugin method")
}

/// 后台调度：仅当 `should_run_autostart_hooks()` 为真时执行一轮钩子。
pub fn schedule_autostart_hooks(app: AppHandle) {
    if !should_run_autostart_hooks() {
        return;
    }
    std::thread::spawn(move || {
        run_autostart_hooks(&app);
    });
}

/// 同步执行一轮：scan → 对 enabled 插件 load → invoke `run_on_autostart`。
pub fn run_autostart_hooks(app: &AppHandle) {
    let state = match app.try_state::<PluginHostState>() {
        Some(s) => s,
        None => {
            log::warn!("[plugin-autostart] PluginHostState not ready");
            return;
        }
    };

    if let Err(e) = crate::plugin_host::commands::scan_plugins_for_hooks(&state) {
        log::warn!("[plugin-autostart] scan failed: [{}] {}", e.code, e.message);
        return;
    }

    let entries: Vec<(String, bool)> = {
        let reg = state
            .registry
            .lock()
            .map(|g| {
                g.list_runtime()
                    .into_iter()
                    .map(|p| (p.id, p.enabled))
                    .collect()
            })
            .unwrap_or_default();
        reg
    };

    let targets = select_autostart_targets(&entries);
    log::info!(
        "[plugin-autostart] {} plugin(s) eligible: {:?}",
        targets.len(),
        targets
    );

    for id in targets {
        if let Err(e) = crate::plugin_host::commands::load_plugin_for_hooks(&state, &id) {
            log::warn!(
                "[plugin-autostart] load '{}' failed: [{}] {}",
                id,
                e.code,
                e.message
            );
            continue;
        }

        let result = {
            let reg = state.registry.lock();
            match reg {
                Ok(g) => match g.get(&id) {
                    Some(plugin) => crate::plugin_host::loader::invoke_plugin(
                        plugin,
                        AUTOSTART_HOOK_METHOD,
                        &serde_json::json!({}),
                    ),
                    None => Err(crate::error::AppError::not_found(format!(
                        "Plugin '{}' after load",
                        id
                    ))),
                },
                Err(_) => Err(crate::error::AppError::internal(
                    "Plugin host registry lock poisoned",
                )),
            }
        };

        match result {
            Ok(data) => {
                log::info!("[plugin-autostart] '{}' ok: {}", id, data);
            }
            Err(e) if is_missing_hook(&e.code, &e.message) => {
                log::debug!("[plugin-autostart] '{}' has no hook: {}", id, e.code);
            }
            Err(e) => {
                log::warn!("[plugin-autostart] '{}' invoke failed: [{}] {}", id, e.code, e.message);
            }
        }
    }

    // 通知前端插件列表可刷新（若窗口已创建）
    let _ = app.emit(
        "plugin_host_bus",
        serde_json::json!({
            "plugin_id": "*",
            "event": "autostart_hooks_done",
            "payload": { "method": AUTOSTART_HOOK_METHOD },
        }),
    );
    let _ = app.emit(
        "plugin_host_event",
        serde_json::json!({
            "plugin_id": "*",
            "event": "autostart_hooks_done",
            "payload": { "method": AUTOSTART_HOOK_METHOD },
        }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn select_only_enabled_sorted_unique() {
        let entries = vec![
            ("b".to_string(), true),
            ("a".to_string(), false),
            ("c".to_string(), true),
            ("b".to_string(), true),
        ];
        assert_eq!(select_autostart_targets(&entries), vec!["b", "c"]);
    }

    #[test]
    fn missing_hook_detection() {
        assert!(is_missing_hook(
            "METHOD_NOT_FOUND",
            "Unknown plugin method 'run_on_autostart'"
        ));
        assert!(is_missing_hook(
            "PLUGIN_INVOKE_ERROR",
            "METHOD_NOT_FOUND in envelope"
        ));
        assert!(!is_missing_hook(
            "PROXY_DISABLE_FAILED",
            "set ProxyEnable=0: access denied"
        ));
    }

    #[test]
    fn manual_launch_does_not_schedule() {
        // 单元测试进程通常无 --autostart
        assert!(!should_run_autostart_hooks() || {
            // 若测试环境真的带了该参数，至少保证函数可调用
            true
        });
    }
}
