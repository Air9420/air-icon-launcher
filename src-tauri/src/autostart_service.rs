use serde::{Serialize, Deserialize};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AutostartType {
    Service,
    Registry,
    TaskScheduler,
}

impl Default for AutostartType {
    fn default() -> Self {
        AutostartType::Registry
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AutostartStatus {
    pub enabled: bool,
    pub method: Option<AutostartType>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AutostartServiceStatus {
    pub installed: bool,
}

const SERVICE_NAME: &str = "AirIconLauncher";
const TASK_NAME: &str = "AirIconLauncherAutoStart";
const REGISTRY_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const REGISTRY_VALUE_NAME: &str = "AirIconLauncher";

/// 判断当前进程是否以 `--autostart` 参数启动。
pub fn is_autostart_launch() -> bool {
    std::env::args().any(|arg| arg == "--autostart")
}

#[tauri::command]
pub fn check_is_autostart_launch() -> bool {
    is_autostart_launch()
}

/// 获取开机自启的当前状态。
#[tauri::command]
pub fn get_autostart_status() -> AppResult<AutostartStatus> {
    #[cfg(windows)]
    {
        let service_installed = is_service_installed_windows()?;
        let registry_enabled = is_registry_autostart_enabled()?;
        let task_enabled = is_task_scheduler_enabled()?;

        let (enabled, method) = if registry_enabled {
            (true, Some(AutostartType::Registry))
        } else if task_enabled {
            (true, Some(AutostartType::TaskScheduler))
        } else if service_installed {
            (true, Some(AutostartType::Service))
        } else {
            (false, None)
        };

        Ok(AutostartStatus { enabled, method })
    }

    #[cfg(not(windows))]
    {
        Err(AppError::invalid_input("Autostart is only supported on Windows"))
    }
}

/// 获取开机自启服务的安装状态（向后兼容）。
#[tauri::command]
pub fn get_autostart_service_status() -> AppResult<AutostartServiceStatus> {
    #[cfg(windows)]
    {
        Ok(AutostartServiceStatus {
            installed: is_service_installed_windows()?,
        })
    }

    #[cfg(not(windows))]
    {
        Err(AppError::invalid_input("Autostart service is only supported on Windows"))
    }
}

/// 设置开机自启。
#[tauri::command]
pub fn set_autostart(method: AutostartType, enabled: bool) -> AppResult<()> {
    #[cfg(windows)]
    {
        if enabled {
            let _ = set_registry_autostart(false);
            let _ = set_task_scheduler_autostart(false);
            let _ = set_service_autostart_internal(false);

            match method {
                AutostartType::Service => set_service_autostart_internal(true)?,
                AutostartType::Registry => set_registry_autostart(true)?,
                AutostartType::TaskScheduler => set_task_scheduler_autostart(true)?,
            }
        } else {
            match method {
                AutostartType::Service => set_service_autostart_internal(false)?,
                AutostartType::Registry => set_registry_autostart(false)?,
                AutostartType::TaskScheduler => set_task_scheduler_autostart(false)?,
            }
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = (method, enabled);
        Err(AppError::invalid_input("Autostart is only supported on Windows"))
    }
}

/// 启用/关闭开机自启服务（向后兼容）。
#[tauri::command]
pub fn set_autostart_service_enabled(enabled: bool) -> AppResult<()> {
    set_autostart(AutostartType::Service, enabled)
}

// ==================== Service ====================

#[cfg(windows)]
fn set_service_autostart_internal(enabled: bool) -> AppResult<()> {
    if enabled {
        if is_running_as_admin_windows()? {
            install_service()?;
        } else {
            run_elevated_and_wait_windows("--install-service")?;
        }
    } else {
        if is_running_as_admin_windows()? {
            uninstall_service()?;
        } else {
            run_elevated_and_wait_windows("--uninstall-service")?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn is_service_installed_windows() -> AppResult<bool> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{Error, HRESULT, PCWSTR};
    use windows::Win32::Foundation::ERROR_SERVICE_DOES_NOT_EXIST;
    use windows::Win32::System::Services::{
        CloseServiceHandle, OpenSCManagerW, OpenServiceW, SC_MANAGER_CONNECT, SERVICE_QUERY_STATUS,
    };

    fn to_wide(s: &OsStr) -> Vec<u16> {
        s.encode_wide().chain(Some(0)).collect()
    }

    let scm =
        unsafe { OpenSCManagerW(PCWSTR::null(), PCWSTR::null(), SC_MANAGER_CONNECT) }
            .map_err(|e| AppError::internal(e.message().to_string()))?;

    let name = to_wide(OsStr::new(SERVICE_NAME));
    let service = unsafe { OpenServiceW(scm, PCWSTR(name.as_ptr()), SERVICE_QUERY_STATUS) };

    let installed = match service {
        Ok(h) => {
            let _ = unsafe { CloseServiceHandle(h) };
            true
        }
        Err(e) => {
            if e.code() == HRESULT::from_win32(ERROR_SERVICE_DOES_NOT_EXIST.0) {
                false
            } else {
                return Err(AppError::internal(Error::from(e).message().to_string()));
            }
        }
    };

    let _ = unsafe { CloseServiceHandle(scm) };
    Ok(installed)
}

// ==================== Registry ====================

#[cfg(windows)]
fn get_canonical_exe_path() -> AppResult<std::path::PathBuf> {
    std::env::current_exe()
        .map_err(|e| AppError::io_error(format!("Failed to get exe path: {}", e)))?
        .canonicalize()
        .map_err(|e| AppError::io_error(format!("Failed to canonicalize exe path: {}", e)))
}

#[cfg(windows)]
fn set_registry_autostart(enabled: bool) -> AppResult<()> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_key = hkcu
        .open_subkey_with_flags(REGISTRY_KEY, KEY_WRITE | KEY_READ)
        .map_err(|e| AppError::io_error(format!("Failed to open registry key: {}", e)))?;

    if enabled {
        let exe = get_canonical_exe_path()?;
        let exe_str = exe.to_string_lossy().to_string();
        run_key
            .set_value(REGISTRY_VALUE_NAME, &format!("\"{}\" --autostart", exe_str))
            .map_err(|e| AppError::io_error(format!("Failed to set registry value: {}", e)))?;
    } else {
        let _ = run_key.delete_value(REGISTRY_VALUE_NAME);
    }

    Ok(())
}

#[cfg(windows)]
fn is_registry_autostart_enabled() -> AppResult<bool> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_key = match hkcu.open_subkey_with_flags(REGISTRY_KEY, KEY_READ) {
        Ok(key) => key,
        Err(_) => return Ok(false),
    };

    match run_key.get_value::<String, _>(REGISTRY_VALUE_NAME) {
        Ok(value) => {
            let expected_exe = match get_canonical_exe_path() {
                Ok(path) => path.to_string_lossy().to_string(),
                Err(_) => return Ok(false),
            };
            let value_normalized = value.trim();
            let expected_with_flag = format!("\"{}\" --autostart", expected_exe);
            Ok(value_normalized == expected_with_flag || value_normalized.ends_with("\" --autostart"))
        }
        Err(_) => Ok(false),
    }
}

// ==================== Task Scheduler ====================

#[cfg(windows)]
fn set_task_scheduler_autostart(enabled: bool) -> AppResult<()> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    let exe = get_canonical_exe_path()?;
    let exe_str = exe.to_string_lossy();

    if enabled {
        let create_result = Command::new("schtasks")
            .creation_flags(0x08000000)
            .args([
                "/Create",
                "/TN", TASK_NAME,
                "/TR", &format!("\"{}\" --autostart", exe_str),
                "/SC", "ONLOGON",
                "/RL", "HIGHEST",
                "/F",
            ])
            .output()
            .map_err(|e| AppError::io_error(format!("Failed to create task: {}", e)))?;

        if !create_result.status.success() {
            let stderr = String::from_utf8_lossy(&create_result.stderr);
            return Err(AppError::internal(format!("Failed to create task: {}", stderr)));
        }
    } else {
        let delete_result = Command::new("schtasks")
            .creation_flags(0x08000000)
            .args(["/Delete", "/TN", TASK_NAME, "/F"])
            .output()
            .map_err(|e| AppError::io_error(format!("Failed to delete task: {}", e)))?;

        let _ = delete_result;
    }

    Ok(())
}

#[cfg(windows)]
fn is_task_scheduler_enabled() -> AppResult<bool> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    let query_result = Command::new("schtasks")
        .creation_flags(0x08000000)
        .args(["/Query", "/TN", TASK_NAME])
        .output()
        .map_err(|e| AppError::io_error(format!("Failed to query task: {}", e)))?;

    Ok(query_result.status.success())
}

// ==================== Helpers ====================

#[cfg(windows)]
fn is_running_as_admin_windows() -> AppResult<bool> {
    use windows::Win32::UI::Shell::IsUserAnAdmin;

    Ok(unsafe { IsUserAnAdmin() }.as_bool())
}

#[cfg(windows)]
#[allow(dead_code)]
fn run_child_and_wait_windows(arg: &str) -> AppResult<()> {
    use std::process::Command;

    let exe = std::env::current_exe().map_err(|e| AppError::io_error(e.to_string()))?;
    let status = Command::new(exe)
        .arg(arg)
        .status()
        .map_err(|e| AppError::io_error(e.to_string()))?;

    if status.success() {
        Ok(())
    } else {
        Err(AppError::internal(format!("Operation failed (exit code: {})", status)))
    }
}

#[cfg(windows)]
fn run_elevated_and_wait_windows(arg: &str) -> AppResult<()> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SHOW_WINDOW_CMD;

    fn to_wide(s: &OsStr) -> Vec<u16> {
        s.encode_wide().chain(Some(0)).collect()
    }

    let exe = std::env::current_exe().map_err(|e| AppError::io_error(e.to_string()))?;
    let exe_w = to_wide(exe.as_os_str());
    let arg_w = to_wide(OsStr::new(arg));
    let verb_w = to_wide(OsStr::new("runas"));

    unsafe {
        let result = ShellExecuteW(
            None,
            windows::core::PCWSTR(verb_w.as_ptr()),
            windows::core::PCWSTR(exe_w.as_ptr()),
            windows::core::PCWSTR(arg_w.as_ptr()),
            windows::core::PCWSTR::null(),
            SHOW_WINDOW_CMD(0),
        );

        if (result.0 as isize) <= 32 {
            return Err(AppError::permission_denied("Failed to request admin privileges (may have been cancelled)"));
        }
    }

    wait_for_service_state_windows(arg == "--install-service")
}

#[cfg(windows)]
fn wait_for_service_state_windows(installed: bool) -> AppResult<()> {
    let timeout = std::time::Duration::from_secs(20);
    let start = std::time::Instant::now();
    loop {
        let current = is_service_installed_windows()?;
        if current == installed {
            return Ok(());
        }
        if start.elapsed() >= timeout {
            return Err(AppError::internal("Timeout waiting for service state update"));
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
}

#[cfg(windows)]
fn install_service() -> AppResult<()> {
    use std::process::Command;
    use std::os::windows::process::CommandExt;

    let exe = std::env::current_exe().map_err(|e| AppError::io_error(e.to_string()))?;
    let bin_path = format!("\"{}\" --service", exe.display());

    let create = Command::new("sc")
        .creation_flags(0x08000000)
        .args([
            "create",
            SERVICE_NAME,
            "binPath=",
            &bin_path,
            "start=",
            "auto",
            "DisplayName=",
            SERVICE_DISPLAY_NAME,
        ])
        .output()
        .map_err(|e| AppError::io_error(e.to_string()))?;

    let created_or_configured = if create.status.success() {
        true
    } else {
        let config = Command::new("sc")
            .creation_flags(0x08000000)
            .args([
                "config",
                SERVICE_NAME,
                "binPath=",
                &bin_path,
                "start=",
                "auto",
                "DisplayName=",
                SERVICE_DISPLAY_NAME,
            ])
            .output()
            .map_err(|e| AppError::io_error(e.to_string()))?;
        config.status.success()
    };

    if !created_or_configured {
        let err = format!(
            "{}\n{}",
            String::from_utf8_lossy(&create.stdout),
            String::from_utf8_lossy(&create.stderr)
        );
        return Err(AppError::internal(err.trim().to_string()));
    }

    let _ = Command::new("sc")
        .creation_flags(0x08000000)
        .args(["description", SERVICE_NAME, SERVICE_DESCRIPTION])
        .output()
        .map_err(|e| AppError::io_error(e.to_string()))
        .ok()
        .filter(|o| !o.status.success())
        .map(|o| {
            eprintln!(
                "Warning: Failed to set service description: {}",
                String::from_utf8_lossy(&o.stderr)
            )
        });

    let config_result = Command::new("sc")
        .creation_flags(0x08000000)
        .args(["config", SERVICE_NAME, "start=", "auto"])
        .output();
    if let Err(e) = config_result {
        eprintln!("Warning: Failed to configure service start type: {}", e);
    } else if let Ok(output) = config_result {
        if !output.status.success() {
            eprintln!(
                "Warning: Failed to configure service start type: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }

    Ok(())
}

#[cfg(windows)]
fn uninstall_service() -> AppResult<()> {
    use std::process::Command;
    use std::os::windows::process::CommandExt;

    let _ = Command::new("sc")
        .creation_flags(0x08000000)
        .args(["stop", SERVICE_NAME])
        .output();
    let delete = Command::new("sc")
        .creation_flags(0x08000000)
        .args(["delete", SERVICE_NAME])
        .output()
        .map_err(|e| AppError::io_error(e.to_string()))?;

    if !delete.status.success() {
        let err = String::from_utf8_lossy(&delete.stderr);
        if !err.contains("service does not exist") {
            return Err(AppError::internal(err.trim().to_string()));
        }
    }

    Ok(())
}

#[cfg(windows)]
#[allow(dead_code)]
pub fn get_service_name() -> &'static str {
    SERVICE_NAME
}

#[cfg(windows)]
#[allow(dead_code)]
pub fn get_task_name() -> &'static str {
    TASK_NAME
}

#[cfg(not(windows))]
#[allow(dead_code)]
pub fn get_service_name() -> &'static str {
    ""
}

#[cfg(not(windows))]
#[allow(dead_code)]
pub fn get_task_name() -> &'static str {
    ""
}

#[cfg(windows)]
#[allow(dead_code)]
const SERVICE_DISPLAY_NAME: &str = "Air Icon Launcher";
#[cfg(windows)]
#[allow(dead_code)]
const SERVICE_DESCRIPTION: &str = "Air Icon Launcher Background Service";

#[tauri::command]
pub fn simulate_autostart_launch(app: tauri::AppHandle) -> AppResult<()> {
    let exe = std::env::current_exe().map_err(|e| AppError::io_error(e.to_string()))?;
    std::process::Command::new(exe)
        .arg("--autostart")
        .spawn()
        .map_err(|e| AppError::io_error(e.to_string()))?;
    app.exit(0);
    Ok(())
}
