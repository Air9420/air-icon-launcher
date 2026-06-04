use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::AppHandle;

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
