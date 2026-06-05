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

    // 1. 先从注册表获取所有显示器的 EDID 名称（通过型号匹配）
    let registry_monitors = get_all_monitors_from_registry();

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
            
            // 2. 获取监视器信息（第二次调用 EnumDisplayDevicesW）
            let mut monitor_device: DISPLAY_DEVICEW = unsafe { mem::zeroed() };
            monitor_device.cb = mem::size_of::<DISPLAY_DEVICEW>() as u32;
            
            let mut friendly_name: Option<String> = None;

            unsafe {
                let name_wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
                let success = EnumDisplayDevicesW(
                    windows::core::PCWSTR(name_wide.as_ptr()),
                    0,
                    &mut monitor_device,
                    0,
                );

                if success.as_bool() {
                    // 3. 从 DeviceID 提取型号（如 "STD0001"、"GSM59F1"）
                    let monitor_id_str = String::from_utf16_lossy(
                        &monitor_device.DeviceID[..monitor_device.DeviceID.iter().position(|&c| c == 0).unwrap_or(128)]
                    );
                    
                    if let Some(model) = extract_model_from_device_id(&monitor_id_str) {
                        // 4. 在注册表中查找匹配的显示器
                        if let Some(reg_monitor) = registry_monitors.iter().find(|m| m.model == model) {
                            friendly_name = Some(reg_monitor.name.clone());
                        }
                    }
                }
            }

            // 5. 降级：如果注册表查不到，再用 DeviceString
            let monitor_name = friendly_name.unwrap_or_else(|| {
                let monitor_string = String::from_utf16_lossy(
                    &monitor_device.DeviceString[..monitor_device.DeviceString.iter().position(|&c| c == 0).unwrap_or(128)]
                );
                if !monitor_string.is_empty() && !monitor_string.contains("Display") {
                    monitor_string
                } else {
                    extract_display_name_from_id(&device_id)
                }
            });

            monitors.push(MonitorInfo {
                name: name.trim().to_string(),
                friendly_name: monitor_name.trim().to_string(),
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

/// 从 EDID 二进制数据解析显示器名称（tag 0xFC = Monitor Name Descriptor）
fn parse_edid_monitor_name(edid: &[u8]) -> Option<String> {
    if edid.len() < 128 {
        return None;
    }
    // EDID 基础块偏移 54-125 包含 4 个 18 字节描述符
    for i in 0..4 {
        let offset = 54 + i * 18;
        if offset + 18 > edid.len() {
            break;
        }
        // 描述符前两字节为 00 00 表示是描述符（非 timing）
        if edid[offset] == 0x00 && edid[offset + 1] == 0x00 {
            let tag = edid[offset + 3];
            if tag == 0xFC {
                // Monitor Name Descriptor: 字节 5..17 为 ASCII 名称，0A 结尾，20 填充
                let name_bytes = &edid[offset + 5..offset + 18];
                let name: String = name_bytes
                    .iter()
                    .take_while(|&&b| b != 0x0A && b != 0x00)
                    .map(|&b| b as char)
                    .collect();
                let name = name.trim();
                if !name.is_empty() {
                    return Some(name.to_string());
                }
            }
        }
    }
    None
}

/// 从 DeviceID 提取显示器型号
/// DeviceID 格式: "MONITOR\GSM59F1\{GUID}\instance"
fn extract_model_from_device_id(device_id: &str) -> Option<String> {
    let parts: Vec<&str> = device_id.split('\\').collect();
    if parts.len() >= 2 && (parts[0] == "MONITOR" || parts[0] == "DISPLAY") {
        Some(parts[1].to_string())
    } else {
        None
    }
}

/// 从注册表获取所有显示器的 EDID 名称
#[cfg(windows)]
fn get_all_monitors_from_registry() -> Vec<RegistryMonitor> {
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_LOCAL_MACHINE,
        KEY_READ,
    };

    let mut monitors = Vec::new();

    let display_path: Vec<u16> = "SYSTEM\\CurrentControlSet\\Enum\\DISPLAY"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let mut display_hkey: HKEY = std::mem::zeroed();
        if RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            windows::core::PCWSTR(display_path.as_ptr()),
            0,
            KEY_READ,
            &mut display_hkey,
        )
        .is_err()
        {
            return monitors;
        }

        let mut model_index = 0u32;
        let mut model_buf = [0u16; 256];

        loop {
            let mut model_len = model_buf.len() as u32;
            let result = RegEnumKeyExW(
                display_hkey,
                model_index,
                windows::core::PWSTR(model_buf.as_mut_ptr()),
                &mut model_len,
                None,
                windows::core::PWSTR::null(),
                None,
                None,
            );
            model_index += 1;

            if result.is_err() || model_index > 32 {
                break;
            }

            let model_name = String::from_utf16_lossy(&model_buf[..model_len as usize]);
            if model_name == "Default_Monitor" {
                continue;
            }

            let mut model_hkey: HKEY = std::mem::zeroed();
            if RegOpenKeyExW(
                display_hkey,
                windows::core::PCWSTR(model_buf.as_ptr()),
                0,
                KEY_READ,
                &mut model_hkey,
            )
            .is_err()
            {
                continue;
            }

            let mut instance_index = 0u32;
            let mut instance_buf = [0u16; 256];

            loop {
                let mut instance_len = instance_buf.len() as u32;
                let res = RegEnumKeyExW(
                    model_hkey,
                    instance_index,
                    windows::core::PWSTR(instance_buf.as_mut_ptr()),
                    &mut instance_len,
                    None,
                    windows::core::PWSTR::null(),
                    None,
                    None,
                );
                instance_index += 1;

                if res.is_err() || instance_index > 16 {
                    break;
                }

                let instance_name = String::from_utf16_lossy(&instance_buf[..instance_len as usize]);
                let full_path = format!(
                    "SYSTEM\\CurrentControlSet\\Enum\\DISPLAY\\{}\\{}",
                    model_name, instance_name
                );

                let full_path_wide: Vec<u16> =
                    full_path.encode_utf16().chain(std::iter::once(0)).collect();

                let mut inst_hkey: HKEY = std::mem::zeroed();
                if RegOpenKeyExW(
                    HKEY_LOCAL_MACHINE,
                    windows::core::PCWSTR(full_path_wide.as_ptr()),
                    0,
                    KEY_READ,
                    &mut inst_hkey,
                )
                .is_err()
                {
                    continue;
                }

                let dp_subkey: Vec<u16> = "Device Parameters"
                    .encode_utf16()
                    .chain(std::iter::once(0))
                    .collect();
                let mut dp_hkey: HKEY = std::mem::zeroed();

                if RegOpenKeyExW(
                    inst_hkey,
                    windows::core::PCWSTR(dp_subkey.as_ptr()),
                    0,
                    KEY_READ,
                    &mut dp_hkey,
                )
                .is_ok()
                {
                    let edid_key_name: Vec<u16> =
                        "EDID".encode_utf16().chain(std::iter::once(0)).collect();
                    let mut edid_buf = [0u8; 256];
                    let mut edid_size = edid_buf.len() as u32;

                    if RegQueryValueExW(
                        dp_hkey,
                        windows::core::PCWSTR(edid_key_name.as_ptr()),
                        None,
                        None,
                        Some(edid_buf.as_mut_ptr()),
                        Some(&mut edid_size),
                    )
                    .is_ok()
                    {
                        if let Some(name) =
                            parse_edid_monitor_name(&edid_buf[..edid_size as usize])
                        {
                            monitors.push(RegistryMonitor {
                                model: model_name.clone(),
                                name,
                            });
                        }
                    }
                    let _ = RegCloseKey(dp_hkey);
                }

                let _ = RegCloseKey(inst_hkey);
            }

            let _ = RegCloseKey(model_hkey);
        }

        let _ = RegCloseKey(display_hkey);
    }

    monitors
}

#[cfg(windows)]
struct RegistryMonitor {
    model: String,
    name: String,
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
    let start = std::time::Instant::now();
    eprintln!("[ICC] toggle_icc_profile 开始: id={}, enabled={}", profile_id, enabled);
    
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
    
    let t1 = start.elapsed();
    state.save_profiles_to_config()?;
    let t2 = start.elapsed();
    eprintln!("[ICC] toggle_icc_profile 锁+保存完成: {}ms (锁:{}ms, 保存:{}ms)", 
        t2.as_millis(), t1.as_millis(), (t2 - t1).as_millis());
    
    // 如果是禁用，恢复线性 Gamma Ramp
    if !enabled {
        let t3 = std::time::Instant::now();
        let _ = restore_default_icc_for_monitor(&monitor_name);
        eprintln!("[ICC] restore_default_icc_for_monitor 完成: {}ms", t3.elapsed().as_millis());
    }
    
    eprintln!("[ICC] toggle_icc_profile 总耗时: {}ms", start.elapsed().as_millis());
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
    let start = std::time::Instant::now();
    eprintln!("[ICC] apply_icc_profile 开始: id={}", profile_id);
    
    let (monitor_name, icc_path) = {
        let profiles = state.profiles.lock()
            .map_err(|_| AppError::internal("Failed to lock ICC state"))?;
        
        let profile = profiles.iter().find(|p| p.id == profile_id)
            .ok_or_else(|| AppError::not_found("ICC profile not found"))?;
        
        (profile.monitor_name.clone(), profile.icc_path.clone())
    };
    
    let t1 = start.elapsed();
    eprintln!("[ICC] apply_icc_profile 锁完成: {}ms", t1.as_millis());
    
    // 1. 立即执行 LUT 更新（1ms，用户立即看到效果）
    let result = apply_lut_only(&monitor_name, &icc_path);
    
    // 2. 后台执行 WCS 系统配置（不阻塞前端）
    let monitor = monitor_name.clone();
    let icc = icc_path.clone();
    std::thread::spawn(move || {
        apply_wcs_background(&monitor, &icc);
    });
    
    eprintln!("[ICC] apply_icc_profile 总耗时: {}ms", start.elapsed().as_millis());
    result
}

#[tauri::command]
pub fn apply_icc_lut_only(
    state: tauri::State<'_, IccState>,
    profile_id: String,
) -> AppResult<()> {
    let start = std::time::Instant::now();
    eprintln!("[ICC] apply_icc_lut_only 开始: id={}", profile_id);
    
    let profiles = state.profiles.lock()
        .map_err(|_| AppError::internal("Failed to lock ICC state"))?;
    
    let profile = profiles.iter().find(|p| p.id == profile_id)
        .ok_or_else(|| AppError::not_found("ICC profile not found"))?;
    
    // 只执行 LUT 更新，跳过 Associate
    let result = apply_lut_only(&profile.monitor_name, &profile.icc_path);
    
    eprintln!("[ICC] apply_icc_lut_only 总耗时: {}ms", start.elapsed().as_millis());
    result
}

#[cfg(windows)]
fn apply_lut_only(device_name: &str, icc_path: &str) -> AppResult<()> {
    use windows::Win32::Graphics::Gdi::{CreateDCW, DeleteDC};
    
    let start = std::time::Instant::now();
    eprintln!("[ICC] apply_lut_only 开始: device={}", device_name);
    
    extern "system" {
        fn SetDeviceGammaRamp(hdc: windows::Win32::Graphics::Gdi::HDC, lpRamp: *const u8) -> i32;
    }
    
    let device_name_wide: Vec<u16> = device_name.encode_utf16().chain(std::iter::once(0)).collect();
    
    // 只读取 vcgt 并写入 LUT
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
                    let result = SetDeviceGammaRamp(hdc, gamma_ramp.as_ptr() as *const u8);
                    let _ = DeleteDC(hdc);
                    eprintln!("[ICC] apply_lut_only SetDeviceGammaRamp: {}ms, result={}", 
                        start.elapsed().as_millis(), result);
                }
            }
        }
        Err(e) => {
            eprintln!("[ICC] apply_lut_only read_vcgt 失败: {:?}", e);
            return Err(AppError::internal(format!("Failed to read VCGT: {:?}", e)));
        }
    }
    
    eprintln!("[ICC] apply_lut_only 总耗时: {}ms", start.elapsed().as_millis());
    Ok(())
}

#[cfg(not(windows))]
fn apply_lut_only(_device_name: &str, _icc_path: &str) -> AppResult<()> {
    Err(AppError::internal("ICC profile management is only supported on Windows"))
}

/// 后台执行 WCS 系统配置（不阻塞前端）
#[cfg(windows)]
fn apply_wcs_background(device_name: &str, icc_path: &str) {
    use windows::Win32::UI::ColorSystem::{
        WcsSetDefaultColorProfile, WCS_PROFILE_MANAGEMENT_SCOPE_CURRENT_USER,
        WcsAssociateColorProfileWithDevice,
    };
    
    let start = std::time::Instant::now();
    eprintln!("[ICC] apply_wcs_background 开始: device={}", device_name);
    
    let device_name_wide: Vec<u16> = device_name.encode_utf16().chain(std::iter::once(0)).collect();
    let icc_path_wide: Vec<u16> = icc_path.encode_utf16().chain(std::iter::once(0)).collect();
    
    // 1. 关联 ICC 到设备
    let t1 = std::time::Instant::now();
    unsafe {
        let _ = WcsAssociateColorProfileWithDevice(
            WCS_PROFILE_MANAGEMENT_SCOPE_CURRENT_USER,
            windows::core::PCWSTR(icc_path_wide.as_ptr()),
            windows::core::PCWSTR(device_name_wide.as_ptr()),
        );
    }
    eprintln!("[ICC] WcsAssociateColorProfileWithDevice: {}ms", t1.elapsed().as_millis());
    
    // 2. 设置默认配置
    let t2 = std::time::Instant::now();
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
    eprintln!("[ICC] WcsSetDefaultColorProfile: {}ms", t2.elapsed().as_millis());
    
    eprintln!("[ICC] apply_wcs_background 总耗时: {}ms", start.elapsed().as_millis());
}

#[cfg(not(windows))]
fn apply_wcs_background(_device_name: &str, _icc_path: &str) {
    // 非 Windows 平台不做任何操作
}

/// 预热 WCS 服务（后台执行，避免第一次调用时的 1.7 秒延迟）
#[tauri::command]
pub fn warmup_wcs() {
    eprintln!("[ICC] warmup_wcs 开始（后台执行）");
    
    std::thread::spawn(|| {
        let start = std::time::Instant::now();
        
        #[cfg(windows)]
        {
            use windows::Win32::UI::ColorSystem::{
                WcsAssociateColorProfileWithDevice, WCS_PROFILE_MANAGEMENT_SCOPE_CURRENT_USER,
            };
            
            // 使用系统自带的 sRGB 配置触发 WCS 初始化
            let dummy_icc = "C:\\Windows\\System32\\spool\\drivers\\color\\sRGB Color Space Profile.icm";
            let dummy_device = "\\\\.\\DISPLAY1";
            
            let icc_wide: Vec<u16> = dummy_icc.encode_utf16().chain(std::iter::once(0)).collect();
            let device_wide: Vec<u16> = dummy_device.encode_utf16().chain(std::iter::once(0)).collect();
            
            unsafe {
                let _ = WcsAssociateColorProfileWithDevice(
                    WCS_PROFILE_MANAGEMENT_SCOPE_CURRENT_USER,
                    windows::core::PCWSTR(icc_wide.as_ptr()),
                    windows::core::PCWSTR(device_wide.as_ptr()),
                );
            }
        }
        
        eprintln!("[ICC] warmup_wcs 完成: {}ms", start.elapsed().as_millis());
    });
}

#[tauri::command]
pub fn restore_default_icc(
    state: tauri::State<'_, IccState>,
    profile_id: String,
) -> AppResult<()> {
    let start = std::time::Instant::now();
    eprintln!("[ICC] restore_default_icc 开始: id={}", profile_id);
    
    let profiles = state.profiles.lock()
        .map_err(|_| AppError::internal("Failed to lock ICC state"))?;
    
    let profile = profiles.iter().find(|p| p.id == profile_id)
        .ok_or_else(|| AppError::not_found("ICC profile not found"))?;
    
    let t1 = start.elapsed();
    eprintln!("[ICC] restore_default_icc 锁完成: {}ms", t1.as_millis());
    
    let result = restore_default_icc_for_monitor(&profile.monitor_name);
    
    eprintln!("[ICC] restore_default_icc 总耗时: {}ms", start.elapsed().as_millis());
    result
}
