use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IccProfile {
    pub id: String,
    pub monitor_name: String,
    pub monitor_device_id: String,
    pub icc_path: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub name: String,
    pub friendly_name: String,
    pub device_id: String,
    pub is_primary: bool,
}

pub struct IccState {
    pub profiles: Mutex<Vec<IccProfile>>,
    pub app_handle: Mutex<Option<tauri::AppHandle>>,
}

impl Default for IccState {
    fn default() -> Self {
        Self {
            profiles: Mutex::new(Vec::new()),
            app_handle: Mutex::new(None),
        }
    }
}

impl IccState {
    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        if let Ok(mut h) = self.app_handle.lock() {
            *h = Some(handle);
        }
    }

    fn save_profiles_to_config(&self) -> AppResult<()> {
        let profiles = self.profiles.lock()
            .map_err(|_| AppError::internal("Failed to lock ICC state"))?;

        let app_handle = self.app_handle.lock()
            .map_err(|_| AppError::internal("Failed to lock app handle"))?;

        if let Some(handle) = app_handle.as_ref() {
            let config_manager = handle.state::<crate::config::ConfigManager>();
            let mut current_config = config_manager.load_config();
            current_config.icc_profiles = profiles.clone();
            config_manager.save_config(&current_config)
                .map_err(|e| AppError::internal(format!("Failed to save config: {}", e)))?;
        }

        Ok(())
    }
}

#[cfg(windows)]
pub fn get_connected_monitors() -> AppResult<Vec<MonitorInfo>> {
    use windows::Win32::Graphics::Gdi::{DISPLAY_DEVICEW, EnumDisplayDevicesW};
    use std::mem;

    const DISPLAY_DEVICE_ATTACHED_TO_DESKTOP: u32 = 0x1;
    const DISPLAY_DEVICE_PRIMARY_DEVICE: u32 = 0x4;
    const DISPLAY_DEVICE_MIRRORING_DRIVER: u32 = 0x8;

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
        let is_attached = (state_flags & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP) != 0;
        let is_primary = (state_flags & DISPLAY_DEVICE_PRIMARY_DEVICE) != 0;
        let is_mirror = (state_flags & DISPLAY_DEVICE_MIRRORING_DRIVER) != 0;

        if is_attached && !is_mirror {
            let name = String::from_utf16_lossy(
                &display_device.DeviceName[..display_device.DeviceName.iter().position(|&c| c == 0).unwrap_or(32)]
            );
            let device_id = String::from_utf16_lossy(
                &display_device.DeviceID[..display_device.DeviceID.iter().position(|&c| c == 0).unwrap_or(128)]
            );
            
            let device_string = String::from_utf16_lossy(
                &display_device.DeviceString[..display_device.DeviceString.iter().position(|&c| c == 0).unwrap_or(128)]
            );
            
            let friendly_name = if !device_string.is_empty() {
                device_string
            } else {
                extract_display_name_from_id(&device_id)
            };

            monitors.push(MonitorInfo {
                name: name.trim().to_string(),
                friendly_name: friendly_name.trim().to_string(),
                device_id,
                is_primary,
            });
        }

        device_index += 1;
        if device_index > 32 {
            break;
        }
    }

    if monitors.is_empty() {
        monitors.push(MonitorInfo {
            name: "Display 1".to_string(),
            friendly_name: "Display 1".to_string(),
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
        friendly_name: "Display 1".to_string(),
        device_id: String::new(),
        is_primary: true,
    }])
}

fn extract_display_name_from_id(device_id: &str) -> String {
    let vendor_names = [
        ("VEN_10DE", "NVIDIA"),
        ("VEN_1002", "AMD"),
        ("VEN_8086", "Intel"),
        ("VEN_1414", "Microsoft"),
    ];
    
    for (ven_id, name) in &vendor_names {
        if device_id.contains(ven_id) {
            return format!("{} Display", name);
        }
    }
    
    "Unknown Display".to_string()
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
    {
        let mut profiles = state.profiles.lock()
            .map_err(|_| AppError::internal("Failed to lock ICC state"))?;
        
        if profiles.iter().any(|p| p.id == profile.id) {
            return Err(AppError::invalid_input("Profile with this ID already exists"));
        }
        
        profiles.push(profile);
    }
    
    state.save_profiles_to_config()?;
    Ok(())
}

#[tauri::command]
pub fn remove_icc_profile(
    state: tauri::State<'_, IccState>,
    profile_id: String,
) -> AppResult<()> {
    {
        let mut profiles = state.profiles.lock()
            .map_err(|_| AppError::internal("Failed to lock ICC state"))?;
        
        profiles.retain(|p| p.id != profile_id);
    }
    
    state.save_profiles_to_config()?;
    Ok(())
}

#[tauri::command]
pub fn toggle_icc_profile(
    state: tauri::State<'_, IccState>,
    profile_id: String,
    enabled: bool,
) -> AppResult<()> {
    {
        let mut profiles = state.profiles.lock()
            .map_err(|_| AppError::internal("Failed to lock ICC state"))?;
        
        if let Some(profile) = profiles.iter_mut().find(|p| p.id == profile_id) {
            profile.enabled = enabled;
        } else {
            return Err(AppError::not_found("ICC profile not found"));
        }
    }
    
    state.save_profiles_to_config()?;
    Ok(())
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

#[cfg(windows)]
pub fn apply_icc_to_monitor(device_name: &str, icc_path: &str) -> AppResult<()> {
    use windows::Win32::UI::ColorSystem::{
        WcsSetDefaultColorProfile, WCS_PROFILE_MANAGEMENT_SCOPE_CURRENT_USER,
        WcsAssociateColorProfileWithDevice,
    };
    use windows::Win32::Graphics::Gdi::{
        ChangeDisplaySettingsExW, CDS_UPDATEREGISTRY, DEVMODEW,
        EnumDisplaySettingsExW, EDS_RAWMODE,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, WM_SETTINGCHANGE, SMTO_NORMAL,
    };
    
    let device_name_wide: Vec<u16> = device_name.encode_utf16().chain(std::iter::once(0)).collect();
    let icc_path_wide: Vec<u16> = icc_path.encode_utf16().chain(std::iter::once(0)).collect();
    
    // 1. 关联 ICC 配置文件到设备
    unsafe {
        let _ = WcsAssociateColorProfileWithDevice(
            WCS_PROFILE_MANAGEMENT_SCOPE_CURRENT_USER,
            windows::core::PCWSTR(icc_path_wide.as_ptr()),
            windows::core::PCWSTR(device_name_wide.as_ptr()),
        );
    }
    
    // 2. 设置默认 ICC 配置文件（设备特定）
    unsafe {
        let _ = WcsSetDefaultColorProfile(
            WCS_PROFILE_MANAGEMENT_SCOPE_CURRENT_USER,
            windows::core::PCWSTR(device_name_wide.as_ptr()),
            windows::Win32::UI::ColorSystem::COLORPROFILETYPE(1),
            windows::Win32::UI::ColorSystem::COLORPROFILESUBTYPE(0),
            0,
            windows::core::PCWSTR(icc_path_wide.as_ptr()),
        );
    }
    
    // 3. 设置默认 ICC 配置文件（全局）
    unsafe {
        let _ = WcsSetDefaultColorProfile(
            WCS_PROFILE_MANAGEMENT_SCOPE_CURRENT_USER,
            windows::core::PCWSTR(std::ptr::null()),
            windows::Win32::UI::ColorSystem::COLORPROFILETYPE(1),
            windows::Win32::UI::ColorSystem::COLORPROFILESUBTYPE(0),
            0,
            windows::core::PCWSTR(icc_path_wide.as_ptr()),
        );
    }
    
    // 3. 应用显示设置更改
    let mut dev_mode: DEVMODEW = unsafe { std::mem::zeroed() };
    dev_mode.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
    unsafe {
        let _ = EnumDisplaySettingsExW(
            windows::core::PCWSTR(device_name_wide.as_ptr()),
            windows::Win32::Graphics::Gdi::ENUM_DISPLAY_SETTINGS_MODE(0xFFFFFFFF),
            &mut dev_mode,
            EDS_RAWMODE,
        );
        let _ = ChangeDisplaySettingsExW(
            windows::core::PCWSTR(device_name_wide.as_ptr()),
            Some(&dev_mode as *const DEVMODEW),
            None,
            CDS_UPDATEREGISTRY,
            None,
        );
    }
    
    // 6. 广播设置更改
    unsafe {
        let mut result: usize = 0;
        let _ = SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            windows::Win32::Foundation::WPARAM(0),
            windows::Win32::Foundation::LPARAM(0),
            SMTO_NORMAL,
            1000,
            Some(&mut result as *mut usize),
        );
    }
    
    Ok(())
}

#[cfg(not(windows))]
pub fn apply_icc_to_monitor(_device_name: &str, _icc_path: &str) -> AppResult<()> {
    Err(AppError::internal("ICC profile management is only supported on Windows"))
}

#[cfg(windows)]
pub fn restore_default_icc_for_monitor(device_name: &str) -> AppResult<()> {
    use windows::Win32::Graphics::Gdi::{
        CreateDCW, ReleaseDC,
        ChangeDisplaySettingsExW, CDS_UPDATEREGISTRY, DEVMODEW,
        EnumDisplaySettingsExW, EDS_RAWMODE,
    };
    use windows::Win32::UI::ColorSystem::{
        SetICMMode, ICM_OFF,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, WM_SETTINGCHANGE, SMTO_NORMAL,
    };
    
    let device_name_wide: Vec<u16> = device_name.encode_utf16().chain(std::iter::once(0)).collect();
    
    // 1. 获取当前显示设置
    let mut dev_mode: DEVMODEW = unsafe { std::mem::zeroed() };
    dev_mode.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
    
    unsafe {
        let _ = EnumDisplaySettingsExW(
            windows::core::PCWSTR(device_name_wide.as_ptr()),
            windows::Win32::Graphics::Gdi::ENUM_DISPLAY_SETTINGS_MODE(0xFFFFFFFF),
            &mut dev_mode,
            EDS_RAWMODE,
        );
    }
    
    // 2. 关闭 ICM
    unsafe {
        let dc = CreateDCW(
            windows::core::PCWSTR(device_name_wide.as_ptr()),
            windows::core::PCWSTR(device_name_wide.as_ptr()),
            None,
            None,
        );
        
        if !dc.is_invalid() {
            let _ = SetICMMode(dc, ICM_OFF);
            let _ = ReleaseDC(None, dc);
        }
    }
    
    // 3. 应用显示设置更改
    unsafe {
        let _ = ChangeDisplaySettingsExW(
            windows::core::PCWSTR(device_name_wide.as_ptr()),
            Some(&dev_mode as *const DEVMODEW),
            None,
            CDS_UPDATEREGISTRY,
            None,
        );
    }
    
    // 4. 广播设置更改
    unsafe {
        let mut result: usize = 0;
        let _ = SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            windows::Win32::Foundation::WPARAM(0),
            windows::Win32::Foundation::LPARAM(0),
            SMTO_NORMAL,
            1000,
            Some(&mut result as *mut usize),
        );
    }
    
    Ok(())
}

#[cfg(not(windows))]
pub fn restore_default_icc_for_monitor(_device_name: &str) -> AppResult<()> {
    Err(AppError::internal("ICC profile management is only supported on Windows"))
}

#[tauri::command]
pub fn apply_icc_profile(
    state: tauri::State<'_, IccState>,
    profile_id: String,
) -> AppResult<()> {
    let profiles = state.profiles.lock()
        .map_err(|_| AppError::internal("Failed to lock ICC state"))?;
    
    let profile = profiles.iter().find(|p| p.id == profile_id)
        .ok_or_else(|| AppError::not_found("ICC profile not found"))?;
    
    apply_icc_to_monitor(&profile.monitor_name, &profile.icc_path)
}

#[tauri::command]
pub fn restore_default_icc(
    state: tauri::State<'_, IccState>,
    profile_id: String,
) -> AppResult<()> {
    let profiles = state.profiles.lock()
        .map_err(|_| AppError::internal("Failed to lock ICC state"))?;
    
    let profile = profiles.iter().find(|p| p.id == profile_id)
        .ok_or_else(|| AppError::not_found("ICC profile not found"))?;
    
    restore_default_icc_for_monitor(&profile.monitor_name)
}
