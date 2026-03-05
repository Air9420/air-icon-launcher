use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::time::Duration;

use windows_service::define_windows_service;
use windows_service::service::{
    ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
    ServiceType,
};
use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
use windows_service::service_dispatcher;

const SERVICE_NAME: &str = "AirIconLauncher";

/// 以 Windows 服务模式运行（被 SCM 调用的入口）。
pub fn run_windows_service() -> Result<(), String> {
    service_dispatcher::start(SERVICE_NAME, ffi_service_main)
        .map_err(|e| e.to_string())
}

define_windows_service!(ffi_service_main, service_main);

/// Windows 服务主逻辑：等待用户会话可用后，启动 GUI 程序并退出。
fn service_main(_arguments: Vec<std::ffi::OsString>) {
    if let Err(_e) = run_service_inner() {
        std::process::exit(1);
    }
}

fn run_service_inner() -> Result<(), String> {
    let (shutdown_tx, shutdown_rx) = std::sync::mpsc::channel::<()>();

    let status_handle = service_control_handler::register(
        SERVICE_NAME,
        move |control_event| -> ServiceControlHandlerResult {
            match control_event {
                ServiceControl::Stop | ServiceControl::Shutdown => {
                    let _ = shutdown_tx.send(());
                    ServiceControlHandlerResult::NoError
                }
                _ => ServiceControlHandlerResult::NotImplemented,
            }
        },
    )
    .map_err(|e| e.to_string())?;

    status_handle
        .set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: ServiceState::Running,
            controls_accepted: ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN,
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: Duration::from_secs(30),
            process_id: None,
        })
        .map_err(|e| e.to_string())?;

    let _ = launch_gui_in_active_session(&shutdown_rx);

    status_handle
        .set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: ServiceState::Stopped,
            controls_accepted: ServiceControlAccept::empty(),
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: Duration::default(),
            process_id: None,
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn to_wide(s: &OsStr) -> Vec<u16> {
    s.encode_wide().chain(Some(0)).collect()
}

fn launch_gui_in_active_session(shutdown_rx: &std::sync::mpsc::Receiver<()>) -> Result<(), String> {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{
        DuplicateTokenEx, SecurityImpersonation, TokenPrimary, TOKEN_ALL_ACCESS,
    };
    use windows::Win32::System::RemoteDesktop::WTSQueryUserToken;
    use windows::Win32::System::Threading::{
        CreateProcessAsUserW, PROCESS_CREATION_FLAGS, PROCESS_INFORMATION, STARTUPINFOW,
    };
    use windows::Win32::System::RemoteDesktop::WTSGetActiveConsoleSessionId;

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_w = to_wide(exe.as_os_str());

    loop {
        if shutdown_rx.try_recv().is_ok() {
            return Ok(());
        }

        let session_id = unsafe { WTSGetActiveConsoleSessionId() };
        if session_id == u32::MAX {
            std::thread::sleep(Duration::from_secs(1));
            continue;
        }

        let mut user_token = HANDLE::default();
        unsafe {
            if WTSQueryUserToken(session_id, &mut user_token).is_err() {
                std::thread::sleep(Duration::from_secs(1));
                continue;
            }
        }

        let mut primary_token = HANDLE::default();
        unsafe {
            DuplicateTokenEx(
                user_token,
                TOKEN_ALL_ACCESS,
                None,
                SecurityImpersonation,
                TokenPrimary,
                &mut primary_token,
            )
            .map_err(|e| e.message().to_string())?;
            let _ = CloseHandle(user_token);
        }

        let mut startup_info = STARTUPINFOW::default();
        startup_info.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        let desktop = to_wide(OsStr::new("winsta0\\default"));
        startup_info.lpDesktop = windows::core::PWSTR(desktop.as_ptr() as *mut u16);

        let mut proc_info = PROCESS_INFORMATION::default();

        let mut cmd = to_wide(OsStr::new(
            &format!("\"{}\" --autostart", exe.display()),
        ));

        unsafe {
            CreateProcessAsUserW(
                primary_token,
                windows::core::PCWSTR(exe_w.as_ptr()),
                windows::core::PWSTR(cmd.as_mut_ptr()),
                None,
                None,
                false,
                PROCESS_CREATION_FLAGS(0),
                None,
                windows::core::PCWSTR::null(),
                &startup_info,
                &mut proc_info,
            )
            .map_err(|e| e.message().to_string())?;

            let _ = CloseHandle(primary_token);
            let _ = CloseHandle(proc_info.hProcess);
            let _ = CloseHandle(proc_info.hThread);
        }

        return Ok(());
    }
}
