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

            // 获取监视器名称（第二次调用 EnumDisplayDevicesW）
            let mut monitor_device: DISPLAY_DEVICEW = unsafe { mem::zeroed() };
            monitor_device.cb = mem::size_of::<DISPLAY_DEVICEW>() as u32;

            let mut friendly_name = extract_display_name_from_id(&device_id);

            unsafe {
                let monitor_result = EnumDisplayDevicesW(
                    windows::core::PCWSTR(name.as_ptr() as *const u16),
                    0,
                    &mut monitor_device,
                    0, // 不使用 EDD_GET_DEVICE_INTERFACE_NAME
                );

                if monitor_result.as_bool() {
                    let monitor_string = String::from_utf16_lossy(
                        &monitor_device.DeviceString[..monitor_device.DeviceString.iter().position(|&c| c == 0).unwrap_or(128)]
                    );

                    // 如果获取到了有效的监视器名称（不是适配器名称）
                    if !monitor_string.is_empty() && !monitor_string.contains("Display") {
                        friendly_name = monitor_string;
                    } else {
                        // 尝试从 EDID 获取名称
                        if let Some(edid_name) = get_monitor_name_from_edid(&name) {
                            friendly_name = edid_name;
                        }
                    }
                }
            }

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

#[cfg(windows)]
fn get_monitor_name_from_edid(device_name: &str) -> Option<String> {
    use windows::Win32::System::Registry::{
        RegOpenKeyExW, RegEnumKeyExW, RegQueryValueExW, RegCloseKey,
        HKEY_LOCAL_MACHINE, KEY_READ, HKEY, REG_BINARY, REG_VALUE_TYPE,
    };
    use std::mem;

    // 枚举所有显示器，查找 EDID 中的名称
    let display_key_path: Vec<u16> = "SYSTEM\\CurrentControlSet\\Enum\\DISPLAY"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let mut display_key: HKEY = mem::zeroed();
        let result = RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            windows::core::PCWSTR(display_key_path.as_ptr()),
            0,
            KEY_READ,
            &mut display_key,
        );

        if result.is_err() {
            return None;
        }

        let mut monitor_type_index = 0u32;
        let mut monitor_type_name = [0u16; 256];
        let mut monitor_type_name_len = 256u32;

        while RegEnumKeyExW(
            display_key,
            monitor_type_index,
            windows::core::PWSTR(monitor_type_name.as_mut_ptr()),
            &mut monitor_type_name_len,
            None,
            windows::core::PWSTR::null(),
            None,
            None,
        ).is_ok() {
            let monitor_type = String::from_utf16_lossy(
                &monitor_type_name[..monitor_type_name_len as usize]
            );

            let monitor_type_path = format!(
                "SYSTEM\\CurrentControlSet\\Enum\\DISPLAY\\{}",
                monitor_type
            );
            let monitor_type_path_wide: Vec<u16> = monitor_type_path
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();

            let mut monitor_type_key: HKEY = mem::zeroed();
            if RegOpenKeyExW(
                HKEY_LOCAL_MACHINE,
                windows::core::PCWSTR(monitor_type_path_wide.as_ptr()),
                0,
                KEY_READ,
                &mut monitor_type_key,
            ).is_ok() {
                let mut instance_index = 0u32;
                let mut instance_name = [0u16; 256];
                let mut instance_name_len = 256u32;

                while RegEnumKeyExW(
                    monitor_type_key,
                    instance_index,
                    windows::core::PWSTR(instance_name.as_mut_ptr()),
                    &mut instance_name_len,
                    None,
                    windows::core::PWSTR::null(),
                    None,
                    None,
                ).is_ok() {
                    let instance = String::from_utf16_lossy(
                        &instance_name[..instance_name_len as usize]
                    );

                    let instance_path = format!(
                        "SYSTEM\\CurrentControlSet\\Enum\\DISPLAY\\{}\\{}",
                        monitor_type, instance
                    );
                    let instance_path_wide: Vec<u16> = instance_path
                        .encode_utf16()
                        .chain(std::iter::once(0))
                        .collect();

                    let mut instance_key: HKEY = mem::zeroed();
                    if RegOpenKeyExW(
                        HKEY_LOCAL_MACHINE,
                        windows::core::PCWSTR(instance_path_wide.as_ptr()),
                        0,
                        KEY_READ,
                        &mut instance_key,
                    ).is_ok() {
                        let mut edid_buffer = [0u8; 256];
                        let mut edid_size = edid_buffer.len() as u32;
                        let mut data_type: REG_VALUE_TYPE = REG_VALUE_TYPE(0);
                        
                        let edid_key: Vec<u16> = "EDID".encode_utf16().chain(std::iter::once(0)).collect();
                        
                        let result = RegQueryValueExW(
                            instance_key,
                            windows::core::PCWSTR(edid_key.as_ptr()),
                            None,
                            Some(&mut data_type),
                            Some(edid_buffer.as_mut_ptr()),
                            Some(&mut edid_size),
                        );
                        
                        if result.is_ok() && edid_size >= 128 {
                            for i in 0..4 {
                                let offset = 0x36 + (i * 18);
                                if offset + 18 > edid_size as usize {
                                    break;
                                }

                                if edid_buffer[offset] == 0x00 && edid_buffer[offset + 3] == 0xFC {
                                    let name_bytes = &edid_buffer[offset + 5..offset + 18];
                                    let name = String::from_utf8_lossy(name_bytes);
                                    let name = name.trim_matches('\0').trim();
                                    if !name.is_empty() {
                                        let _ = RegCloseKey(instance_key);
                                        let _ = RegCloseKey(monitor_type_key);
                                        let _ = RegCloseKey(display_key);
                                        return Some(name.to_string());
                                    }
                                }
                            }
                        }

                        let _ = RegCloseKey(instance_key);
                    }

                    instance_index += 1;
                    instance_name = [0u16; 256];
                    instance_name_len = 256;
                }

                let _ = RegCloseKey(monitor_type_key);
            }

            monitor_type_index += 1;
            monitor_type_name = [0u16; 256];
            monitor_type_name_len = 256;
        }

        let _ = RegCloseKey(display_key);
    }

    None
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
    let monitor_name = {
        let mut profiles = state.profiles.lock()
            .map_err(|_| AppError::internal("Failed to lock ICC state"))?;
        
        // 找到当前配置的显示器名称
        let monitor_name = profiles.iter()
            .find(|p| p.id == profile_id)
            .map(|p| p.monitor_name.clone())
            .ok_or_else(|| AppError::not_found("ICC profile not found"))?;
        
        if enabled {
            // 启用时，禁用同一显示器的其他配置
            for profile in profiles.iter_mut() {
                if profile.monitor_name == monitor_name && profile.id != profile_id {
                    profile.enabled = false;
                }
            }
        }
        
        // 设置当前配置的状态
        if let Some(profile) = profiles.iter_mut().find(|p| p.id == profile_id) {
            profile.enabled = enabled;
        }
        
        monitor_name
    };
    
    state.save_profiles_to_config()?;
    
    // 如果是禁用，恢复线性 Gamma Ramp
    if !enabled {
        let _ = restore_default_icc_for_monitor(&monitor_name);
    }
    
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
        CreateDCW, DeleteDC,
    };
    
    // 声明 SetDeviceGammaRamp 函数
    extern "system" {
        fn SetDeviceGammaRamp(hdc: windows::Win32::Graphics::Gdi::HDC, lpRamp: *const u8) -> i32;
    }
    
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
    
    // 2. 设置默认 ICC 配置文件
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
    
    // 3. 读取 ICC 文件的 vcgt 标签并写入显卡 LUT
    match read_vcgt_from_icc(icc_path) {
        Ok(gamma_ramp) => {
            unsafe {
                let hdc = CreateDCW(
                    windows::core::PCWSTR(device_name_wide.as_ptr()),
                    windows::core::PCWSTR(device_name_wide.as_ptr()),
                    None,
                    None,
                );
                
                if !hdc.is_invalid() {
                    let _ = SetDeviceGammaRamp(hdc, gamma_ramp.as_ptr() as *const u8);
                    let _ = DeleteDC(hdc);
                }
            }
        }
        Err(e) => {
            eprintln!("Failed to read VCGT from ICC: {:?}", e);
        }
    }
    
    Ok(())
}

#[cfg(windows)]
fn read_vcgt_from_icc(icc_path: &str) -> AppResult<[[u16; 256]; 3]> {
    use lcms2::{Profile, Tag};
    
    let profile = Profile::new_file(icc_path)
        .map_err(|e| AppError::internal(format!("Failed to open ICC profile: {:?}", e)))?;
    
    let tag = profile.read_tag(lcms2::TagSignature::VcgtTag);
    
    match tag {
        Tag::VcgtCurves(curves) => {
            let mut gamma_ramp: [[u16; 256]; 3] = [[0; 256]; 3];
            
            for (channel, curve) in curves.iter().enumerate() {
                if channel >= 3 { break; }
                for i in 0..256 {
                    let value = curve.eval((i as u16) << 8);
                    gamma_ramp[channel][i] = value;
                }
            }
            
            Ok(gamma_ramp)
        }
        _ => {
            // 如果没有 vcgt 标签，返回线性 Gamma
            let mut gamma_ramp: [[u16; 256]; 3] = [[0; 256]; 3];
            for channel in 0..3 {
                for i in 0..256 {
                    gamma_ramp[channel][i] = (i as u16) << 8;
                }
            }
            Ok(gamma_ramp)
        }
    }
}

#[cfg(not(windows))]
pub fn apply_icc_to_monitor(_device_name: &str, _icc_path: &str) -> AppResult<()> {
    Err(AppError::internal("ICC profile management is only supported on Windows"))
}

#[cfg(windows)]
pub fn restore_default_icc_for_monitor(device_name: &str) -> AppResult<()> {
    use windows::Win32::Graphics::Gdi::{
        CreateDCW, DeleteDC,
    };
    
    // 声明 SetDeviceGammaRamp 函数
    extern "system" {
        fn SetDeviceGammaRamp(hdc: windows::Win32::Graphics::Gdi::HDC, lpRamp: *const u8) -> i32;
    }
    
    let device_name_wide: Vec<u16> = device_name.encode_utf16().chain(std::iter::once(0)).collect();
    
    // 创建线性 Gamma Ramp（恢复默认）
    let mut gamma_ramp: [[u16; 256]; 3] = [[0; 256]; 3];
    for channel in 0..3 {
        for i in 0..256 {
            gamma_ramp[channel][i] = (i as u16) << 8;
        }
    }
    
    // 写入线性 Gamma Ramp
    unsafe {
        let hdc = CreateDCW(
            windows::core::PCWSTR(device_name_wide.as_ptr()),
            windows::core::PCWSTR(device_name_wide.as_ptr()),
            None,
            None,
        );
        
        if !hdc.is_invalid() {
            let _ = SetDeviceGammaRamp(hdc, gamma_ramp.as_ptr() as *const u8);
            let _ = DeleteDC(hdc);
        }
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
