use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemProcessLaunchedEvent {
    pub name: String,
    pub path: String,
    pub icon_base64: Option<String>,
    pub source: String,
    pub used_at: u64,
}

const PROCESS_SCAN_INTERVAL_MS: u64 = 1200;
const PROCESS_LAUNCH_DEDUP_WINDOW_MS: u64 = 5000;
const PROCESS_WINDOW_WAIT_MS: u64 = 8000;
const PROCESS_USER_INPUT_IDLE_MAX_MS: u64 = 4500;
const EVENT_NAME: &str = "system-process-launched";

#[cfg(target_os = "windows")]
const NOISY_EXECUTABLE_NAMES: &[&str] = &[
    "air-icon-launcher.exe",
    "applicationframehost.exe",
    "audiodg.exe",
    "backgroundtaskhost.exe",
    "cmd.exe",
    "conhost.exe",
    "csrss.exe",
    "ctfmon.exe",
    "dllhost.exe",
    "dwm.exe",
    "explorer.exe",
    "fontdrvhost.exe",
    "java.exe",
    "javaw.exe",
    "lsass.exe",
    "msedgewebview2.exe",
    "node.exe",
    "npm.exe",
    "npx.exe",
    "pnpm.exe",
    "pwsh.exe",
    "powershell.exe",
    "vite.exe",
    "vue-tsc.exe",
    "runtimebroker.exe",
    "searchhost.exe",
    "securityhealthsystray.exe",
    "services.exe",
    "shellexperiencehost.exe",
    "sihost.exe",
    "smartscreen.exe",
    "spoolsv.exe",
    "startmenuexperiencehost.exe",
    "svchost.exe",
    "taskhostw.exe",
    "vctip.exe",
    "wininit.exe",
    "winlogon.exe",
    "wudfhost.exe",
];

#[cfg(target_os = "windows")]
const NOISY_PATH_PARTS: &[&str] = &[
    "\\windows\\system32\\",
    "\\windows\\syswow64\\",
    "\\windows\\winsxs\\",
    "\\windows\\servicing\\",
    "\\windows\\microsoft.net\\",
    "\\windows\\assembly\\",
];

#[cfg(target_os = "windows")]
pub fn start_process_monitor(app: AppHandle) {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{BOOL, CloseHandle, LPARAM, HWND};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::SystemInformation::GetTickCount64;
    use windows::Win32::System::Threading::{
        GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindow, GetWindowThreadProcessId, IsWindowVisible,
        GW_OWNER,
    };

    #[derive(Debug, Clone, Copy)]
    struct PendingProcess {
        first_seen_at: u64,
    }

    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    fn normalize_path_key(path: &str) -> String {
        path.trim().replace('/', "\\").to_ascii_lowercase()
    }

    fn file_name_lower(path: &str) -> String {
        Path::new(path)
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_ascii_lowercase())
            .unwrap_or_default()
    }

    fn display_name_from_path(path: &str) -> String {
        Path::new(path)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .map(|stem| stem.trim().to_string())
            .filter(|stem| !stem.is_empty())
            .unwrap_or_else(|| path.to_string())
    }

    fn is_noisy_path(path: &str, self_exe_key: &str) -> bool {
        let key = normalize_path_key(path);
        if key.is_empty() {
            return true;
        }
        if key == self_exe_key {
            return true;
        }
        if !key.ends_with(".exe") {
            return true;
        }
        if NOISY_PATH_PARTS.iter().any(|part| key.contains(part)) {
            return true;
        }
        let exe_name = file_name_lower(path);
        if NOISY_EXECUTABLE_NAMES.iter().any(|name| *name == exe_name) {
            return true;
        }
        false
    }

    fn read_process_path(pid: u32) -> Option<String> {
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
        let mut buffer = vec![0u16; 32768];
        let mut length = buffer.len() as u32;

        let query_result = unsafe {
            QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                PWSTR(buffer.as_mut_ptr()),
                &mut length,
            )
        };
        let _ = unsafe { CloseHandle(handle) };
        if query_result.is_err() {
            return None;
        }

        let value = String::from_utf16_lossy(&buffer[..(length as usize)]);
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }

    fn enumerate_process_ids() -> HashSet<u32> {
        let mut ids = HashSet::new();
        let snapshot = match unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) } {
            Ok(handle) => handle,
            Err(_) => return ids,
        };

        if snapshot.is_invalid() {
            let _ = unsafe { CloseHandle(snapshot) };
            return ids;
        }

        let mut entry = PROCESSENTRY32W::default();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        if unsafe { Process32FirstW(snapshot, &mut entry as *mut _) }.is_ok() {
            loop {
                ids.insert(entry.th32ProcessID);
                if unsafe { Process32NextW(snapshot, &mut entry as *mut _) }.is_err() {
                    break;
                }
            }
        }

        let _ = unsafe { CloseHandle(snapshot) };
        ids
    }

    fn has_recent_user_input(max_idle_ms: u64) -> bool {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };

        if !unsafe { GetLastInputInfo(&mut info as *mut _) }.as_bool() {
            return false;
        }

        let now_tick = unsafe { GetTickCount64() };
        let last_tick = info.dwTime as u64;
        let idle = now_tick.saturating_sub(last_tick);
        idle <= max_idle_ms
    }

    fn should_emit_path(path: &str, self_exe_key: &str) -> bool {
        !is_noisy_path(path, self_exe_key)
    }

    struct VisibleWindowProbe {
        pid: u32,
        found: bool,
    }

    unsafe extern "system" fn enum_windows_for_pid(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let probe = &mut *(lparam.0 as *mut VisibleWindowProbe);
        let mut window_pid = 0u32;
        let _ = GetWindowThreadProcessId(hwnd, Some(&mut window_pid as *mut _));
        if window_pid != probe.pid {
            return BOOL::from(true);
        }

        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL::from(true);
        }

        if GetWindow(hwnd, GW_OWNER).0 != 0 {
            return BOOL::from(true);
        }

        probe.found = true;
        BOOL::from(false)
    }

    fn has_visible_top_level_window(pid: u32) -> bool {
        let mut probe = VisibleWindowProbe { pid, found: false };
        let _ = unsafe {
            EnumWindows(
                Some(enum_windows_for_pid),
                LPARAM((&mut probe as *mut VisibleWindowProbe) as isize),
            )
        };
        probe.found
    }

    fn is_foreground_process(pid: u32) -> bool {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.0 == 0 {
            return false;
        }
        let mut foreground_pid = 0u32;
        let _ = unsafe { GetWindowThreadProcessId(hwnd, Some(&mut foreground_pid as *mut _)) };
        foreground_pid == pid
    }

    let self_pid = unsafe { GetCurrentProcessId() };
    let self_exe_key = std::env::current_exe()
        .ok()
        .and_then(|path| path.to_str().map(normalize_path_key))
        .unwrap_or_default();

    std::thread::spawn(move || {
        let mut previous_pids = enumerate_process_ids();
        let mut last_emitted_by_path = HashMap::<String, u64>::new();
        let mut pending_pids = HashMap::<u32, PendingProcess>::new();

        loop {
            std::thread::sleep(Duration::from_millis(PROCESS_SCAN_INTERVAL_MS));

            let current_pids = enumerate_process_ids();
            if current_pids.is_empty() {
                previous_pids = current_pids;
                continue;
            }

            let started_pids: Vec<u32> = current_pids
                .iter()
                .filter(|pid| !previous_pids.contains(pid))
                .copied()
                .collect();

            pending_pids.retain(|pid, _| current_pids.contains(pid));
            previous_pids = current_pids;

            for pid in started_pids {
                if pid == 0 || pid == self_pid {
                    continue;
                }
                pending_pids.entry(pid).or_insert_with(|| PendingProcess {
                    first_seen_at: now_ms(),
                });
            }

            let now = now_ms();
            let mut completed_pids = Vec::<u32>::new();
            let mut dropped_pids = Vec::<u32>::new();

            for (&pid, pending) in pending_pids.iter() {
                if now.saturating_sub(pending.first_seen_at) > PROCESS_WINDOW_WAIT_MS {
                    dropped_pids.push(pid);
                    continue;
                }

                if !has_visible_top_level_window(pid) {
                    continue;
                }

                if !is_foreground_process(pid) {
                    continue;
                }

                if !has_recent_user_input(PROCESS_USER_INPUT_IDLE_MAX_MS) {
                    continue;
                }

                let Some(path) = read_process_path(pid) else {
                    dropped_pids.push(pid);
                    continue;
                };

                if !should_emit_path(&path, &self_exe_key) {
                    completed_pids.push(pid);
                    continue;
                }

                let path_key = normalize_path_key(&path);
                if path_key.is_empty() {
                    completed_pids.push(pid);
                    continue;
                }

                if let Some(last_emitted_at) = last_emitted_by_path.get(&path_key) {
                    if now.saturating_sub(*last_emitted_at) < PROCESS_LAUNCH_DEDUP_WINDOW_MS {
                        completed_pids.push(pid);
                        continue;
                    }
                }

                let event = SystemProcessLaunchedEvent {
                    name: display_name_from_path(&path),
                    path: path.clone(),
                    icon_base64: crate::commands::installed_apps::extract_icon_for_path(&path),
                    source: "系统启动".to_string(),
                    used_at: now,
                };

                let _ = app.emit(EVENT_NAME, event);
                last_emitted_by_path.insert(path_key, now);
                completed_pids.push(pid);
            }

            for pid in completed_pids.into_iter().chain(dropped_pids.into_iter()) {
                pending_pids.remove(&pid);
            }

            if last_emitted_by_path.len() > 300 {
                let cutoff = now_ms().saturating_sub(60_000);
                last_emitted_by_path.retain(|_, value| *value >= cutoff);
            }
        }
    });
}

#[cfg(not(target_os = "windows"))]
pub fn start_process_monitor(_app: AppHandle) {}
