//! 全屏判定：采集卡抓的是整块显示器，无法按窗口排除，
//! 所以隐私保护的判据是「前台窗口是否独占一整块显示器」。
//!
//! 判定为全屏 → 画面可以直出；
//! 判定为非全屏（桌面、窗口化程序、任务栏可见）→ 通知 OBS 虚化。
//!
//! 判定顺序（任一不满足即视为非全屏）：
//! 1. 前台窗口存在且可见、未最小化
//! 2. 不是桌面 / 任务栏 / 输入法候选等 shell 窗口
//! 3. 无标题栏或标题栏被推出屏外（真全屏 / 无边框全屏）
//! 4. 窗口矩形覆盖所属显示器的整个区域（容差 2 px）

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::audio::LogFn;

#[derive(Debug, Clone)]
pub struct PrivacyConfig {
    pub enabled: bool,
    /// 轮询周期（ms）
    pub poll_ms: u64,
    /// 状态稳定多久才下发（ms），避免切换瞬间抖动
    pub debounce_ms: u64,
    /// 额外视为「安全全屏」的进程名（小写、不含 .exe 也可），逗号分隔
    pub allowlist: String,
    /// 启动时先按虚化处理（保守）
    pub fail_safe: bool,
}

impl Default for PrivacyConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            poll_ms: 200,
            debounce_ms: 500,
            allowlist: "obs64,obs32".into(),
            fail_safe: true,
        }
    }
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct ForegroundInfo {
    pub title: String,
    pub class: String,
    pub process: String,
    pub fullscreen: bool,
    /// 窗口尺寸与显示器尺寸，便于排查判定偏差
    pub window_rect: [i32; 4],
    pub monitor_rect: [i32; 4],
    pub borderless: bool,
}

#[cfg(windows)]
mod imp {
    use super::ForegroundInfo;
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowLongW, GetWindowRect, GetWindowThreadProcessId,
        IsIconic, IsWindowVisible, GWL_STYLE, WS_CAPTION, WS_THICKFRAME,
    };
    use windows::core::PWSTR;

    /// shell 窗口类名：这些「铺满屏幕」的东西不算全屏。
    ///
    /// 前三个与宿主 `corner_hotspot.rs::is_fullscreen_app_running()` 完全一致，
    /// 后面几个是 OBS 场景下额外要排除的（输入法候选、XAML 岛等）。
    const SHELL_CLASSES: &[&str] = &[
        // 与宿主一致的三项
        "Progman",
        "WorkerW",
        "Shell_TrayWnd",
        // 补充：其他会占满屏幕但不是「应用全屏」的窗口
        "Shell_SecondaryTrayWnd",
        "Windows.UI.Core.CoreWindow",
        "ApplicationFrameWindow",
        "MultitaskingViewFrame",
        "ForegroundStaging",
        "XamlExplorerHostIslandWindow",
        "SysShadow",
        "IME",
        "MSCTFIME UI",
        "Default IME",
    ];

    fn class_name(hwnd: HWND) -> String {
        let mut buf = [0u16; 256];
        let n = unsafe { GetClassNameW(hwnd, &mut buf) };
        if n <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..n as usize])
    }

    fn window_title(hwnd: HWND) -> String {
        use windows::Win32::UI::WindowsAndMessaging::{GetWindowTextW, GetWindowTextLengthW};
        let len = unsafe { GetWindowTextLengthW(hwnd) };
        if len <= 0 {
            return String::new();
        }
        let mut buf = vec![0u16; len as usize + 1];
        let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
        if n <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..n as usize])
    }

    fn process_name(hwnd: HWND) -> String {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid == 0 {
            return String::new();
        }
        let handle = match unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) } {
            Ok(h) => h,
            Err(_) => return String::new(),
        };
        let mut buf = [0u16; 1024];
        let mut size = buf.len() as u32;
        let ok = unsafe {
            QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_FORMAT(0),
                PWSTR(buf.as_mut_ptr()),
                &mut size,
            )
        };
        let _ = unsafe { windows::Win32::Foundation::CloseHandle(handle) };
        if ok.is_err() || size == 0 {
            return String::new();
        }
        let full = String::from_utf16_lossy(&buf[..size as usize]);
        full.rsplit(['\\', '/'])
            .next()
            .unwrap_or(&full)
            .to_ascii_lowercase()
    }

    fn rect_of(hwnd: HWND) -> Option<RECT> {
        let mut r = RECT::default();
        unsafe { GetWindowRect(hwnd, &mut r) }.ok()?;
        Some(r)
    }

    fn monitor_rect(hwnd: HWND) -> Option<RECT> {
        let mon = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
        if mon.is_invalid() {
            return None;
        }
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if unsafe { GetMonitorInfoW(mon, &mut info) }.as_bool() {
            Some(info.rcMonitor)
        } else {
            None
        }
    }

    /// 判定前台窗口是否独占其所属显示器。
    pub fn probe() -> ForegroundInfo {
        let mut out = ForegroundInfo::default();
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.is_invalid() {
            return out;
        }
        if !unsafe { IsWindowVisible(hwnd) }.as_bool() || unsafe { IsIconic(hwnd) }.as_bool() {
            return out;
        }

        out.class = class_name(hwnd);
        out.title = window_title(hwnd);
        out.process = process_name(hwnd);

        if SHELL_CLASSES.iter().any(|c| out.class.eq_ignore_ascii_case(c)) {
            return out;
        }

        let (Some(wr), Some(mr)) = (rect_of(hwnd), monitor_rect(hwnd)) else {
            return out;
        };
        out.window_rect = [wr.left, wr.top, wr.right, wr.bottom];
        out.monitor_rect = [mr.left, mr.top, mr.right, mr.bottom];

        let style = unsafe { GetWindowLongW(hwnd, GWL_STYLE) } as u32;
        let has_caption = style & (WS_CAPTION.0 | WS_THICKFRAME.0) != 0;
        out.borderless = !has_caption;

        // 判定与宿主 `corner_hotspot.rs::is_fullscreen_app_running()` 保持一致：
        // **窗口矩形与显示器矩形四个边完全相等**才算全屏。
        //
        // 宿主那套已经在线上跑（全屏时注销全局快捷键），不需要容差：
        //   - 真全屏（无边框游戏 / 全屏视频）GetWindowRect 正好等于显示器矩形
        //   - 最大化窗口是 [-8,-8,1928,1048]，与 [0,0,1920,1080] 不等 → 正确排除
        //
        // 之前我用 16px 容差 + 「是否覆盖」的判断，反而更容易误伤：
        // 任务栏自动隐藏时，最大化窗口的底边会顶到 1080，就骗过容差被判成全屏，
        // 结果浏览器最大化时反而不虚化，等于把桌面暴露出去。
        //
        // 改这里必须同步改宿主那份，两处语义要保持一致。
        out.fullscreen = wr.left == mr.left
            && wr.top == mr.top
            && wr.right == mr.right
            && wr.bottom == mr.bottom;
        out
    }
}

#[cfg(not(windows))]
mod imp {
    use super::ForegroundInfo;
    pub fn probe() -> ForegroundInfo {
        ForegroundInfo::default()
    }
}

pub fn probe_foreground() -> ForegroundInfo {
    imp::probe()
}

/// 全屏判定的稳定器：只有状态持续 `debounce_ms` 才认为生效。
pub struct FullscreenWatcher {
    cfg: PrivacyConfig,
    /// 最近一次稳定下来的「全屏」状态
    stable_fullscreen: bool,
    /// 正在观察的候选状态与其起始时刻
    pending: Option<(bool, std::time::Instant)>,
    last_info: ForegroundInfo,
}

impl FullscreenWatcher {
    pub fn new(cfg: PrivacyConfig) -> Self {
        Self {
            // fail_safe：启动时先当作「非全屏」→ 虚化，等首次探测再放开
            stable_fullscreen: !cfg.fail_safe,
            cfg,
            pending: None,
            last_info: ForegroundInfo::default(),
        }
    }

    fn allowlisted(&self, process: &str) -> bool {
        let p = process.to_ascii_lowercase();
        let p = p.trim_end_matches(".exe");
        self.cfg
            .allowlist
            .split(',')
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty())
            .any(|s| s.trim_end_matches(".exe") == p)
    }

    /// 采样一次，返回 `Some(should_blur)` 表示状态发生了变化。
    pub fn poll(&mut self) -> Option<bool> {
        let info = probe_foreground();
        let fullscreen = info.fullscreen || self.allowlisted(&info.process);
        self.last_info = info;

        if fullscreen == self.stable_fullscreen {
            self.pending = None;
            return None;
        }

        let now = std::time::Instant::now();
        match self.pending {
            Some((state, since)) if state == fullscreen => {
                if now.duration_since(since).as_millis() >= self.cfg.debounce_ms as u128 {
                    self.stable_fullscreen = fullscreen;
                    self.pending = None;
                    return Some(!fullscreen);
                }
            }
            _ => self.pending = Some((fullscreen, now)),
        }
        None
    }

    pub fn current(&self) -> (bool, &ForegroundInfo) {
        (self.stable_fullscreen, &self.last_info)
    }
}

/// 隐私监视线程：状态变化时通过 `on_change` 下发 OBS 指令。
pub fn spawn_watcher(
    cfg: PrivacyConfig,
    stop: Arc<AtomicBool>,
    log: LogFn,
    on_change: Arc<dyn Fn(bool) + Send + Sync>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut w = FullscreenWatcher::new(cfg.clone());
        // 首帧按 fail_safe 语义对齐一次，避免 OBS 停在上一轮的状态
        on_change(!w.current().0);
        log(
            2,
            format!(
                "[privacy] 监视启动：{} ms 轮询，{} ms 去抖",
                cfg.poll_ms, cfg.debounce_ms
            ),
        );
        while !stop.load(Ordering::Relaxed) {
            if let Some(blur) = w.poll() {
                let (fs, info) = w.current();
                log(
                    2,
                    format!(
                        "[privacy] {} -> {} | {} / {} / {:?}",
                        if fs { "全屏" } else { "非全屏" },
                        if blur { "虚化" } else { "还原" },
                        info.process,
                        info.class,
                        info.window_rect
                    ),
                );
                on_change(blur);
            }
            std::thread::sleep(std::time::Duration::from_millis(cfg.poll_ms.max(50)));
        }
        log(2, "[privacy] 监视停止".into());
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn watcher() -> FullscreenWatcher {
        FullscreenWatcher::new(PrivacyConfig {
            enabled: true,
            poll_ms: 50,
            debounce_ms: 0,
            allowlist: "obs64, chrome.exe".into(),
            fail_safe: true,
        })
    }

    #[test]
    fn allowlist_matches_with_and_without_exe() {
        let w = watcher();
        assert!(w.allowlisted("obs64.exe"));
        assert!(w.allowlisted("OBS64"));
        assert!(w.allowlisted("chrome.exe"));
        assert!(!w.allowlisted("explorer.exe"));
    }

    #[test]
    fn fail_safe_starts_blurred() {
        let w = watcher();
        assert!(!w.current().0, "启动时应视为非全屏");
    }
}

#[cfg(test)]
mod fullscreen_tests {
    /// 判定逻辑的纯函数版本，便于对窗口矩形做回归测试。
    /// 与 imp::probe 里的判定保持一致（改一处必须同步另一处），
    /// 也与宿主 corner_hotspot.rs::is_fullscreen_app_running() 语义一致。
    fn is_fullscreen(wr: [i32; 4], mr: [i32; 4]) -> bool {
        wr[0] == mr[0] && wr[1] == mr[1] && wr[2] == mr[2] && wr[3] == mr[3]
    }

    const MON: [i32; 4] = [0, 0, 1920, 1080];

    #[test]
    fn true_fullscreen_matches_exactly() {
        assert!(is_fullscreen([0, 0, 1920, 1080], MON));
    }

    #[test]
    fn maximized_window_is_not_fullscreen() {
        // 实测：Chrome 最大化 = [-8,-8,1928,1048]
        // 隐形边框 + 底边停在任务栏上方 → 四边都不等 → 正确判为非全屏
        assert!(!is_fullscreen([-8, -8, 1928, 1048], MON));
    }

    #[test]
    fn maximized_with_autohide_taskbar_still_not_fullscreen() {
        // 任务栏自动隐藏时底边会顶到 1080，但左右上仍带隐形边框，
        // 四边相等这一条依然把它挡掉（容差方案在这里会误判成全屏）
        assert!(!is_fullscreen([-8, -8, 1928, 1080], MON));
    }

    #[test]
    fn windowed_is_not_fullscreen() {
        assert!(!is_fullscreen([100, 100, 900, 700], MON));
    }

    #[test]
    fn borderless_window_smaller_than_monitor_is_not_fullscreen() {
        assert!(!is_fullscreen([100, 100, 1200, 800], MON));
    }

    #[test]
    fn fullscreen_on_secondary_monitor() {
        let mon2 = [1920, 0, 3840, 1080];
        assert!(is_fullscreen([1920, 0, 3840, 1080], mon2));
        assert!(!is_fullscreen([1912, -8, 3848, 1048], mon2));
    }

    #[test]
    fn off_by_one_pixel_is_not_fullscreen() {
        // 严格相等：差 1 px 就不算。宁可多虚化一次，也不漏掉桌面。
        assert!(!is_fullscreen([0, 0, 1921, 1080], MON));
    }
}
