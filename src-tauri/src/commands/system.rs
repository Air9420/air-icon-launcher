use std::path::Path;

/// Normalize a file system path for comparison: lowercase, unified separators.
fn normalize_path(path: &str) -> String {
    path.trim().replace('/', "\\").to_ascii_lowercase()
}

/// Extract the file name (e.g. "chrome.exe") from a path, lowercased.
fn file_name_lower(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_ascii_lowercase())
        .unwrap_or_default()
}

/// Check whether any running process matches the given executable path.
///
/// Performance strategy: filter by file name first (cheap string comparison),
/// then verify the full path via `QueryFullProcessImageNameW` only for candidates.
#[tauri::command]
pub async fn is_process_running(target_path: String) -> Result<bool, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = target_path;
        return Ok(false);
    }

    #[cfg(target_os = "windows")]
    {
        use windows::core::PWSTR;
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };
        use windows::Win32::System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
            PROCESS_QUERY_LIMITED_INFORMATION,
        };

        let target_normalized = normalize_path(&target_path);
        let target_file_name = file_name_lower(&target_path);

        if target_normalized.is_empty() || target_file_name.is_empty() {
            return Ok(false);
        }

        // Snapshot all processes.
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
            .map_err(|e| format!("CreateToolhelp32Snapshot failed: {}", e))?;

        if snapshot.is_invalid() {
            let _ = unsafe { CloseHandle(snapshot) };
            return Err("Invalid snapshot handle".to_string());
        }

        let mut entry = PROCESSENTRY32W::default();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        if unsafe { Process32FirstW(snapshot, &mut entry as *mut _) }.is_err() {
            let _ = unsafe { CloseHandle(snapshot) };
            return Ok(false);
        }

        // Collect PIDs whose exe name matches the target file name (fast filter).
        let mut candidate_pids: Vec<u32> = Vec::new();
        loop {
            // PROCESSENTRY32W::szExeFile is [u16; 260]
            let exe_name = String::from_utf16_lossy(
                &entry.szExeFile[..entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len())],
            );
            if exe_name.to_ascii_lowercase() == target_file_name {
                candidate_pids.push(entry.th32ProcessID);
            }
            if unsafe { Process32NextW(snapshot, &mut entry as *mut _) }.is_err() {
                break;
            }
        }
        let _ = unsafe { CloseHandle(snapshot) };

        // Verify full path for each candidate.
        for pid in candidate_pids {
            let handle = match unsafe {
                OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
            } {
                Ok(h) => h,
                Err(_) => continue,
            };

            let mut buffer = vec![0u16; 32768];
            let mut length = buffer.len() as u32;

            let ok = unsafe {
                QueryFullProcessImageNameW(
                    handle,
                    PROCESS_NAME_WIN32,
                    PWSTR(buffer.as_mut_ptr()),
                    &mut length,
                )
            };
            let _ = unsafe { CloseHandle(handle) };

            if ok.is_err() {
                continue;
            }

            let process_path =
                String::from_utf16_lossy(&buffer[..(length as usize)]);
            if normalize_path(&process_path) == target_normalized {
                return Ok(true);
            }
        }

        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_path_unifies_separators_and_case() {
        assert_eq!(
            normalize_path("C:/Program Files/App/test.exe"),
            "c:\\program files\\app\\test.exe"
        );
        assert_eq!(
            normalize_path("C:\\Program Files\\App\\TEST.EXE"),
            "c:\\program files\\app\\test.exe"
        );
    }

    #[test]
    fn file_name_lower_extracts_exe() {
        assert_eq!(
            file_name_lower("C:\\Program Files\\Google\\Chrome\\chrome.exe"),
            "chrome.exe"
        );
        assert_eq!(file_name_lower("notepad.exe"), "notepad.exe");
        assert_eq!(file_name_lower(""), "");
    }
}
