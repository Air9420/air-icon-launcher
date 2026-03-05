use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AutostartServiceStatus {
    pub installed: bool,
}

const SERVICE_NAME: &str = "AirIconLauncher";

/// 判断当前进程是否以 `--autostart` 参数启动。
pub fn is_autostart_launch() -> bool {
    std::env::args().any(|a| a == "--autostart")
}

/// 获取开机自启服务的安装状态。
#[tauri::command]
pub fn get_autostart_service_status() -> Result<AutostartServiceStatus, String> {
    #[cfg(windows)]
    {
        Ok(AutostartServiceStatus {
            installed: is_service_installed_windows()?,
        })
    }

    #[cfg(not(windows))]
    {
        Err("开机自启服务仅支持 Windows".to_string())
    }
}

/// 启用/关闭开机自启服务（Windows 服务方式）。
#[tauri::command]
pub fn set_autostart_service_enabled(enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let args = if enabled {
            "--install-service"
        } else {
            "--uninstall-service"
        };

        if is_running_as_admin_windows()? {
            run_child_and_wait_windows(args)?;
        } else {
            run_elevated_and_wait_windows(args)?;
        }

        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("开机自启服务仅支持 Windows".to_string())
    }
}

#[cfg(windows)]
fn is_service_installed_windows() -> Result<bool, String> {
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
            .map_err(|e| e.message().to_string())?;

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
                return Err(Error::from(e).message().to_string());
            }
        }
    };

    let _ = unsafe { CloseServiceHandle(scm) };
    Ok(installed)
}

#[cfg(windows)]
fn run_child_and_wait_windows(arg: &str) -> Result<(), String> {
    use std::process::Command;

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let status = Command::new(exe)
        .arg(arg)
        .status()
        .map_err(|e| e.to_string())?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("操作失败（退出码：{status}）"))
    }
}

#[cfg(windows)]
fn is_running_as_admin_windows() -> Result<bool, String> {
    use windows::Win32::UI::Shell::IsUserAnAdmin;

    Ok(unsafe { IsUserAnAdmin() }.as_bool())
}

#[cfg(windows)]
fn run_elevated_and_wait_windows(arg: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SHOW_WINDOW_CMD;

    fn to_wide(s: &OsStr) -> Vec<u16> {
        s.encode_wide().chain(Some(0)).collect()
    }

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
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
            return Err("无法请求管理员权限（可能已取消授权）".to_string());
        }
    }

    wait_for_service_state_windows(arg == "--install-service")
}

#[cfg(windows)]
fn wait_for_service_state_windows(installed: bool) -> Result<(), String> {
    let timeout = std::time::Duration::from_secs(20);
    let start = std::time::Instant::now();
    loop {
        let current = is_service_installed_windows()?;
        if current == installed {
            return Ok(());
        }
        if start.elapsed() >= timeout {
            return Err("等待服务状态更新超时".to_string());
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
}
