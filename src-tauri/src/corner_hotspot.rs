use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Position, PhysicalPosition};
use tauri::window::{EffectsBuilder, Effect, Color};
use once_cell::sync::Lazy;
use crate::error::AppResult;

static CORNER_HOTSPOT_RUNNING: AtomicBool = AtomicBool::new(false);

static CURRENT_CONFIG: Lazy<Arc<Mutex<CornerHotspotConfig>>> = Lazy::new(|| {
    Arc::new(Mutex::new(CornerHotspotConfig::default()))
});

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
            Sensitivity::Low => 4,
            Sensitivity::Medium => 8,
            Sensitivity::High => 16,
        }
    }

    fn delay_ms(&self) -> u64 {
        match self {
            Sensitivity::Low => 500,
            Sensitivity::Medium => 350,
            Sensitivity::High => 200,
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
fn get_screen_size() -> Option<(i32, i32)> {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
    let width = unsafe { GetSystemMetrics(SM_CXSCREEN) };
    let height = unsafe { GetSystemMetrics(SM_CYSCREEN) };
    if width > 0 && height > 0 {
        Some((width, height))
    } else {
        None
    }
}

#[cfg(not(windows))]
fn get_screen_size() -> Option<(i32, i32)> {
    None
}

#[cfg(windows)]
fn is_fullscreen_app_running() -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect, GetDesktopWindow};
    use windows::Win32::Foundation::RECT;
    
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0 == 0 {
        return false;
    }
    
    let desktop = unsafe { GetDesktopWindow() };
    if hwnd == desktop {
        return false;
    }
    
    let mut rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        return false;
    }
    
    let window_width = rect.right - rect.left;
    let window_height = rect.bottom - rect.top;
    
    if let Some((screen_w, screen_h)) = get_screen_size() {
        window_width >= screen_w && window_height >= screen_h
    } else {
        false
    }
}

#[cfg(not(windows))]
fn is_fullscreen_app_running() -> bool {
    false
}

fn is_in_corner(x: i32, y: i32, screen_width: i32, screen_height: i32, position: CornerPosition, threshold: i32) -> bool {
    match position {
        CornerPosition::TopLeft => x <= threshold && y <= threshold,
        CornerPosition::TopRight => x >= screen_width - threshold && y <= threshold,
        CornerPosition::BottomLeft => x <= threshold && y >= screen_height - threshold,
        CornerPosition::BottomRight => x >= screen_width - threshold && y >= screen_height - threshold,
    }
}

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
    
    let _ = window.set_effects(None);
    let effects = EffectsBuilder::new()
        .effects(vec![Effect::Acrylic])
        .color(Color(0, 0, 0, 0))
        .build();
    let _ = window.set_effects(Some(effects));
    
    let _ = window.show();
    let _ = window.set_focus();
}

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
    if CORNER_HOTSPOT_RUNNING.load(Ordering::SeqCst) {
        return;
    }

    let config = {
        let cfg = CURRENT_CONFIG.lock().unwrap();
        cfg.clone()
    };

    if !config.enabled {
        return;
    }

    CORNER_HOTSPOT_RUNNING.store(true, Ordering::SeqCst);

    thread::spawn(move || {
        let mut in_corner_since: Option<Instant> = None;
        let mut last_triggered: Option<Instant> = None;
        let cooldown = Duration::from_secs(1);

        while CORNER_HOTSPOT_RUNNING.load(Ordering::SeqCst) {
            let config = {
                let cfg = CURRENT_CONFIG.lock().unwrap();
                cfg.clone()
            };

            if !config.enabled {
                thread::sleep(Duration::from_millis(100));
                continue;
            }

            if is_fullscreen_app_running() {
                in_corner_since = None;
                thread::sleep(Duration::from_millis(100));
                continue;
            }

            if let (Some((x, y)), Some((screen_w, screen_h))) = (cursor_position(), get_screen_size()) {
                let threshold = config.sensitivity.threshold();
                let delay = Duration::from_millis(config.sensitivity.delay_ms());

                let in_corner = is_in_corner(x, y, screen_w, screen_h, config.position, threshold);

                if in_corner {
                    if let Some(since) = in_corner_since {
                        if since.elapsed() >= delay {
                            if let Some(last) = last_triggered {
                                if last.elapsed() < cooldown {
                                    continue;
                                }
                            }

                            trigger_corner_hotspot(&app, config.position);
                            last_triggered = Some(Instant::now());
                            in_corner_since = None;
                        }
                    } else {
                        in_corner_since = Some(Instant::now());
                    }
                } else {
                    in_corner_since = None;
                }
            } else {
                in_corner_since = None;
            }

            thread::sleep(Duration::from_millis(50));
        }
    });
}

pub fn stop_corner_hotspot_monitor() {
    CORNER_HOTSPOT_RUNNING.store(false, Ordering::SeqCst);
}

pub fn update_corner_hotspot_config(app: &AppHandle, enabled: bool, position: &str, sensitivity: &str) {
    let mut config = CURRENT_CONFIG.lock().unwrap();
    config.enabled = enabled;
    config.position = CornerPosition::from_str(position);
    config.sensitivity = Sensitivity::from_str(sensitivity);
    drop(config);

    if enabled {
        if !CORNER_HOTSPOT_RUNNING.load(Ordering::SeqCst) {
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
    let config = CURRENT_CONFIG.lock().unwrap();
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
    Ok((config.enabled, position_str.to_string(), sensitivity_str.to_string()))
}
