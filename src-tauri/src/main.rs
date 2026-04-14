// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
mod windows_service_entry;

const SERVICE_NAME: &str = "AirIconLauncher";
const SERVICE_DISPLAY_NAME: &str = "Air Icon Launcher AutoStart";
const SERVICE_DESCRIPTION: &str = "Auto start Air Icon Launcher in background at boot.";
#[cfg(all(windows, not(debug_assertions)))]
const SINGLE_INSTANCE_MUTEX_NAME: &str = "Global\\AirIconLauncherSingleInstance";
#[cfg(all(windows, not(debug_assertions)))]
const MAIN_WINDOW_TITLE: &str = "air-icon-launcher";

/// 程序入口：根据参数分流到 GUI / Windows 服务 / 安装卸载模式。
fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|a| a == "--service") {
        #[cfg(not(windows))]
        {
            std::process::exit(1);
        }
        #[cfg(windows)]
        let result = windows_service_entry::run_windows_service();
        std::process::exit(if result.is_ok() { 0 } else { 1 });
    }

    if args.iter().any(|a| a == "--install-service") {
        #[cfg(not(windows))]
        {
            std::process::exit(1);
        }
        let result = install_service();
        std::process::exit(if result.is_ok() { 0 } else { 1 });
    }

    if args.iter().any(|a| a == "--uninstall-service") {
        #[cfg(not(windows))]
        {
            std::process::exit(1);
        }
        let result = uninstall_service();
        std::process::exit(if result.is_ok() { 0 } else { 1 });
    }

    #[cfg(all(windows, not(debug_assertions)))]
    {
        ensure_single_instance_or_wake();
    }

    air_icon_launcher_lib::run();
}

/// 确保 GUI 只启动一个实例；如果已存在，则唤起主窗口并退出当前进程。
#[cfg(all(windows, not(debug_assertions)))]
fn ensure_single_instance_or_wake() {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows::Win32::System::Threading::CreateMutexW;
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowW, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW,
    };

    fn to_wide(s: &OsStr) -> Vec<u16> {
        s.encode_wide().chain(Some(0)).collect()
    }

    let mutex_name = to_wide(OsStr::new(SINGLE_INSTANCE_MUTEX_NAME));
    let _mutex = unsafe { CreateMutexW(None, false, windows::core::PCWSTR(mutex_name.as_ptr())) };
    let last_error = unsafe { GetLastError() };

    if last_error == ERROR_ALREADY_EXISTS {
        let title = to_wide(OsStr::new(MAIN_WINDOW_TITLE));
        let hwnd = unsafe { FindWindowW(None, windows::core::PCWSTR(title.as_ptr())) };
        if hwnd.0 != 0 {
            unsafe {
                let _ = ShowWindow(hwnd, SW_RESTORE);
                let _ = ShowWindow(hwnd, SW_SHOW);
                let _ = SetForegroundWindow(hwnd);
            }
        }
        std::process::exit(0);
    }
}

/// 安装开机自启服务，并配置为系统启动时启动（AUTO_START）。
#[cfg(windows)]
fn install_service() -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
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
        .map_err(|e| e.to_string())?;

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
            .map_err(|e| e.to_string())?;
        config.status.success()
    };

    if !created_or_configured {
        let err = format!(
            "{}\n{}",
            String::from_utf8_lossy(&create.stdout),
            String::from_utf8_lossy(&create.stderr)
        );
        return Err(err.trim().to_string());
    }

    let _ = Command::new("sc")
        .creation_flags(0x08000000)
        .args(["description", SERVICE_NAME, SERVICE_DESCRIPTION])
        .output()
        .map_err(|e| e.to_string())
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

/// 停止并卸载开机自启服务。
#[cfg(windows)]
fn uninstall_service() -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    let _ = Command::new("sc")
        .creation_flags(0x08000000)
        .args(["stop", SERVICE_NAME])
        .output();
    let delete = Command::new("sc")
        .creation_flags(0x08000000)
        .args(["delete", SERVICE_NAME])
        .output()
        .map_err(|e| e.to_string())?;

    if delete.status.success() {
        Ok(())
    } else {
        let err = format!(
            "{}\n{}",
            String::from_utf8_lossy(&delete.stdout),
            String::from_utf8_lossy(&delete.stderr)
        );
        Err(err.trim().to_string())
    }
}

/// 安装并启动开机自启服务（非 Windows 平台占位实现）。
#[cfg(not(windows))]
fn install_service() -> Result<(), String> {
    Err("开机自启服务仅支持 Windows".to_string())
}

/// 停止并卸载开机自启服务（非 Windows 平台占位实现）。
#[cfg(not(windows))]
fn uninstall_service() -> Result<(), String> {
    Err("开机自启服务仅支持 Windows".to_string())
}
