use crate::error::AppResult;
use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::RwLock;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Position};

static CORNER_HOTSPOT_RUNNING: AtomicBool = AtomicBool::new(false);
static CURRENT_CONFIG: Lazy<RwLock<CornerHotspotConfig>> =
    Lazy::new(|| RwLock::new(CornerHotspotConfig::default()));
static CORNER_HOTSPOT_HANDLE: Lazy<RwLock<Option<std::thread::JoinHandle<()>>>> =
    Lazy::new(|| RwLock::new(None));

static LAST_POS_X: AtomicI32 = AtomicI32::new(i32::MIN);
static LAST_POS_Y: AtomicI32 = AtomicI32::new(i32::MIN);

#[cfg(windows)]
const CORNER_HOTSPOT_DEBUG: bool = false;

const MOVEMENT_THRESHOLD: i32 = 5;

#[cfg(windows)]
macro_rules! corner_debug {
    ($($arg:tt)*) => {
        if CORNER_HOTSPOT_DEBUG {
            eprintln!($($arg)*);
        }
    };
}

#[cfg(not(windows))]
macro_rules! corner_debug {
    ($($arg:tt)*) => {};
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum CornerPosition {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl CornerPosition {
    pub fn from_str(s: &str) -> Self {
        match s {
            "top-left" => CornerPosition::TopLeft,
            "top-right" => CornerPosition::TopRight,
            "bottom-left" => CornerPosition::BottomLeft,
            "bottom-right" => CornerPosition::BottomRight,
            _ => CornerPosition::TopRight,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum Sensitivity {
    Low,
    Medium,
    High,
}

impl Sensitivity {
    pub fn from_str(s: &str) -> Self {
        match s {
            "low" => Sensitivity::Low,
            "high" => Sensitivity::High,
            _ => Sensitivity::Medium,
        }
    }

    fn threshold(&self) -> i32 {
        match self {
            Sensitivity::Low => 8,
            Sensitivity::Medium => 16,
            Sensitivity::High => 32,
        }
    }

    fn delay_ms(&self) -> u64 {
        match self {
            Sensitivity::Low => 500,
            Sensitivity::Medium => 350,
            Sensitivity::High => 100,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct CornerHotspotConfig {
    pub enabled: bool,
    pub position: CornerPosition,
    pub sensitivity: Sensitivity,
}

impl Default for CornerHotspotConfig {
    fn default() -> Self {
        CornerHotspotConfig {
            enabled: false,
            position: CornerPosition::TopRight,
            sensitivity: Sensitivity::Medium,
        }
    }
}

#[cfg(windows)]
fn cursor_position() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut p = POINT::default();
    if unsafe { GetCursorPos(&mut p) }.is_ok() {
        Some((p.x, p.y))
    } else {
        None
    }
}

#[cfg(not(windows))]
fn cursor_position() -> Option<(i32, i32)> {
    None
}

#[cfg(windows)]
#[derive(Clone, Debug)]
pub struct ScreenInfo {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[cfg(windows)]
fn get_screen_for_cursor() -> Option<ScreenInfo> {
    use windows::Win32::Foundation::{BOOL, POINT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_FROM_FLAGS,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let mut cursor_pos = POINT::default();
    if unsafe { GetCursorPos(&mut cursor_pos) }.is_err() {
        return None;
    }

    let hmonitor = unsafe { MonitorFromPoint(cursor_pos, MONITOR_FROM_FLAGS(2)) };
    if hmonitor.is_invalid() {
        return None;
    }

    let mut info: MONITORINFO = Default::default();
    info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;

    let result: BOOL = unsafe { GetMonitorInfoW(hmonitor, &mut info) };
    if result.as_bool() {
        let rc = info.rcMonitor;
        return Some(ScreenInfo {
            x: rc.left,
            y: rc.top,
            width: rc.right - rc.left,
            height: rc.bottom - rc.top,
        });
    }

    None
}

#[cfg(not(windows))]
fn get_screen_for_cursor() -> Option<(i32, i32)> {
    None
}

#[cfg(windows)]
#[allow(dead_code)]
fn is_fullscreen_app_running() -> bool {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowRect,
    };

    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0 == 0 {
        return false;
    }

    let class_name = {
        let mut buf = [0u16; 256];
        let len = unsafe { GetClassNameW(hwnd, &mut buf) };
        if len > 0 {
            let name = String::from_utf16_lossy(&buf[..len as usize]);
            name
        } else {
            String::new()
        }
    };

    if class_name == "Progman" || class_name == "WorkerW" || class_name == "Shell_TrayWnd" {
        return false;
    }

    let hmonitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    if hmonitor.is_invalid() {
        return false;
    }

    let mut monitor_info: MONITORINFO = Default::default();
    monitor_info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    if !unsafe { GetMonitorInfoW(hmonitor, &mut monitor_info) }.as_bool() {
        return false;
    }

    let monitor_rect = monitor_info.rcMonitor;

    let mut window_rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut window_rect) }.is_err() {
        return false;
    }

    window_rect.left == monitor_rect.left
        && window_rect.top == monitor_rect.top
        && window_rect.right == monitor_rect.right
        && window_rect.bottom == monitor_rect.bottom
}

#[cfg(not(windows))]
fn is_fullscreen_app_running() -> bool {
    false
}

#[cfg(windows)]
fn is_in_corner(
    x: i32,
    y: i32,
    screen: &ScreenInfo,
    position: CornerPosition,
    threshold: i32,
) -> bool {
    match position {
        CornerPosition::TopLeft => {
            x >= screen.x && x <= screen.x + threshold && y >= screen.y && y <= screen.y + threshold
        }
        CornerPosition::TopRight => {
            x >= screen.x + screen.width - threshold
                && x <= screen.x + screen.width
                && y >= screen.y
                && y <= screen.y + threshold
        }
        CornerPosition::BottomLeft => {
            x >= screen.x
                && x <= screen.x + threshold
                && y >= screen.y + screen.height - threshold
                && y <= screen.y + screen.height
        }
        CornerPosition::BottomRight => {
            x >= screen.x + screen.width - threshold
                && x <= screen.x + screen.width
                && y >= screen.y + screen.height - threshold
                && y <= screen.y + screen.height
        }
    }
}

#[cfg(windows)]
fn moving_towards_corner(dx: i32, dy: i32, position: CornerPosition) -> bool {
    match position {
        CornerPosition::TopLeft => dx < 0 && dy < 0,
        CornerPosition::TopRight => dx > 0 && dy < 0,
        CornerPosition::BottomLeft => dx < 0 && dy > 0,
        CornerPosition::BottomRight => dx > 0 && dy > 0,
    }
}

#[cfg(not(windows))]
fn is_in_corner(
    x: i32,
    y: i32,
    screen_width: i32,
    screen_height: i32,
    position: CornerPosition,
    threshold: i32,
) -> bool {
    match position {
        CornerPosition::TopLeft => x <= threshold && y <= threshold,
        CornerPosition::TopRight => x >= screen_width - threshold && y <= threshold,
        CornerPosition::BottomLeft => x <= threshold && y >= screen_height - threshold,
        CornerPosition::BottomRight => {
            x >= screen_width - threshold && y >= screen_height - threshold
        }
    }
}

#[cfg(windows)]
fn show_window_at_corner(app: &AppHandle, position: CornerPosition, screen: &ScreenInfo) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::Input::KeyboardAndMouse::{SetActiveWindow, SetFocus};
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, SetForegroundWindow, SetWindowPos, ShowWindow, HWND_NOTOPMOST,
        HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_RESTORE,
    };

    corner_debug!("[corner_hotspot] show_window_at_corner: start");

    let Some(window) = app.get_webview_window("main") else {
        corner_debug!("[corner_hotspot] show_window_at_corner: window not found");
        return;
    };

    corner_debug!("[corner_hotspot] show_window_at_corner: calling window.show()");
    let _ = window.show();
    let _ = window.set_focus();

    if let Ok(size) = window.outer_size() {
        let window_w = size.width as i32;
        let window_h = size.height as i32;

        let taskbar_height = window
            .current_monitor()
            .ok()
            .flatten()
            .map(|monitor| {
                let work_area = monitor.work_area();
                let screen_height = monitor.size().height as i32;
                screen_height - work_area.size.height as i32
            })
            .unwrap_or(0);

        let (x, y) = match position {
            CornerPosition::TopLeft => (screen.x, screen.y),
            CornerPosition::TopRight => (screen.x + screen.width - window_w, screen.y),
            CornerPosition::BottomLeft => (
                screen.x,
                screen.y + screen.height - window_h - taskbar_height,
            ),
            CornerPosition::BottomRight => (
                screen.x + screen.width - window_w,
                screen.y + screen.height - window_h - taskbar_height,
            ),
        };

        corner_debug!(
            "[corner_hotspot] show_window_at_corner: setting position to ({}, {})",
            x,
            y
        );
        let _ = window.set_position(Position::Physical(PhysicalPosition::new(x, y)));
    } else {
        corner_debug!("[corner_hotspot] show_window_at_corner: outer_size failed");
    }

    let _ = app.emit("corner-hotspot-triggered", ());

    if let Ok(hwnd) = window.hwnd() {
        let raw = HWND(hwnd.0 as isize);
        corner_debug!("[corner_hotspot] show_window_at_corner: hwnd={:p}", hwnd.0);
        unsafe {
            corner_debug!("[corner_hotspot] show_window_at_corner: calling ShowWindow");
            let _ = ShowWindow(raw, SW_RESTORE);

            let foreground = GetForegroundWindow();
            let foreground_tid = GetWindowThreadProcessId(foreground, None);
            let current_tid = GetCurrentThreadId();
            corner_debug!("[corner_hotspot] show_window_at_corner: foreground={:p}, foreground_tid={}, current_tid={}",
                foreground.0 as *mut std::ffi::c_void, foreground_tid, current_tid);

            if foreground_tid != current_tid && foreground_tid != 0 {
                corner_debug!("[corner_hotspot] show_window_at_corner: using AttachThreadInput");
                let _ = AttachThreadInput(foreground_tid, current_tid, true);
                let _ = SetForegroundWindow(raw);
                let _ = SetActiveWindow(raw);
                let _ = SetFocus(raw);
                let _ = AttachThreadInput(foreground_tid, current_tid, false);
            } else {
                corner_debug!(
                    "[corner_hotspot] show_window_at_corner: using SetForegroundWindow directly"
                );
                let _ = SetForegroundWindow(raw);
                let _ = SetActiveWindow(raw);
                let _ = SetFocus(raw);
            }

            corner_debug!("[corner_hotspot] show_window_at_corner: calling SetWindowPos TOPMOST");
            let _ = SetWindowPos(
                raw,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            );
            corner_debug!("[corner_hotspot] show_window_at_corner: calling SetWindowPos NOTOPMOST");
            let _ = SetWindowPos(
                raw,
                HWND_NOTOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            );
        }
    } else {
        corner_debug!("[corner_hotspot] show_window_at_corner: hwnd failed, using set_focus");
        let _ = window.set_focus();
    }
    corner_debug!("[corner_hotspot] show_window_at_corner: done");
}

#[cfg(not(windows))]
fn show_window_at_corner(app: &AppHandle, position: CornerPosition) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let Ok(size) = window.outer_size() else {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    };

    let Some((screen_w, screen_h)) = get_screen_size() else {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    };

    let window_w = size.width as i32;
    let window_h = size.height as i32;

    let (x, y) = match position {
        CornerPosition::TopLeft => (0, 0),
        CornerPosition::TopRight => (screen_w - window_w, 0),
        CornerPosition::BottomLeft => (0, screen_h - window_h),
        CornerPosition::BottomRight => (screen_w - window_w, screen_h - window_h),
    };

    let _ = window.set_position(Position::Physical(PhysicalPosition::new(x, y)));

    let _ = app.emit("corner-hotspot-triggered", ());

    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg(windows)]
fn trigger_corner_hotspot(
    app: &AppHandle,
    position: CornerPosition,
    screen: &ScreenInfo,
    last_trigger: &mut Option<Instant>,
) -> bool {
    corner_debug!("[corner_hotspot] trigger_corner_hotspot: called");

    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        let focused = window.is_focused().unwrap_or(false);
        corner_debug!(
            "[corner_hotspot] trigger: visible={}, focused={}",
            visible,
            focused
        );

        if visible && focused {
            corner_debug!("[corner_hotspot] trigger: window already visible and focused, skip");
            return false;
        }
    }

    if let Some(instant) = *last_trigger {
        if instant.elapsed() < Duration::from_secs(1) {
            corner_debug!("[corner_hotspot] trigger: within 1s cooldown, skip");
            return false;
        }
    }
    *last_trigger = Some(Instant::now());

    corner_debug!("[corner_hotspot] trigger: calling show_window_at_corner");
    show_window_at_corner(app, position, screen);

    let _ = app.emit("corner-hotspot-shown", ());
    return true;
}

#[cfg(not(windows))]
fn trigger_corner_hotspot(app: &AppHandle, position: CornerPosition) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);

    if visible && focused {
        return;
    }

    show_window_at_corner(app, position);
}

pub fn start_corner_hotspot_monitor(app: AppHandle) {
    corner_debug!("[corner_hotspot] start_corner_hotspot_monitor: called");

    if CORNER_HOTSPOT_RUNNING
        .compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed)
        .is_err()
    {
        corner_debug!("[corner_hotspot] start_corner_hotspot_monitor: already running, returning");
        return;
    }

    {
        let config = CURRENT_CONFIG.read().unwrap();
        if !config.enabled {
            corner_debug!("[corner_hotspot] start_corner_hotspot_monitor: not enabled, returning");
            CORNER_HOTSPOT_RUNNING.store(false, Ordering::Relaxed);
            return;
        }
    }

    corner_debug!("[corner_hotspot] start_corner_hotspot_monitor: starting...");

    let handle = thread::spawn(move || {
        let mut in_corner_since: Option<Instant> = None;
        let mut last_trigger: Option<Instant> = None;
        let mut last_screen: Option<ScreenInfo> = None;

        while CORNER_HOTSPOT_RUNNING.load(Ordering::Relaxed) {
            let config = CURRENT_CONFIG.read().unwrap().clone();
            if !config.enabled {
                thread::sleep(Duration::from_millis(150));
                continue;
            }

            let cursor = match cursor_position() {
                Some(c) => c,
                None => {
                    thread::sleep(Duration::from_millis(150));
                    continue;
                }
            };

            let last_x = LAST_POS_X.load(Ordering::Relaxed);
            let last_y = LAST_POS_Y.load(Ordering::Relaxed);

            if last_x == i32::MIN {
                LAST_POS_X.store(cursor.0, Ordering::Relaxed);
                LAST_POS_Y.store(cursor.1, Ordering::Relaxed);
                thread::sleep(Duration::from_millis(150));
                continue;
            }

            let (dx, dy) = (cursor.0 - last_x, cursor.1 - last_y);
            let distance_sq = dx * dx + dy * dy;

            LAST_POS_X.store(cursor.0, Ordering::Relaxed);
            LAST_POS_Y.store(cursor.1, Ordering::Relaxed);

            let cursor_moved = distance_sq >= MOVEMENT_THRESHOLD * MOVEMENT_THRESHOLD;
            let screen = if cursor_moved {
                get_screen_for_cursor()
            } else {
                last_screen.clone()
            };

            let Some(screen) = screen else {
                thread::sleep(Duration::from_millis(150));
                continue;
            };
            if cursor_moved {
                last_screen = Some(screen.clone());
            }

            let threshold = config.sensitivity.threshold();
            let in_corner = is_in_corner(cursor.0, cursor.1, &screen, config.position, threshold);
            let near_corner =
                is_in_corner(cursor.0, cursor.1, &screen, config.position, threshold * 3);
            let intentional = moving_towards_corner(dx, dy, config.position);

            corner_debug!("[corner_hotspot] cursor=({},{}), in_corner={}, near_corner={}, intentional={}, threshold={}, delay={}ms",
                cursor.0, cursor.1, in_corner, near_corner, intentional, threshold, config.sensitivity.delay_ms());

            let sleep_duration = if in_corner {
                Duration::from_millis(20)
            } else if near_corner {
                Duration::from_millis(50)
            } else {
                Duration::from_millis(150)
            };

            if in_corner {
                let since = in_corner_since.get_or_insert_with(Instant::now);
                let elapsed = since.elapsed().as_millis();
                let delay = Duration::from_millis(config.sensitivity.delay_ms());

                corner_debug!(
                    "[corner_hotspot] in_corner_since elapsed={}ms, delay={}ms",
                    elapsed,
                    delay.as_millis()
                );

                if since.elapsed() >= delay {
                    corner_debug!("[corner_hotspot] delay reached, checking fullscreen...");
                    if is_fullscreen_app_running() {
                        corner_debug!(
                            "[corner_hotspot] loop: fullscreen app running, skip trigger"
                        );
                        in_corner_since = None;
                    } else {
                        corner_debug!("[corner_hotspot] loop: TRIGGER FIRED!");
                        trigger_corner_hotspot(&app, config.position, &screen, &mut last_trigger);
                        in_corner_since = None;
                    }
                }
            } else {
                in_corner_since = None;
            }

            thread::sleep(sleep_duration);
        }
    });

    if let Ok(mut handle_guard) = CORNER_HOTSPOT_HANDLE.write() {
        *handle_guard = Some(handle);
    }
}

pub fn stop_corner_hotspot_monitor() {
    CORNER_HOTSPOT_RUNNING.store(false, Ordering::Relaxed);
    if let Ok(mut handle_guard) = CORNER_HOTSPOT_HANDLE.write() {
        if let Some(handle) = handle_guard.take() {
            drop(handle_guard);
            let _ = handle.join();
        }
    }
}

pub fn update_corner_hotspot_config(
    app: &AppHandle,
    enabled: bool,
    position: &str,
    sensitivity: &str,
) {
    {
        let mut config = CURRENT_CONFIG.write().unwrap();
        config.enabled = enabled;
        config.position = CornerPosition::from_str(position);
        config.sensitivity = Sensitivity::from_str(sensitivity);
    }

    if enabled {
        if !CORNER_HOTSPOT_RUNNING.load(Ordering::Relaxed) {
            corner_debug!("[corner_hotspot] update_corner_hotspot_config: starting monitor");
            start_corner_hotspot_monitor(app.clone());
        }
    }
}

#[tauri::command]
pub fn set_corner_hotspot_config(
    app: AppHandle,
    enabled: bool,
    position: String,
    sensitivity: String,
) -> AppResult<()> {
    update_corner_hotspot_config(&app, enabled, &position, &sensitivity);
    Ok(())
}

#[tauri::command]
pub fn get_corner_hotspot_config() -> AppResult<(bool, String, String)> {
    let config = CURRENT_CONFIG.read().unwrap();
    let position_str = match config.position {
        CornerPosition::TopLeft => "top-left",
        CornerPosition::TopRight => "top-right",
        CornerPosition::BottomLeft => "bottom-left",
        CornerPosition::BottomRight => "bottom-right",
    };
    let sensitivity_str = match config.sensitivity {
        Sensitivity::Low => "low",
        Sensitivity::Medium => "medium",
        Sensitivity::High => "high",
    };
    Ok((
        config.enabled,
        position_str.to_string(),
        sensitivity_str.to_string(),
    ))
}
