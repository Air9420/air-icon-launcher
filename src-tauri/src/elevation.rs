//! 进程权限（UAC 提权）辅助。
//!
//! ## 为什么需要
//!
//! 三角洲等 ACE 游戏把游戏进程托管为**高完整性级别**（受保护进程）。
//! Windows 的 UIPI（用户界面特权隔离）规定：低完整性进程收不到高完整性进程的输入。
//! 启动器以普通权限运行时，插件侧四条热键通道
//! （`WH_KEYBOARD_LL` / `RegisterHotKey` / Raw Input / `GetAsyncKeyState`）
//! 全部收不到游戏内的按键，表现为「游戏里按热键没反应，切出游戏才正常」。
//!
//! 提权后权限对等，四条通道全部恢复。
//!
//! ## 三种解法
//!
//! | 方式 | 效果 | 代价 |
//! |---|---|---|
//! | 每次手动右键「以管理员身份运行」 | 生效 | 麻烦 |
//! | 即时提权重启（本模块 `relaunch_elevated`） | 立刻生效 | 每次启动要点一次 |
//! | RUNASADMIN 兼容层标记（本模块 `set_run_as_admin_flag`） | 每次启动自动提权 | 每次启动弹 UAC；写入 HKCU 可逆 |
//!
//! 不采用 `requireAdministrator` manifest：那会让 `tauri dev` 和调试
//! 也必须走 UAC，开发体验直接崩掉，且用户无法选择不提权启动。

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

/// 提权相关状态，供前端展示。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ElevationStatus {
    /// 当前进程是否已提权
    pub elevated: bool,
    /// 是否写入了 RUNASADMIN 兼容层标记（即每次启动都自动提权）
    pub run_as_admin_flagged: bool,
    /// 当前可执行文件路径
    pub exe_path: String,
}

#[cfg(windows)]
pub fn is_elevated() -> bool {
    use windows::Win32::UI::Shell::IsUserAnAdmin;
    unsafe { IsUserAnAdmin() }.as_bool()
}

#[cfg(not(windows))]
pub fn is_elevated() -> bool {
    false
}

#[cfg(windows)]
fn current_exe_string() -> AppResult<String> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| AppError::io_error(format!("获取可执行文件路径失败: {}", e)))
}

#[cfg(not(windows))]
fn current_exe_string() -> AppResult<String> {
    Err(AppError::invalid_input("仅支持 Windows"))
}

const LAYERS_KEY: &str = r"Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers";
const RUNAS_FLAG: &str = "~ RUNASADMIN";

#[cfg(windows)]
pub fn is_run_as_admin_flagged() -> bool {
    use winreg::enums::*;
    use winreg::RegKey;

    let Ok(exe) = current_exe_string() else {
        return false;
    };
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(layers) = hkcu.open_subkey_with_flags(LAYERS_KEY, KEY_READ) else {
        return false;
    };
    match layers.get_value::<String, _>(&exe) {
        Ok(value) => value.to_uppercase().contains("RUNASADMIN"),
        Err(_) => false,
    }
}

#[cfg(not(windows))]
pub fn is_run_as_admin_flagged() -> bool {
    false
}

/// 写入/移除当前 exe 的 RUNASADMIN 兼容层标记。
///
/// 只动 HKCU，只动当前 exe 那一条值，随时可撤销。
#[cfg(windows)]
pub fn set_run_as_admin_flag(enabled: bool) -> AppResult<()> {
    use winreg::enums::*;
    use winreg::RegKey;

    let exe = current_exe_string()?;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (layers, _) = hkcu
        .create_subkey(LAYERS_KEY)
        .map_err(|e| AppError::io_error(format!("无法打开兼容性注册表项: {}", e)))?;

    if enabled {
        // 保留已有的其他兼容层标记，只补上 RUNASADMIN
        let existing = layers.get_value::<String, _>(&exe).unwrap_or_default();
        if existing.to_uppercase().contains("RUNASADMIN") {
            return Ok(());
        }
        let merged = if existing.trim().is_empty() {
            RUNAS_FLAG.to_string()
        } else if existing.trim_start().starts_with('~') {
            format!("{} {}", existing.trim(), "RUNASADMIN")
        } else {
            format!("~ {} {}", existing.trim(), "RUNASADMIN")
        };
        layers
            .set_value(&exe, &merged)
            .map_err(|e| AppError::io_error(format!("写入兼容性标记失败: {}", e)))?;
    } else {
        let existing = layers.get_value::<String, _>(&exe).unwrap_or_default();
        if existing.to_uppercase().contains("RUNASADMIN") {
            let cleaned: String = existing
                .split_whitespace()
                .filter(|tok| !tok.eq_ignore_ascii_case("RUNASADMIN"))
                .collect::<Vec<_>>()
                .join(" ");
            if cleaned.trim().is_empty() || cleaned.trim() == "~" {
                let _ = layers.delete_value(&exe);
            } else {
                let _ = layers.set_value(&exe, &cleaned);
            }
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn set_run_as_admin_flag(_enabled: bool) -> AppResult<()> {
    Err(AppError::invalid_input("仅支持 Windows"))
}

/// 以管理员身份重启当前程序。
///
/// 成功后当前进程立即退出（`ShellExecuteW` 带 `runas` 是同步的，
/// 用户点完 UAC 才会返回），新进程带 `--replace` 参数，
/// 在 `main.rs` 里会等旧实例释放单实例互斥量再继续。
#[cfg(windows)]
pub fn relaunch_elevated() -> AppResult<()> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    if is_elevated() {
        return Ok(());
    }

    fn to_wide(s: &OsStr) -> Vec<u16> {
        s.encode_wide().chain(Some(0)).collect()
    }

    let exe = std::env::current_exe()
        .map_err(|e| AppError::io_error(format!("获取可执行文件路径失败: {}", e)))?;

    // 透传原参数，只补一个 --replace（已有则不重复），
    // 避免丢掉 `--autostart` 这类启动模式。
    let mut passthrough: Vec<String> = std::env::args().skip(1).collect();
    if !passthrough.iter().any(|a| a == "--replace") {
        passthrough.push("--replace".to_string());
    }
    let args_joined = passthrough
        .iter()
        .map(|a| {
            if a.contains(' ') {
                format!("\"{}\"", a)
            } else {
                a.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    let verb = to_wide(OsStr::new("runas"));
    let exe_w = to_wide(exe.as_os_str());
    let args = to_wide(OsStr::new(&args_joined));

    let result = unsafe {
        ShellExecuteW(
            None,
            windows::core::PCWSTR(verb.as_ptr()),
            windows::core::PCWSTR(exe_w.as_ptr()),
            windows::core::PCWSTR(args.as_ptr()),
            windows::core::PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };

    let code = result.0 as isize;
    if code <= 32 {
        // 5 = 用户取消了 UAC，其他值是真正的失败
        let reason = if code == 5 {
            "用户取消了管理员授权".to_string()
        } else {
            format!("请求管理员权限失败 (ShellExecuteW 返回 {})", code)
        };
        return Err(AppError::permission_denied(reason));
    }

    // 新进程已创建，旧实例退出，避免两个实例同时抢 HID 设备
    std::process::exit(0);
}

#[cfg(not(windows))]
pub fn relaunch_elevated() -> AppResult<()> {
    Err(AppError::invalid_input("仅支持 Windows"))
}

// ---------------------------------------------------------------- Tauri 命令

#[tauri::command]
pub fn get_elevation_status() -> AppResult<ElevationStatus> {
    Ok(ElevationStatus {
        elevated: is_elevated(),
        run_as_admin_flagged: is_run_as_admin_flagged(),
        exe_path: current_exe_string().unwrap_or_default(),
    })
}

#[tauri::command]
pub fn relaunch_as_admin() -> AppResult<()> {
    relaunch_elevated()
}

#[tauri::command]
pub fn set_run_as_admin(enabled: bool) -> AppResult<()> {
    set_run_as_admin_flag(enabled)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn elevation_status_is_serializable() {
        let s = ElevationStatus {
            elevated: false,
            run_as_admin_flagged: true,
            exe_path: "C:\\app.exe".into(),
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("run_as_admin_flagged"));
        assert!(json.contains("app.exe"));
    }

    #[cfg(windows)]
    #[test]
    fn is_elevated_returns_bool() {
        // 只验证不 panic，结果取决于跑测试的终端权限
        let _ = is_elevated();
    }

    #[cfg(windows)]
    #[test]
    fn flag_merge_keeps_existing_tokens() {
        // 逻辑内联在 set_run_as_admin_flag 里，这里验证等价的分词行为
        let existing = "~ HIGHDPIAWARE";
        let merged = format!("{} {}", existing.trim(), "RUNASADMIN");
        assert!(merged.contains("HIGHDPIAWARE"));
        assert!(merged.contains("RUNASADMIN"));
        let cleaned: String = merged
            .split_whitespace()
            .filter(|t| !t.eq_ignore_ascii_case("RUNASADMIN"))
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(cleaned, "~ HIGHDPIAWARE");
    }
}
