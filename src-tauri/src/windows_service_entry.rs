use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::io::Write;
use std::time::Duration;

use windows_service::define_windows_service;
use windows_service::service::{
    ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
    ServiceType,
};
use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
use windows_service::service_dispatcher;

const SERVICE_NAME: &str = "AirIconLauncher";

fn log_to_file(message: &str) {
    let program_data = std::env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".to_string());
    let dir = std::path::PathBuf::from(program_data).join("AirIconLauncher");
    let _ = std::fs::create_dir_all(&dir);
    let log_path = dir.join("service.log");

    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = writeln!(file, "[{}] {}", timestamp, message);
    }
}

/// 以 Windows 服务模式运行（被 SCM 调用的入口）。
pub fn run_windows_service() -> Result<(), String> {
    service_dispatcher::start(SERVICE_NAME, ffi_service_main)
        .map_err(|e| e.to_string())
}

define_windows_service!(ffi_service_main, service_main);

/// Windows 服务主逻辑：等待用户会话可用后，启动 GUI 程序并退出。
fn service_main(_arguments: Vec<std::ffi::OsString>) {
    log_to_file("服务启动");
    if let Err(e) = run_service_inner() {
        log_to_file(&format!("服务运行错误: {}", e));
        std::process::exit(1);
    }
    log_to_file("服务正常退出");
}

fn run_service_inner() -> Result<(), String> {
    let (shutdown_tx, shutdown_rx) = std::sync::mpsc::channel::<()>();
    let (wake_tx, wake_rx) = std::sync::mpsc::channel::<()>();

    let status_handle = service_control_handler::register(
        SERVICE_NAME,
        move |control_event| -> ServiceControlHandlerResult {
            match control_event {
                ServiceControl::Stop | ServiceControl::Shutdown => {
                    let _ = shutdown_tx.send(());
                    ServiceControlHandlerResult::NoError
                }
                ServiceControl::SessionChange { .. } => {
                    let _ = wake_tx.send(());
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
            controls_accepted: ServiceControlAccept::STOP
                | ServiceControlAccept::SHUTDOWN
                | ServiceControlAccept::SESSION_CHANGE,
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: Duration::from_secs(30),
            process_id: None,
        })
        .map_err(|e| e.to_string())?;

    let _ = launch_gui_in_active_session(&shutdown_rx, &wake_rx);

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

/// 在用户会话可用时启动 GUI（服务可在用户登录前启动；登录事件到来后会加速触发尝试）。
fn launch_gui_in_active_session(
    shutdown_rx: &std::sync::mpsc::Receiver<()>,
    wake_rx: &std::sync::mpsc::Receiver<()>,
) -> Result<(), String> {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{
        DuplicateTokenEx, SecurityImpersonation, TokenPrimary, TOKEN_ALL_ACCESS,
    };
    use windows::Win32::System::RemoteDesktop::WTSQueryUserToken;
    use windows::Win32::System::Threading::{
        CreateProcessAsUserW, PROCESS_CREATION_FLAGS, PROCESS_INFORMATION, STARTUPINFOW,
    };
    use windows::Win32::System::RemoteDesktop::WTSGetActiveConsoleSessionId;
    use windows::Win32::System::Environment::{CreateEnvironmentBlock, DestroyEnvironmentBlock};

    let exe = std::env::current_exe().map_err(|e| {
        let msg = format!("获取可执行文件路径失败: {}", e);
        log_to_file(&msg);
        msg
    })?;
    let exe_w = to_wide(exe.as_os_str());
    
    log_to_file(&format!("准备启动 GUI: {}", exe.display()));

    let mut attempt = 0u64;

    loop {
        if shutdown_rx.try_recv().is_ok() {
            log_to_file("收到关闭信号，退出");
            return Ok(());
        }
        if wake_rx.try_recv().is_ok() {
            log_to_file("收到会话变更通知，准备尝试启动 GUI");
        }

        attempt += 1;

        let session_id = unsafe { WTSGetActiveConsoleSessionId() };
        if session_id == u32::MAX {
            if attempt == 1 || attempt % 30 == 0 {
                log_to_file(&format!("等待用户登录会话... (轮询 {})", attempt));
            }
            std::thread::sleep(Duration::from_secs(1));
            continue;
        }

        let mut user_token = HANDLE::default();
        unsafe {
            if WTSQueryUserToken(session_id, &mut user_token).is_err() {
                if attempt == 1 || attempt % 30 == 0 {
                    log_to_file(&format!("获取用户令牌失败，重试... (轮询 {})", attempt));
                }
                std::thread::sleep(Duration::from_secs(1));
                continue;
            }
        }

        let mut primary_token = HANDLE::default();
        let dup_result = unsafe {
            DuplicateTokenEx(
                user_token,
                TOKEN_ALL_ACCESS,
                None,
                SecurityImpersonation,
                TokenPrimary,
                &mut primary_token,
            )
        };
        
        let _ = unsafe { CloseHandle(user_token) };
        
        if dup_result.is_err() {
            let err = dup_result.unwrap_err().message().to_string();
            log_to_file(&format!("复制令牌失败: {} (尝试 {})", err, attempt));
            std::thread::sleep(Duration::from_secs(1));
            continue;
        }

        let mut startup_info = STARTUPINFOW::default();
        startup_info.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        let desktop = to_wide(OsStr::new("winsta0\\default"));
        startup_info.lpDesktop = windows::core::PWSTR(desktop.as_ptr() as *mut u16);

        let mut proc_info = PROCESS_INFORMATION::default();

        let mut cmd = to_wide(OsStr::new(
            &format!("\"{}\" --autostart", exe.display()),
        ));

        let mut env_block: *mut std::ffi::c_void = std::ptr::null_mut();
        let env_result = unsafe { CreateEnvironmentBlock(&mut env_block, primary_token, false) };
        
        if env_result.is_err() {
            log_to_file(&format!("创建环境块失败: {:?}", env_result.err()));
        }
        let use_env = !env_block.is_null();

        let create_result = unsafe {
            use windows::Win32::System::Threading::CREATE_UNICODE_ENVIRONMENT;
            CreateProcessAsUserW(
                primary_token,
                windows::core::PCWSTR(exe_w.as_ptr()),
                windows::core::PWSTR(cmd.as_mut_ptr()),
                None,
                None,
                false,
                if use_env {
                    PROCESS_CREATION_FLAGS(CREATE_UNICODE_ENVIRONMENT.0)
                } else {
                    PROCESS_CREATION_FLAGS(0)
                },
                if use_env { Some(env_block) } else { None },
                windows::core::PCWSTR::null(),
                &startup_info,
                &mut proc_info,
            )
        };

        if use_env {
            let _ = unsafe { DestroyEnvironmentBlock(env_block) };
        }
        let _ = unsafe { CloseHandle(primary_token) };

        match create_result {
            Ok(_) => {
                log_to_file(&format!("GUI 进程启动成功 (PID: {:?})", proc_info.dwProcessId));
                let _ = unsafe { CloseHandle(proc_info.hProcess) };
                let _ = unsafe { CloseHandle(proc_info.hThread) };
                return Ok(());
            }
            Err(e) => {
                log_to_file(&format!("CreateProcessAsUserW 失败: {} (尝试 {})", e.message(), attempt));
                std::thread::sleep(Duration::from_secs(2));
            }
        }
    }
}
