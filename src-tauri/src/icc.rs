use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
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

static MONITOR_NAME_CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static ICC_SYSTEM_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static ICC_WCS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static ICC_LATEST_SEQ: AtomicU64 = AtomicU64::new(0);

fn monitor_name_cache() -> &'static Mutex<HashMap<String, String>> {
    MONITOR_NAME_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn refresh_monitor_name_cache(monitors: &[MonitorInfo]) {
    let mut cache = match monitor_name_cache().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    cache.clear();
    for monitor in monitors {
        cache.insert(monitor.friendly_name.clone(), monitor.name.clone());
    }
}

fn system_lock() -> &'static Mutex<()> {
    ICC_SYSTEM_LOCK.get_or_init(|| Mutex::new(()))
}

fn wcs_lock() -> &'static Mutex<()> {
    ICC_WCS_LOCK.get_or_init(|| Mutex::new(()))
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IccOperationTicket {
    pub operation_seq: u64,
}

#[tauri::command]
pub fn begin_icc_operation() -> IccOperationTicket {
    let seq = next_system_operation();
    IccOperationTicket { operation_seq: seq }
}

fn next_system_operation() -> u64 {
    ICC_LATEST_SEQ.fetch_add(1, Ordering::SeqCst) + 1
}

fn is_current_system_operation(seq: u64) -> bool {
    ICC_LATEST_SEQ.load(Ordering::SeqCst) == seq
}

fn superseded_error() -> AppError {
    AppError::new("OPERATION_SUPERSEDED", "A newer ICC operation superseded this one")
}

fn run_system_operation<T, F>(seq: u64, operation: F) -> AppResult<T>
where
    F: FnOnce() -> AppResult<T>,
{
    if !is_current_system_operation(seq) {
        return Err(superseded_error());
    }
    let _guard = match system_lock().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if !is_current_system_operation(seq) {
        return Err(superseded_error());
    }
    operation()
}

fn with_wcs_lock<F, R>(operation: F) -> R
where
    F: FnOnce() -> R,
{
    let _guard = match wcs_lock().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    operation()
}

fn schedule_wcs(seq: u64, device_name: String, icc_path: String) {
    std::thread::spawn(move || {
        if !is_current_system_operation(seq) {
            return;
        }
        with_wcs_lock(|| {
            if !is_current_system_operation(seq) {
                return;
            }
            apply_wcs_background(&device_name, &icc_path);
        });
    });
}

async fn run_blocking<T, F>(operation: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|e| AppError::internal(format!("ICC blocking task failed: {}", e)))?
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
        let mut stored = match self.app_handle.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *stored = Some(handle);
    }

    fn save_profiles_to_config(&self) -> AppResult<()> {
        let profiles = lock_profiles(self).clone();

        let app_handle = match self.app_handle.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        if let Some(handle) = app_handle.as_ref() {
            let config_manager = handle.state::<crate::config::ConfigManager>();
            let mut current_config = config_manager.load_config();
            current_config.icc_profiles = profiles;
            config_manager.save_config(&current_config)
                .map_err(|e| AppError::internal(format!("Failed to save config: {}", e)))?;
        }

        Ok(())
    }
}

fn lock_profiles(state: &IccState) -> MutexGuard<'_, Vec<IccProfile>> {
    match state.profiles.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn snapshot_profiles(state: &IccState) -> Vec<IccProfile> {
    lock_profiles(state).clone()
}

fn clone_app_handle(state: &IccState) -> AppResult<tauri::AppHandle> {
    let stored = match state.app_handle.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    stored
        .clone()
        .ok_or_else(|| AppError::internal("ICC app handle is not initialized"))
}

fn set_profile_enabled(state: &IccState, profile_id: &str, enabled: bool) -> AppResult<String> {
    let mut profiles = lock_profiles(state);
    let monitor_name = profiles
        .iter()
        .find(|p| p.id == profile_id)
        .map(|p| p.monitor_name.clone())
        .ok_or_else(|| AppError::not_found("ICC profile not found"))?;

    if enabled {
        for profile in profiles.iter_mut() {
            if profile.monitor_name == monitor_name && profile.id != profile_id {
                profile.enabled = false;
            }
        }
    }

    if let Some(profile) = profiles.iter_mut().find(|p| p.id == profile_id) {
        profile.enabled = enabled;
    }

    Ok(monitor_name)
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
            
            // 2. 获取监视器信息（第二次调用 EnumDisplayDevicesW，遍历所有监视器）
            let mut friendly_name: Option<String> = None;
            let mut fallback_string: Option<String> = None;
            let name_wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
            
            unsafe {
                // 遍历所有监视器（通常只有一个，但可能有多个）
                for monitor_index in 0..4 {
                    let mut monitor_device: DISPLAY_DEVICEW = mem::zeroed();
                    monitor_device.cb = mem::size_of::<DISPLAY_DEVICEW>() as u32;
                    
                    let success = EnumDisplayDevicesW(
                        windows::core::PCWSTR(name_wide.as_ptr()),
                        monitor_index,
                        &mut monitor_device,
                        0,
                    );

                    if !success.as_bool() {
                        break;
                    }

                    let monitor_state = monitor_device.StateFlags;
                    let monitor_attached = (monitor_state & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP) != 0;
                    
                    let dev_string = String::from_utf16_lossy(
                        &monitor_device.DeviceString[..monitor_device.DeviceString.iter().position(|&c| c == 0).unwrap_or(128)]
                    );
                    let dev_id = String::from_utf16_lossy(
                        &monitor_device.DeviceID[..monitor_device.DeviceID.iter().position(|&c| c == 0).unwrap_or(128)]
                    );

                    if fallback_string.is_none() && !dev_string.is_empty() {
                        fallback_string = Some(dev_string.clone());
                    }

                    if monitor_attached {
                        // 3. 从 DeviceID 提取型号
                        if let Some(model) = extract_model_from_device_id(&dev_id) {
                            if let Some(reg_monitor) = registry_monitors.iter().find(|m| m.model == model) {
                                friendly_name = Some(reg_monitor.name.clone());
                                break;
                            }
                        }
                    }
                }
            }

            // 5. 降级：如果注册表查不到，再用 DeviceString
            let monitor_name = friendly_name.unwrap_or_else(|| {
                let monitor_string = fallback_string.unwrap_or_default();
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

    refresh_monitor_name_cache(&monitors);
    Ok(monitors)
}

#[cfg(not(windows))]
pub fn get_connected_monitors() -> AppResult<Vec<MonitorInfo>> {
    let monitors = vec![MonitorInfo {
        name: "Display 1".to_string(),
        friendly_name: "Display 1".to_string(),
        device_id: String::new(),
        is_primary: true,
    }];
    refresh_monitor_name_cache(&monitors);
    Ok(monitors)
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
pub async fn get_monitors() -> AppResult<Vec<MonitorInfo>> {
    run_blocking(get_connected_monitors).await
}

#[tauri::command]
pub async fn get_icc_profiles(state: tauri::State<'_, IccState>) -> AppResult<Vec<IccProfile>> {
    let handle = clone_app_handle(&state)?;
    run_blocking(move || {
        handle
            .try_state::<IccState>()
            .map(|icc| snapshot_profiles(&icc))
            .ok_or_else(|| AppError::internal("ICC state is not managed"))
    })
    .await
}

#[tauri::command]
pub async fn add_icc_profile(
    state: tauri::State<'_, IccState>,
    profile: IccProfile,
) -> AppResult<()> {
    let handle = clone_app_handle(&state)?;
    run_blocking(move || {
        let icc = handle
            .try_state::<IccState>()
            .ok_or_else(|| AppError::internal("ICC state is not managed"))?;
        {
            let mut profiles = lock_profiles(&icc);
            if profiles.iter().any(|p| p.id == profile.id) {
                return Err(AppError::invalid_input("Profile with this ID already exists"));
            }
            profiles.push(profile);
        }
        icc.save_profiles_to_config()
    })
    .await
}

#[tauri::command]
pub async fn remove_icc_profile(
    state: tauri::State<'_, IccState>,
    profile_id: String,
) -> AppResult<()> {
    let handle = clone_app_handle(&state)?;
    run_blocking(move || {
        let icc = handle
            .try_state::<IccState>()
            .ok_or_else(|| AppError::internal("ICC state is not managed"))?;
        {
            let mut profiles = lock_profiles(&icc);
            profiles.retain(|p| p.id != profile_id);
        }
        icc.save_profiles_to_config()
    })
    .await
}

#[tauri::command]
pub async fn toggle_icc_profile(
    state: tauri::State<'_, IccState>,
    profile_id: String,
    enabled: bool,
    operation_seq: Option<u64>,
) -> AppResult<()> {
    let handle = clone_app_handle(&state)?;
    let seq = operation_seq.unwrap_or_else(next_system_operation);
    run_blocking(move || {
        let icc = handle
            .try_state::<IccState>()
            .ok_or_else(|| AppError::internal("ICC state is not managed"))?;
        run_system_operation(seq, || {
            set_profile_enabled(&icc, &profile_id, enabled)?;
            icc.save_profiles_to_config()?;
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn select_icc_file() -> AppResult<Option<String>> {
    run_blocking(|| {
        let dialog = rfd::FileDialog::new()
            .add_filter("ICC Profile", &["icc", "icm"])
            .set_title("Select ICC Profile");
        Ok(dialog.pick_file().map(|p| p.to_string_lossy().to_string()))
    })
    .await
}

#[tauri::command]
pub async fn get_system_icc_profiles() -> AppResult<Vec<String>> {
    run_blocking(get_system_icc_profiles_blocking).await
}

fn get_system_icc_profiles_blocking() -> AppResult<Vec<String>> {
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
    
    // 根据 friendlyName 查找 Windows 设备名称
    let win_device_name = find_device_name_by_friendly_name(device_name)
        .unwrap_or_else(|| device_name.to_string());
    
    // 声明 SetDeviceGammaRamp 函数
    extern "system" {
        fn SetDeviceGammaRamp(hdc: windows::Win32::Graphics::Gdi::HDC, lpRamp: *const u8) -> i32;
    }
    
    let device_name_wide: Vec<u16> = win_device_name.encode_utf16().chain(std::iter::once(0)).collect();
    
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

/// 原子启用：LUT → 状态落盘 → 后台 WCS 调度，全在同一张操作票内完成。
///
/// 拆成 `toggle` + `apply` 两次 IPC 会留下“配置已改、屏幕没变”的窗口，
/// 并且第二次调用失败时磁盘状态无法回滚，因此启用/禁用必须各用一条命令。
#[tauri::command]
pub async fn activate_icc_profile(
    state: tauri::State<'_, IccState>,
    profile_id: String,
    operation_seq: Option<u64>,
) -> AppResult<()> {
    let handle = clone_app_handle(&state)?;
    let seq = operation_seq.unwrap_or_else(next_system_operation);
    run_blocking(move || {
        let icc = handle
            .try_state::<IccState>()
            .ok_or_else(|| AppError::internal("ICC state is not managed"))?;
        run_system_operation(seq, || {
            let snapshot = snapshot_profiles(&icc);
            let (monitor_name, icc_path) = {
                let profile = snapshot
                    .iter()
                    .find(|p| p.id == profile_id)
                    .ok_or_else(|| AppError::not_found("ICC profile not found"))?;
                (profile.monitor_name.clone(), profile.icc_path.clone())
            };

            // 先写 LUT：失败时内存与磁盘状态都保持不变，不会留下“已启用但屏幕没变”。
            with_wcs_lock(|| apply_lut_only(&monitor_name, &icc_path))?;

            if !is_current_system_operation(seq) {
                return Err(superseded_error());
            }

            let committed = (|| -> AppResult<()> {
                set_profile_enabled(&icc, &profile_id, true)?;
                icc.save_profiles_to_config()
            })();
            if let Err(e) = committed {
                *lock_profiles(&icc) = snapshot;
                return Err(e);
            }

            schedule_wcs(seq, monitor_name, icc_path);
            Ok(())
        })
    })
    .await
}

/// 原子禁用：先恢复线性 Gamma Ramp，再落盘状态。
///
/// 顺序与 `activate_icc_profile` 一致——副作用在前、状态提交在后，
/// 这样任一步失败时磁盘状态都停留在原值，前端回滚快照即可保持一致。
#[tauri::command]
pub async fn deactivate_icc_profile(
    state: tauri::State<'_, IccState>,
    profile_id: String,
    operation_seq: Option<u64>,
) -> AppResult<()> {
    let handle = clone_app_handle(&state)?;
    let seq = operation_seq.unwrap_or_else(next_system_operation);
    run_blocking(move || {
        let icc = handle
            .try_state::<IccState>()
            .ok_or_else(|| AppError::internal("ICC state is not managed"))?;
        run_system_operation(seq, || {
            let snapshot = snapshot_profiles(&icc);
            let monitor_name = snapshot
                .iter()
                .find(|p| p.id == profile_id)
                .map(|p| p.monitor_name.clone())
                .ok_or_else(|| AppError::not_found("ICC profile not found"))?;

            with_wcs_lock(|| restore_default_icc_for_monitor(&monitor_name))?;

            if !is_current_system_operation(seq) {
                return Err(superseded_error());
            }

            let committed = (|| -> AppResult<()> {
                set_profile_enabled(&icc, &profile_id, false)?;
                icc.save_profiles_to_config()
            })();
            if let Err(e) = committed {
                *lock_profiles(&icc) = snapshot;
                return Err(e);
            }

            Ok(())
        })
    })
    .await
}

/// 底层原语：写 LUT 并调度后台 WCS，但不改配置启用状态。
/// 设置页已改用 `activate_icc_profile`，此命令保留给需要单独刷新 LUT 的调用方。
#[tauri::command]
pub async fn apply_icc_profile(
    state: tauri::State<'_, IccState>,
    profile_id: String,
    operation_seq: Option<u64>,
) -> AppResult<()> {
    let handle = clone_app_handle(&state)?;
    let seq = operation_seq.unwrap_or_else(next_system_operation);
    run_blocking(move || {
        let icc = handle
            .try_state::<IccState>()
            .ok_or_else(|| AppError::internal("ICC state is not managed"))?;
        run_system_operation(seq, || {
            let (monitor_name, icc_path) = {
                let profiles = snapshot_profiles(&icc);
                let profile = profiles.iter().find(|p| p.id == profile_id)
                    .ok_or_else(|| AppError::not_found("ICC profile not found"))?;
                (profile.monitor_name.clone(), profile.icc_path.clone())
            };

            // LUT 与 WCS 共用系统操作锁，旧请求不再排队覆盖新请求。
            let result = with_wcs_lock(|| apply_lut_only(&monitor_name, &icc_path));
            if result.is_ok() {
                schedule_wcs(seq, monitor_name, icc_path);
            }
            result
        })
    })
    .await
}

#[tauri::command]
pub async fn apply_icc_lut_only(
    state: tauri::State<'_, IccState>,
    profile_id: String,
    operation_seq: Option<u64>,
) -> AppResult<()> {
    let handle = clone_app_handle(&state)?;
    let seq = operation_seq.unwrap_or_else(next_system_operation);
    run_blocking(move || {
        let icc = handle
            .try_state::<IccState>()
            .ok_or_else(|| AppError::internal("ICC state is not managed"))?;
        run_system_operation(seq, || {
            let (monitor_name, icc_path) = {
                let profiles = snapshot_profiles(&icc);
                let profile = profiles.iter().find(|p| p.id == profile_id)
                    .ok_or_else(|| AppError::not_found("ICC profile not found"))?;
                (profile.monitor_name.clone(), profile.icc_path.clone())
            };
            with_wcs_lock(|| apply_lut_only(&monitor_name, &icc_path))
        })
    })
    .await
}

/// 根据 friendlyName 查找对应的 Windows 设备名称。
/// 优先使用 `get_monitors` 刷新过的缓存，避免每次应用 LUT 都做完整枚举。
fn find_device_name_by_friendly_name(friendly_name: &str) -> Option<String> {
    let cache = match monitor_name_cache().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(device_name) = cache.get(friendly_name) {
        return Some(device_name.clone());
    }
    drop(cache);

    let monitors = get_connected_monitors().ok()?;
    monitors.iter()
        .find(|m| m.friendly_name == friendly_name)
        .map(|m| m.name.clone())
}

#[cfg(windows)]
fn apply_lut_only(device_name: &str, icc_path: &str) -> AppResult<()> {
    use windows::Win32::Graphics::Gdi::{CreateDCW, DeleteDC};
    
    // 根据 friendlyName 查找 Windows 设备名称
    let win_device_name = find_device_name_by_friendly_name(device_name)
        .unwrap_or_else(|| device_name.to_string());
    
    extern "system" {
        fn SetDeviceGammaRamp(hdc: windows::Win32::Graphics::Gdi::HDC, lpRamp: *const u8) -> i32;
    }
    
    let device_name_wide: Vec<u16> = win_device_name.encode_utf16().chain(std::iter::once(0)).collect();
    
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
                    let _ = SetDeviceGammaRamp(hdc, gamma_ramp.as_ptr() as *const u8);
                    let _ = DeleteDC(hdc);
                }
            }
        }
        Err(e) => {
            return Err(AppError::internal(format!("Failed to read VCGT: {:?}", e)));
        }
    }
    
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
    
    // 根据 friendlyName 查找 Windows 设备名称
    let win_device_name = find_device_name_by_friendly_name(device_name)
        .unwrap_or_else(|| device_name.to_string());
    
    let device_name_wide: Vec<u16> = win_device_name.encode_utf16().chain(std::iter::once(0)).collect();
    let icc_path_wide: Vec<u16> = icc_path.encode_utf16().chain(std::iter::once(0)).collect();
    
    // 1. 关联 ICC 到设备
    unsafe {
        let _ = WcsAssociateColorProfileWithDevice(
            WCS_PROFILE_MANAGEMENT_SCOPE_CURRENT_USER,
            windows::core::PCWSTR(icc_path_wide.as_ptr()),
            windows::core::PCWSTR(device_name_wide.as_ptr()),
        );
    }
    
    // 2. 设置默认配置
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
}

#[cfg(not(windows))]
fn apply_wcs_background(_device_name: &str, _icc_path: &str) {
    // 非 Windows 平台不做任何操作
}

/// 预热 WCS 服务（后台执行，避免第一次调用时的延迟）
#[tauri::command]
pub fn warmup_wcs() {
    std::thread::spawn(|| {
        with_wcs_lock(|| {
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
        });
    });
}

#[tauri::command]
pub async fn restore_default_icc(
    state: tauri::State<'_, IccState>,
    profile_id: String,
    operation_seq: Option<u64>,
) -> AppResult<()> {
    let handle = clone_app_handle(&state)?;
    let seq = operation_seq.unwrap_or_else(next_system_operation);
    run_blocking(move || {
        let icc = handle
            .try_state::<IccState>()
            .ok_or_else(|| AppError::internal("ICC state is not managed"))?;
        run_system_operation(seq, || {
            let monitor_name = {
                let profiles = snapshot_profiles(&icc);
                profiles
                    .iter()
                    .find(|p| p.id == profile_id)
                    .map(|p| p.monitor_name.clone())
                    .ok_or_else(|| AppError::not_found("ICC profile not found"))?
            };
            if !is_current_system_operation(seq) {
                return Err(superseded_error());
            }
            with_wcs_lock(|| restore_default_icc_for_monitor(&monitor_name))
        })
    })
    .await
}
