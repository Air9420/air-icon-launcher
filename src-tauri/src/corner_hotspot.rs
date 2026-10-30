use crate::error::AppResult;
use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::RwLock;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
#[cfg(not(windows))]
use tauri::{PhysicalPosition, Position};

static CORNER_HOTSPOT_RUNNING: AtomicBool = AtomicBool::new(false);
static CURRENT_CONFIG: Lazy<RwLock<CornerHotspotConfig>> =
    Lazy::new(|| RwLock::new(CornerHotspotConfig::default()));
static CORNER_HOTSPOT_HANDLE: Lazy<RwLock<Option<std::thread::JoinHandle<()>>>> =
    Lazy::new(|| RwLock::new(None));

static LAST_POS_X: AtomicI32 = AtomicI32::new(i32::MIN);
static LAST_POS_Y: AtomicI32 = AtomicI32::new(i32::MIN);

/// 前端在完成路由切换、置好过渡状态后回传的“可以显示了”信号。
/// 显示窗口必须等它，否则窗口会在旧页面内容上先露一帧（闪烁）。
static SHOW_ACK_TX: Lazy<RwLock<Option<std::sync::mpsc::Sender<()>>>> =
    Lazy::new(|| RwLock::new(None));

/// 前端就绪后调用，允许后端把窗口显示出来。
#[tauri::command]
pub fn corner_hotspot_show_ack() {
    if let Ok(mut guard) = SHOW_ACK_TX.write() {
        if let Some(tx) = guard.take() {
            let _ = tx.send(());
        }
    }
}

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
pub fn is_fullscreen_app_running() -> bool {
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
pub fn is_fullscreen_app_running() -> bool {
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

/// 计算窗口在指定角落的目标坐标（物理像素）。
#[cfg(windows)]
fn compute_corner_position(
    window: &tauri::WebviewWindow,
    position: CornerPosition,
    screen: &ScreenInfo,
) -> Option<(i32, i32)> {
    let Ok(size) = window.outer_size() else {
        corner_debug!("[corner_hotspot] compute_corner_position: outer_size failed");
        return None;
    };

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
        "[corner_hotspot] compute_corner_position: target ({}, {})",
        x,
        y
    );
    Some((x, y))
}

#[cfg(windows)]
fn show_window_at_corner(app: &AppHandle, position: CornerPosition, screen: &ScreenInfo) {
    corner_debug!("[corner_hotspot] show_window_at_corner: start");

    let Some(window) = app.get_webview_window("main") else {
        corner_debug!("[corner_hotspot] show_window_at_corner: window not found");
        return;
    };

    // ── 阶段 1：先算出目标位置 ──
    // 注意：窗口隐藏时 Tauri 的 set_position 会被 tao 忽略（窗口不可见时不处理位置变更），
    // 因此这里只计算坐标，真正落位放到显示之后用 SetWindowPos 完成。
    let target = compute_corner_position(&window, position, screen);

    // ── 阶段 2：先通知前端切路由/置好过渡状态，等前端回执后再显示 ──
    // 窗口隐藏时 requestAnimationFrame 不推进，前端若在显示后才置 opacity 会先露一帧旧内容。
    // 因此改为「后端发事件 → 前端切好路由 → 前端 ack → 后端才显示窗口」的握手。
    {
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        if let Ok(mut guard) = SHOW_ACK_TX.write() {
            *guard = Some(tx);
        }
        let _ = app.emit("corner-hotspot-triggered", ());

        // 最多等 120ms：前端来不及也不阻塞唤起，只是退回“显示后由前端补状态”。
        match rx.recv_timeout(Duration::from_millis(120)) {
            Ok(()) => corner_debug!("[corner_hotspot] frontend acked before show"),
            Err(_) => corner_debug!("[corner_hotspot] frontend ack timeout, showing anyway"),
        }
        if let Ok(mut guard) = SHOW_ACK_TX.write() {
            *guard = None;
        }
    }

    // ── 阶段 3+4：在主线程一次性完成「定位 → 显示 → 抢焦点」 ──
    // 定位必须走 SetWindowPos：窗口隐藏时 Tauri 的 set_position 会被忽略。
    // 把定位和显示放在同一轮主线程调用里，避免出现“先显示在旧位置”的中间帧。
    let _ = window.show();
    force_foreground(app, target);

    corner_debug!("[corner_hotspot] show_window_at_corner: done");
}

/// 强制把主窗口切到前台并取得焦点，同时可指定落位坐标。
///
/// `SetForegroundWindow` / `SetFocus` 受 Windows 前台锁限制：调用线程必须与目标窗口
/// 共享输入队列。因此这里通过 `run_on_main_thread` 切到窗口所属线程执行，并在执行
/// 期间把「当前前台线程」附加进来，完成后立即解除附加。
#[cfg(windows)]
fn force_foreground(app: &AppHandle, target: Option<(i32, i32)>) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::Input::KeyboardAndMouse::{SetActiveWindow, SetFocus};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow, SetWindowPos,
        HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    };

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let raw = HWND(hwnd.0 as isize);

    let _ = app.run_on_main_thread(move || unsafe {
        // 先落位：窗口此时已 show()，SetWindowPos 能可靠生效。
        if let Some((x, y)) = target {
            let _ = SetWindowPos(raw, None, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER);
            corner_debug!("[corner_hotspot] force_foreground: moved to ({}, {})", x, y);
        }

        let foreground = GetForegroundWindow();
        let foreground_tid = GetWindowThreadProcessId(foreground, None);
        let current_tid = GetCurrentThreadId();

        corner_debug!(
            "[corner_hotspot] force_foreground: foreground_tid={}, current_tid={}",
            foreground_tid,
            current_tid
        );

        let attached = foreground_tid != 0 && foreground_tid != current_tid;
        if attached {
            let _ = AttachThreadInput(foreground_tid, current_tid, true);
        }

        let _ = SetForegroundWindow(raw);
        let _ = SetActiveWindow(raw);
        let _ = SetFocus(raw);

        // 置顶再回落，确保盖住其他窗口；不带 SWP_SHOWWINDOW，避免多一次重绘。
        let _ = SetWindowPos(raw, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
        let _ = SetWindowPos(raw, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);

        if attached {
            let _ = AttachThreadInput(foreground_tid, current_tid, false);
        }
    });
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
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        let focused = window.is_focused().unwrap_or(false);
        corner_debug!(
            "[corner_hotspot] trigger: visible={}, focused={}",
            visible,
            focused
        );

        if visible && focused {
            // 已经完全唤起，无需处理。
            corner_debug!("[corner_hotspot] trigger: visible and focused, skip");
            return false;
        }

        if visible {
            // 窗口可见但没焦点：抢回焦点，并重新摆到热角位置。
            // 走轻量路径（不切路由、不重新 show），避免页面重置和闪烁。
            if let Some(instant) = *last_trigger {
                if instant.elapsed() < Duration::from_secs(1) {
                    corner_debug!("[corner_hotspot] trigger: refocus within 1s cooldown, skip");
                    return false;
                }
            }
            *last_trigger = Some(Instant::now());

            corner_debug!("[corner_hotspot] trigger: visible but unfocused, refocus + reposition");
            let target = compute_corner_position(&window, position, screen);
            force_foreground(app, target);
            let _ = app.emit("corner-hotspot-shown", ());
            return true;
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
        // 本次“光标停留在角落”是否已处理过，防止停留期间反复唤起。
        let mut corner_handled = false;

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
                // 本次“进入角落”只处理一次：光标一直停在角落不会反复触发。
                // 只有离开角落（下方的 else 分支）才允许下一次唤起。
                if corner_handled {
                    thread::sleep(sleep_duration);
                    continue;
                }

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
                        corner_handled = true;
                    }
                }
            } else {
                in_corner_since = None;
                corner_handled = false;
            }

            thread::sleep(sleep_duration);
        }
    });

    if let Ok(mut handle_guard) = CORNER_HOTSPOT_HANDLE.write() {
        *handle_guard = Some(handle);
    }
}

#[allow(dead_code)]
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
