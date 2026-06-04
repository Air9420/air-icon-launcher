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

        // 只显示已连接到桌面且不是镜像驱动的显示器
        if is_attached && !is_mirror {
            let name = String::from_utf16_lossy(
                &display_device.DeviceName[..display_device.DeviceName.iter().position(|&c| c == 0).unwrap_or(32)]
            );
            let device_id = String::from_utf16_lossy(
                &display_device.DeviceID[..display_device.DeviceID.iter().position(|&c| c == 0).unwrap_or(128)]
            );
            
            // 获取设备字符串（通常是显卡名称）
            let device_string = String::from_utf16_lossy(
                &display_device.DeviceString[..display_device.DeviceString.iter().position(|&c| c == 0).unwrap_or(128)]
            );
            
            // 使用设备字符串作为友好名称
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
    // Common vendor IDs
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

#[cfg(windows)]
pub fn apply_icc_to_monitor(device_name: &str, icc_path: &str) -> AppResult<()> {
    use windows::Win32::System::Registry::{
        RegOpenKeyExW, RegSetValueExW, RegCloseKey, RegCreateKeyExW,
        HKEY_CURRENT_USER, KEY_WRITE, KEY_READ, REG_DWORD, REG_SZ, REG_MULTI_SZ,
        HKEY, REG_OPTION_NON_VOLATILE,
    };
    use windows::Win32::Graphics::Gdi::{
        ChangeDisplaySettingsExW, CDS_UPDATEREGISTRY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, WM_SETTINGCHANGE, SMTO_NORMAL,
    };
    use std::path::Path;
    
    // 获取 ICC 文件名
    let icc_filename = Path::new(icc_path)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("profile.icc");
    
    // 获取显示器的注册表路径
    let reg_paths = get_monitor_registry_paths(device_name)?;
    
    // 为每个显示器设置 ICC 配置
    for reg_path in reg_paths {
        // 为每个显示器序号创建注册表项（0000, 0001, 0002...）
        for i in 0..8 {
            let subkey = format!("{}\\{:04}", reg_path, i);
            let subkey_wide: Vec<u16> = subkey.encode_utf16().chain(std::iter::once(0)).collect();
            
            unsafe {
                let mut hkey: HKEY = std::mem::zeroed();
                let result = RegCreateKeyExW(
                    HKEY_CURRENT_USER,
                    windows::core::PCWSTR(subkey_wide.as_ptr()),
                    0,
                    None,
                    REG_OPTION_NON_VOLATILE,
                    KEY_WRITE | KEY_READ,
                    None,
                    &mut hkey,
                    None,
                );
                
                if result.is_ok() {
                    // 设置 UsePerUserProfiles = 1（启用用户 ICC 设置）
                    let use_per_user: u32 = 1;
                    let value_name: Vec<u16> = "UsePerUserProfiles".encode_utf16().chain(std::iter::once(0)).collect();
                    let _ = RegSetValueExW(
                        hkey,
                        windows::core::PCWSTR(value_name.as_ptr()),
                        0,
                        REG_DWORD,
                        Some(&use_per_user.to_ne_bytes()),
                    );
                    
                    // 设置 ICMProfile = ICC 文件名（REG_MULTI_SZ 格式）
                    let value_name: Vec<u16> = "ICMProfile".encode_utf16().chain(std::iter::once(0)).collect();
                    let icc_name_wide: Vec<u16> = icc_filename.encode_utf16().chain(std::iter::once(0)).collect();
                    // REG_MULTI_SZ 需要以两个 null 结尾
                    let mut multi_sz_data = icc_name_wide.clone();
                    multi_sz_data.push(0); // 额外的 null 结尾
                    let _ = RegSetValueExW(
                        hkey,
                        windows::core::PCWSTR(value_name.as_ptr()),
                        0,
                        REG_MULTI_SZ,
                        Some(unsafe { std::slice::from_raw_parts(multi_sz_data.as_ptr() as *const u8, multi_sz_data.len() * 2) }),
                    );
                    
                    let _ = RegCloseKey(hkey);
                }
            }
        }
    }
    
    // 应用显示设置更改
    let device_name_wide: Vec<u16> = device_name.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let _ = ChangeDisplaySettingsExW(
            windows::core::PCWSTR(device_name_wide.as_ptr()),
            None,
            None,
            CDS_UPDATEREGISTRY,
            None,
        );
    }
    
    // 广播设置更改消息
    unsafe {
        let mut result = 0usize;
        let _ = SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            None,
            None,
            SMTO_NORMAL,
            1000,
            Some(&mut result as *mut usize),
        );
    }
    
    Ok(())
}

#[cfg(windows)]
fn get_monitor_registry_paths(device_name: &str) -> AppResult<Vec<String>> {
    use windows::Win32::Graphics::Gdi::{DISPLAY_DEVICEW, EnumDisplayDevicesW};
    use std::mem;
    
    let mut paths = Vec::new();
    
    // 枚举显示器设备，找到匹配的设备
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
        
        let name = String::from_utf16_lossy(
            &display_device.DeviceName[..display_device.DeviceName.iter().position(|&c| c == 0).unwrap_or(32)]
        );
        
        if name.trim() == device_name {
            // 获取适配器GUID（从 DeviceID 中提取）
            let device_id = String::from_utf16_lossy(
                &display_device.DeviceID[..display_device.DeviceID.iter().position(|&c| c == 0).unwrap_or(128)]
            );
            
            // 提取适配器GUID部分（如 {4d36e96e-e325-11ce-bfc1-08002be10318}）
            if let Some(start) = device_id.find('{') {
                if let Some(end) = device_id.find('}') {
                    let adapter_guid = &device_id[start..=end];
                    let reg_path = format!(
                        "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ICM\\ProfileAssociations\\Display\\{}",
                        adapter_guid
                    );
                    paths.push(reg_path);
                }
            }
        }
        
        device_index += 1;
        if device_index > 32 {
            break;
        }
    }
    
    if paths.is_empty() {
        return Err(AppError::internal("Device not found"));
    }
    
    Ok(paths)
}

#[cfg(windows)]
fn get_device_id_from_name(device_name: &str) -> AppResult<String> {
    use windows::Win32::Graphics::Gdi::{DISPLAY_DEVICEW, EnumDisplayDevicesW};
    use std::mem;
    
    // 枚举显示器设备，找到匹配的设备
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
        
        let name = String::from_utf16_lossy(
            &display_device.DeviceName[..display_device.DeviceName.iter().position(|&c| c == 0).unwrap_or(32)]
        );
        
        if name.trim() == device_name {
            let device_id = String::from_utf16_lossy(
                &display_device.DeviceID[..display_device.DeviceID.iter().position(|&c| c == 0).unwrap_or(128)]
            );
            return Ok(device_id);
        }
        
        device_index += 1;
        if device_index > 32 {
            break;
        }
    }
    
    Err(AppError::internal("Device not found"))
}

#[cfg(windows)]
fn get_system_color_dir() -> AppResult<std::path::PathBuf> {
    use windows::Win32::UI::Shell::{SHGetFolderPathW, CSIDL_SYSTEM};
    
    let mut path_buf = [0u16; 260];
    unsafe {
        if SHGetFolderPathW(None, CSIDL_SYSTEM as i32, None, 0, &mut path_buf).is_ok() {
            let system_path = String::from_utf16_lossy(
                &path_buf[..path_buf.iter().position(|&c| c == 0).unwrap_or(260)]
            );
            Ok(std::path::PathBuf::from(system_path).join("spool").join("drivers").join("color"))
        } else {
            Err(AppError::internal("Failed to get system color directory"))
        }
    }
}

#[cfg(not(windows))]
pub fn apply_icc_to_monitor(_device_name: &str, _icc_path: &str) -> AppResult<()> {
    Err(AppError::internal("ICC profile management is only supported on Windows"))
}

#[cfg(windows)]
pub fn restore_default_icc_for_monitor(device_name: &str) -> AppResult<()> {
    use windows::Win32::System::Registry::{
        RegOpenKeyExW, RegSetValueExW, RegCloseKey,
        HKEY_CURRENT_USER, KEY_WRITE, REG_DWORD,
        HKEY,
    };
    use windows::Win32::Graphics::Gdi::{
        ChangeDisplaySettingsExW, CDS_UPDATEREGISTRY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, WM_SETTINGCHANGE, SMTO_NORMAL,
    };
    
    // 获取显示器的注册表路径
    let reg_paths = get_monitor_registry_paths(device_name)?;
    
    // 为每个显示器设置 ICC 配置
    for reg_path in reg_paths {
        // 为每个显示器序号创建注册表项（0000, 0001, 0002...）
        for i in 0..8 {
            let subkey = format!("{}\\{:04}", reg_path, i);
            let subkey_wide: Vec<u16> = subkey.encode_utf16().chain(std::iter::once(0)).collect();
            
            unsafe {
                let mut hkey: HKEY = std::mem::zeroed();
                let result = RegOpenKeyExW(
                    HKEY_CURRENT_USER,
                    windows::core::PCWSTR(subkey_wide.as_ptr()),
                    0,
                    KEY_WRITE,
                    &mut hkey,
                );
                
                if result.is_ok() {
                    // 设置 UsePerUserProfiles = 0（禁用用户 ICC 设置）
                    let use_per_user: u32 = 0;
                    let value_name: Vec<u16> = "UsePerUserProfiles".encode_utf16().chain(std::iter::once(0)).collect();
                    let _ = RegSetValueExW(
                        hkey,
                        windows::core::PCWSTR(value_name.as_ptr()),
                        0,
                        REG_DWORD,
                        Some(&use_per_user.to_ne_bytes()),
                    );
                    
                    let _ = RegCloseKey(hkey);
                }
            }
        }
    }
    
    // 应用显示设置更改
    let device_name_wide: Vec<u16> = device_name.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let _ = ChangeDisplaySettingsExW(
            windows::core::PCWSTR(device_name_wide.as_ptr()),
            None,
            None,
            CDS_UPDATEREGISTRY,
            None,
        );
    }
    
    // 广播设置更改消息
    unsafe {
        let mut result = 0usize;
        let _ = SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            None,
            None,
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
