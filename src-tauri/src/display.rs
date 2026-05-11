use crate::error::{AppError, AppResult};

#[cfg(windows)]
use windows::Win32::Devices::Display::{
    GetDisplayConfigBufferSizes, QueryDisplayConfig, SetDisplayConfig, DISPLAYCONFIG_MODE_INFO,
    DISPLAYCONFIG_PATH_INFO, DISPLAYCONFIG_TOPOLOGY_CLONE, DISPLAYCONFIG_TOPOLOGY_EXTEND,
    DISPLAYCONFIG_TOPOLOGY_EXTERNAL, DISPLAYCONFIG_TOPOLOGY_ID, DISPLAYCONFIG_TOPOLOGY_INTERNAL,
    QDC_DATABASE_CURRENT, SDC_APPLY, SDC_TOPOLOGY_EXTEND, SDC_TOPOLOGY_INTERNAL,
};
#[cfg(windows)]
use windows::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS, WIN32_ERROR};
#[cfg(windows)]
use windows::Win32::Graphics::Gdi::{DISPLAY_DEVICEW, EnumDisplayDevicesW};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisplayTopology {
    Internal,
    Extend,
    Clone,
    External,
    Unknown(i32),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisplayMode {
    Internal,
    Extend,
}

impl DisplayMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Internal => "internal",
            Self::Extend => "extend",
        }
    }
}

impl DisplayTopology {
    #[cfg(windows)]
    fn from_win32_topology_id(id: DISPLAYCONFIG_TOPOLOGY_ID) -> Self {
        match id.0 {
            value if value == DISPLAYCONFIG_TOPOLOGY_INTERNAL.0 => Self::Internal,
            value if value == DISPLAYCONFIG_TOPOLOGY_EXTEND.0 => Self::Extend,
            value if value == DISPLAYCONFIG_TOPOLOGY_CLONE.0 => Self::Clone,
            value if value == DISPLAYCONFIG_TOPOLOGY_EXTERNAL.0 => Self::External,
            value => Self::Unknown(value),
        }
    }

    fn paired_mode(self) -> DisplayMode {
        match self {
            Self::Internal => DisplayMode::Internal,
            Self::Extend | Self::Clone | Self::External | Self::Unknown(_) => DisplayMode::Extend,
        }
    }

    fn next_mode_for_toggle(self) -> DisplayMode {
        match self {
            Self::Internal => DisplayMode::Extend,
            Self::Extend | Self::Clone | Self::External | Self::Unknown(_) => DisplayMode::Internal,
        }
    }
}

#[cfg(windows)]
fn ensure_win32_success(status: WIN32_ERROR, operation: &str) -> AppResult<()> {
    if status == ERROR_SUCCESS {
        return Ok(());
    }

    Err(AppError::internal(format!(
        "{} failed with Win32 error {}",
        operation, status.0
    )))
}

#[cfg(windows)]
fn ensure_set_display_success(status: i32, operation: &str) -> AppResult<()> {
    if status == ERROR_SUCCESS.0 as i32 {
        return Ok(());
    }

    Err(AppError::internal(format!(
        "{} failed with Win32 error {}",
        operation, status
    )))
}

#[cfg(windows)]
fn get_display_topology() -> AppResult<DisplayTopology> {
    for _attempt in 0..2 {
        let mut num_paths = 0u32;
        let mut num_modes = 0u32;

        let size_status = unsafe {
            GetDisplayConfigBufferSizes(QDC_DATABASE_CURRENT, &mut num_paths, &mut num_modes)
        };
        ensure_win32_success(size_status, "GetDisplayConfigBufferSizes")?;

        let mut path_buffer: Vec<DISPLAYCONFIG_PATH_INFO> = Vec::with_capacity(num_paths as usize);
        path_buffer.resize_with(num_paths as usize, || unsafe { std::mem::zeroed() });

        let mut mode_buffer: Vec<DISPLAYCONFIG_MODE_INFO> = Vec::with_capacity(num_modes as usize);
        mode_buffer.resize_with(num_modes as usize, || unsafe { std::mem::zeroed() });

        let mut topology_id = DISPLAYCONFIG_TOPOLOGY_ID(0);
        let query_status = unsafe {
            QueryDisplayConfig(
                QDC_DATABASE_CURRENT,
                &mut num_paths,
                path_buffer.as_mut_ptr(),
                &mut num_modes,
                mode_buffer.as_mut_ptr(),
                Some(&mut topology_id as *mut _),
            )
        };

        if query_status == ERROR_INSUFFICIENT_BUFFER {
            continue;
        }

        ensure_win32_success(query_status, "QueryDisplayConfig")?;
        return Ok(DisplayTopology::from_win32_topology_id(topology_id));
    }

    Err(AppError::internal(
        "QueryDisplayConfig returned ERROR_INSUFFICIENT_BUFFER repeatedly",
    ))
}

#[cfg(not(windows))]
fn get_display_topology() -> AppResult<DisplayTopology> {
    Err(AppError::internal(
        "Display mode switching is only supported on Windows",
    ))
}

#[cfg(windows)]
fn set_display_mode_internal(mode: DisplayMode) -> AppResult<()> {
    let flags = match mode {
        DisplayMode::Internal => SDC_APPLY | SDC_TOPOLOGY_INTERNAL,
        DisplayMode::Extend => SDC_APPLY | SDC_TOPOLOGY_EXTEND,
    };

    let status = unsafe { SetDisplayConfig(None, None, flags) };
    ensure_set_display_success(status, "SetDisplayConfig")
}

#[cfg(not(windows))]
fn set_display_mode_internal(_mode: DisplayMode) -> AppResult<()> {
    Err(AppError::internal(
        "Display mode switching is only supported on Windows",
    ))
}

#[tauri::command]
pub fn get_current_display_mode() -> AppResult<String> {
    Ok(get_display_topology()?.paired_mode().as_str().to_string())
}

pub(crate) fn get_display_count_internal() -> AppResult<u32> {
    let count = get_display_path_count()?;
    Ok(count.max(1))
}

#[cfg(windows)]
fn get_display_path_count() -> AppResult<u32> {
    let mut display_device: DISPLAY_DEVICEW = unsafe { std::mem::zeroed() };
    display_device.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;

    let mut count = 0u32;
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

        if !is_disconnected {
            count += 1;
        }

        device_index += 1;

        if device_index > 16 {
            break;
        }
    }

    if count == 0 {
        count = 1;
    }

    Ok(count)
}

#[tauri::command]
pub fn get_display_count() -> AppResult<u32> {
    get_display_count_internal()
}

#[tauri::command]
pub fn set_display_mode(mode: String) -> AppResult<()> {
    match mode.trim() {
        "internal" => set_display_mode_internal(DisplayMode::Internal),
        "extend" => set_display_mode_internal(DisplayMode::Extend),
        other => Err(AppError::invalid_input(format!(
            "Invalid display mode: {}",
            other
        ))),
    }
}

#[tauri::command]
pub fn toggle_display_mode() -> AppResult<String> {
    let next_mode = get_display_topology()?.next_mode_for_toggle();
    set_display_mode_internal(next_mode)?;
    Ok(next_mode.as_str().to_string())
}

#[cfg(test)]
mod tests {
    use super::{DisplayMode, DisplayTopology};

    #[test]
    fn keeps_internal_and_extend_as_pair_modes() {
        assert_eq!(
            DisplayTopology::Internal.paired_mode(),
            DisplayMode::Internal
        );
        assert_eq!(DisplayTopology::Extend.paired_mode(), DisplayMode::Extend);
    }

    #[test]
    fn treats_non_internal_topologies_as_extend_side_for_status() {
        assert_eq!(DisplayTopology::Clone.paired_mode(), DisplayMode::Extend);
        assert_eq!(DisplayTopology::External.paired_mode(), DisplayMode::Extend);
        assert_eq!(
            DisplayTopology::Unknown(99).paired_mode(),
            DisplayMode::Extend
        );
    }

    #[test]
    fn toggles_back_to_internal_from_non_internal_topologies() {
        assert_eq!(
            DisplayTopology::Internal.next_mode_for_toggle(),
            DisplayMode::Extend
        );
        assert_eq!(
            DisplayTopology::Extend.next_mode_for_toggle(),
            DisplayMode::Internal
        );
        assert_eq!(
            DisplayTopology::Clone.next_mode_for_toggle(),
            DisplayMode::Internal
        );
        assert_eq!(
            DisplayTopology::External.next_mode_for_toggle(),
            DisplayMode::Internal
        );
        assert_eq!(
            DisplayTopology::Unknown(-1).next_mode_for_toggle(),
            DisplayMode::Internal
        );
    }
}
