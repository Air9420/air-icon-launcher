use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IccProfile {
    pub id: String,
    pub monitor_name: String,
    pub monitor_device_id: String,
    pub icc_path: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub name: String,
    pub device_id: String,
    pub is_primary: bool,
}

pub struct IccState {
    pub profiles: Mutex<Vec<IccProfile>>,
}

impl Default for IccState {
    fn default() -> Self {
        Self {
            profiles: Mutex::new(Vec::new()),
        }
    }
}

#[cfg(windows)]
pub fn get_connected_monitors() -> AppResult<Vec<MonitorInfo>> {
    use windows::Win32::Graphics::Gdi::{DISPLAY_DEVICEW, EnumDisplayDevicesW};
    use std::mem;

    let mut monitors = Vec::new();
    let mut display_device: DISPLAY_DEVICEW = unsafe { mem::zeroed() };
    display_device.cb = mem::size_of::<DISPLAY_DEVICEW>() as u32;

    let mut device_index = 0u32;

    loop {
        let result = unsafe {
            EnumDisplayDevicesW(None, device_index, &mut display_device, 0)
        };

        if !result.as_bool() {
            break;
        }

        let state_flags = display_device.StateFlags;
        let is_disconnected = (state_flags & 0x20000000) != 0;
        let is_primary = (state_flags & 0x4) != 0;

        if !is_disconnected {
            let name = String::from_utf16_lossy(
                &display_device.DeviceName[..display_device.DeviceName.iter().position(|&c| c == 0).unwrap_or(32)]
            );
            let device_id = String::from_utf16_lossy(
                &display_device.DeviceID[..display_device.DeviceID.iter().position(|&c| c == 0).unwrap_or(128)]
            );

            monitors.push(MonitorInfo {
                name: name.trim().to_string(),
                device_id,
                is_primary,
            });
        }

        device_index += 1;
        if device_index > 16 {
            break;
        }
    }

    if monitors.is_empty() {
        monitors.push(MonitorInfo {
            name: "Display 1".to_string(),
            device_id: String::new(),
            is_primary: true,
        });
    }

    Ok(monitors)
}

#[cfg(not(windows))]
pub fn get_connected_monitors() -> AppResult<Vec<MonitorInfo>> {
    Ok(vec![MonitorInfo {
        name: "Display 1".to_string(),
        device_id: String::new(),
        is_primary: true,
    }])
}

#[tauri::command]
pub fn get_monitors() -> AppResult<Vec<MonitorInfo>> {
    get_connected_monitors()
}

#[tauri::command]
pub fn get_icc_profiles(state: tauri::State<'_, IccState>) -> AppResult<Vec<IccProfile>> {
    let profiles = state.profiles.lock()
        .map_err(|_| AppError::internal("Failed to lock ICC state"))?;
    Ok(profiles.clone())
}

#[tauri::command]
pub fn add_icc_profile(
    state: tauri::State<'_, IccState>,
    profile: IccProfile,
) -> AppResult<()> {
    let mut profiles = state.profiles.lock()
        .map_err(|_| AppError::internal("Failed to lock ICC state"))?;
    
    if profiles.iter().any(|p| p.id == profile.id) {
        return Err(AppError::invalid_input("Profile with this ID already exists"));
    }
    
    profiles.push(profile);
    Ok(())
}

#[tauri::command]
pub fn remove_icc_profile(
    state: tauri::State<'_, IccState>,
    profile_id: String,
) -> AppResult<()> {
    let mut profiles = state.profiles.lock()
        .map_err(|_| AppError::internal("Failed to lock ICC state"))?;
    
    profiles.retain(|p| p.id != profile_id);
    Ok(())
}

#[tauri::command]
pub fn toggle_icc_profile(
    state: tauri::State<'_, IccState>,
    profile_id: String,
    enabled: bool,
) -> AppResult<()> {
    let mut profiles = state.profiles.lock()
        .map_err(|_| AppError::internal("Failed to lock ICC state"))?;
    
    if let Some(profile) = profiles.iter_mut().find(|p| p.id == profile_id) {
        profile.enabled = enabled;
        Ok(())
    } else {
        Err(AppError::not_found("ICC profile not found"))
    }
}

#[tauri::command]
pub fn select_icc_file() -> AppResult<Option<String>> {
    let dialog = rfd::FileDialog::new()
        .add_filter("ICC Profile", &["icc", "icm"])
        .set_title("Select ICC Profile");
    
    Ok(dialog.pick_file().map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn get_system_icc_profiles() -> AppResult<Vec<String>> {
    #[cfg(windows)]
    {
        use std::path::PathBuf;
        use windows::Win32::UI::Shell::{SHGetFolderPathW, CSIDL_SYSTEM};
        
        let mut profiles = Vec::new();
        
        // Get system color directory
        let mut path_buf = [0u16; 260];
        unsafe {
            if SHGetFolderPathW(None, CSIDL_SYSTEM as i32, None, 0, &mut path_buf).is_ok() {
                let system_path = String::from_utf16_lossy(
                    &path_buf[..path_buf.iter().position(|&c| c == 0).unwrap_or(260)]
                );
                let color_dir = PathBuf::from(system_path).join("spool").join("drivers").join("color");
                
                if let Ok(entries) = std::fs::read_dir(&color_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if let Some(ext) = path.extension() {
                            if ext == "icc" || ext == "icm" {
                                profiles.push(path.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
        }
        
        profiles.sort();
        Ok(profiles)
    }
    
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}
