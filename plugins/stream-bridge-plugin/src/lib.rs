//! Air Icon Launcher — 直播推流桥插件（cdylib ABI v1）。
//!
//! 解决两件采集卡做不到的事：
//!
//! 1. **声音**：采集卡只能抓 HDMI 里的音频，而耳机是 USB 的、插不到采集卡上。
//!    这里用 WASAPI 环回抓「本机默认播放设备上正在响的那份音频」，
//!    走局域网 UDP 直送副机，副机 `lan-audio-recv` 落到 null sink，
//!    OBS 采 `Monitor of LAN-Audio`。实测端到端 8 ms 量级。
//!
//! 2. **隐私**：采集卡抓的是整块显示器，无法只排除某个窗口。
//!    所以判据换成「前台窗口是否独占显示器」：一旦离开全屏，
//!    立刻通过 obs-websocket v5 打开采集源上的模糊滤镜；
//!    回到全屏再关掉。全屏时不虚化，虚化只在真正会暴露桌面时发生。
//!
//! 协议见 `docs/stream-bridge.md`。

pub mod audio;
pub mod obs;
pub mod privacy;
pub mod wire;

use serde::{Deserialize, Serialize};
use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

pub const ABI_VERSION: u32 = 1;

/// 「采集单程序音频」在 audio_device 下拉里的特殊值。
///
/// 不用空字符串（那个表示「跟随系统默认」），也不加新配置项，
/// 直接复用现有下拉，选它时改读 `audio_process`。
pub const PROC_LOOPBACK_MARKER: &str = "__process__";

#[repr(C)]
#[derive(Clone, Copy)]
pub struct AirHostVTable {
    pub abi_version: u32,
    pub user_data: *mut c_void,
    pub log: extern "C" fn(*mut c_void, level: i32, msg: *const c_char),
    pub host_invoke:
        extern "C" fn(*mut c_void, method: *const c_char, args: *const c_char) -> *mut c_char,
}

// ---------------------------------------------------------------- 配置

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    // ---- 音频推流 ----
    /// 是否随插件加载自动开始推流
    pub audio_enabled: bool,
    /// 副机接收地址 IP:PORT
    pub audio_dest: String,
    /// 播放端点名称子串（空 = 系统默认播放设备）
    pub audio_device: String,
    /// 线上采样率
    pub audio_rate: u32,
    /// 每包帧数
    pub audio_frames_per_packet: u32,
    /// 请求的设备周期（ms，0 = 端点最小值）
    pub audio_period_ms: f64,
    /// 空闲补静音
    pub audio_keepalive: bool,
    /// 增益
    /// 增益。用 f64 而不是 f32：f32 存 1.1 会变成 1.100000023841858，
    /// JSON 往返后设置界面就显示成那个长串。
    pub audio_gain: f64,
    /// 单程序采集的目标进程（audio_device 选「单程序」时生效）
    pub audio_process: String,

    // ---- 麦克风推流 ----
    /// 是否推送麦克风
    pub mic_enabled: bool,
    /// 麦克风那一路的副机地址
    pub mic_dest: String,
    /// 麦克风端点名称子串（空 = 系统默认麦克风）
    pub mic_device: String,
    /// 麦克风增益
    pub mic_gain: f64,
    /// 麦克风空闲补静音
    pub mic_keepalive: bool,

    // ---- 隐私虚化 ----
    /// 是否启用隐私监视
    pub privacy_enabled: bool,
    /// 轮询周期 ms
    pub privacy_poll_ms: u64,
    /// 去抖 ms
    pub privacy_debounce_ms: u64,
    /// 启动时先虚化
    pub privacy_fail_safe: bool,
    /// 额外视为安全全屏的进程名
    pub privacy_allowlist: String,

    // ---- OBS ----
    /// obs-websocket 地址
    pub obs_url: String,
    /// obs-websocket 密码
    pub obs_password: String,
    /// filter = 开关模糊滤镜；scene = 切隐私场景
    pub obs_mode: String,
    /// 采集源名
    pub obs_source: String,
    /// 模糊滤镜名
    pub obs_filter: String,
    /// 隐私场景名
    pub obs_privacy_scene: String,
    /// 回切场景名（空 = 记住进入前的场景）
    pub obs_normal_scene: String,
}

impl Default for Config {
    fn default() -> Self {
        let a = audio::PushConfig::default();
        let o = obs::ObsConfig::default();
        let p = privacy::PrivacyConfig::default();
        Self {
            audio_enabled: false,
            audio_dest: a.dest,
            audio_device: "MCHOSE".into(),
            audio_rate: a.rate,
            audio_frames_per_packet: a.frames_per_packet,
            audio_period_ms: a.period_ms,
            audio_keepalive: a.keepalive,
            audio_gain: a.gain as f64,
            audio_process: String::new(),
            mic_enabled: false,
            // 麦克风走独立端口，避免和主路抢同一个
            mic_dest: "192.168.31.66:47801".into(),
            mic_device: String::new(),
            mic_gain: 1.0,
            mic_keepalive: true,
            privacy_enabled: p.enabled,
            privacy_poll_ms: p.poll_ms,
            privacy_debounce_ms: p.debounce_ms,
            privacy_fail_safe: p.fail_safe,
            privacy_allowlist: p.allowlist,
            obs_url: o.url,
            obs_password: o.password,
            obs_mode: o.mode,
            obs_source: o.source,
            obs_filter: o.filter,
            obs_privacy_scene: o.privacy_scene,
            obs_normal_scene: o.normal_scene,
        }
    }
}

impl Config {
    /// 主路（播放设备 / 单程序）的推流参数。
    fn push_config(&self) -> audio::PushConfig {
        let device = if self.audio_device.trim().is_empty() {
            None
        } else {
            Some(self.audio_device.clone())
        };
        let (source, process, device) = if self.audio_device == PROC_LOOPBACK_MARKER {
            // 选「单程序」时，audio_device 存的是进程名
            let proc = if self.audio_process.trim().is_empty() {
                None
            } else {
                Some(self.audio_process.clone())
            };
            (audio::SourceKind::ProcessLoopback, proc, None)
        } else {
            (audio::SourceKind::RenderLoopback, None, device)
        };

        audio::PushConfig {
            dest: self.audio_dest.clone(),
            device,
            source,
            process,
            rate: self.audio_rate.max(8000),
            frames_per_packet: self.audio_frames_per_packet.clamp(16, 4096),
            period_ms: self.audio_period_ms.max(0.0),
            keepalive: self.audio_keepalive,
            gain: self.audio_gain.clamp(0.0, 4.0) as f32,
        }
    }

    /// 麦克风那一路的推流参数（端口、设备、增益各自独立）。
    fn mic_push_config(&self) -> audio::PushConfig {
        audio::PushConfig {
            dest: self.mic_dest.clone(),
            device: if self.mic_device.trim().is_empty() {
                None
            } else {
                Some(self.mic_device.clone())
            },
            source: audio::SourceKind::CaptureDevice,
            process: None,
            rate: self.audio_rate.max(8000),
            frames_per_packet: self.audio_frames_per_packet.clamp(16, 4096),
            period_ms: self.audio_period_ms.max(0.0),
            keepalive: self.mic_keepalive,
            gain: self.mic_gain.clamp(0.0, 4.0) as f32,
        }
    }

    fn obs_config(&self) -> obs::ObsConfig {
        obs::ObsConfig {
            url: self.obs_url.clone(),
            password: self.obs_password.clone(),
            mode: self.obs_mode.clone(),
            source: self.obs_source.clone(),
            filter: self.obs_filter.clone(),
            privacy_scene: self.obs_privacy_scene.clone(),
            normal_scene: self.obs_normal_scene.clone(),
        }
    }

    fn privacy_config(&self) -> privacy::PrivacyConfig {
        privacy::PrivacyConfig {
            enabled: self.privacy_enabled,
            poll_ms: self.privacy_poll_ms.clamp(50, 5000),
            debounce_ms: self.privacy_debounce_ms,
            allowlist: self.privacy_allowlist.clone(),
            fail_safe: self.privacy_fail_safe,
        }
    }
}

// ---------------------------------------------------------------- 运行态

struct Runtime {
    /// 主路（播放设备 / 单程序）
    audio_stop: Option<Arc<AtomicBool>>,
    audio_thread: Option<std::thread::JoinHandle<()>>,
    audio_stats: Arc<Mutex<audio::PushStats>>,
    /// 麦克风那一路，与主路完全独立（独立端口、独立线程、独立统计）
    mic_stop: Option<Arc<AtomicBool>>,
    mic_thread: Option<std::thread::JoinHandle<()>>,
    mic_stats: Arc<Mutex<audio::PushStats>>,
    privacy_stop: Option<Arc<AtomicBool>>,
    privacy_thread: Option<std::thread::JoinHandle<()>>,
    obs_tx: Option<Sender<obs::ObsCmd>>,
}

impl Runtime {
    fn new() -> Self {
        Self {
            audio_stop: None,
            audio_thread: None,
            audio_stats: Arc::new(Mutex::new(audio::PushStats::default())),
            mic_stop: None,
            mic_thread: None,
            mic_stats: Arc::new(Mutex::new(audio::PushStats::default())),
            privacy_stop: None,
            privacy_thread: None,
            obs_tx: None,
        }
    }

    fn take_mic(&mut self) -> Option<(Arc<AtomicBool>, std::thread::JoinHandle<()>)> {
        let stop = self.mic_stop.take()?;
        let handle = self.mic_thread.take();
        Some((stop, handle?))
    }

    /// 只摘出停止标志与线程句柄，**不 join**。
    ///
    /// 关键约束：join 绝不能发生在持有 `STATE` 锁的时候。
    /// 后台线程退出前会打日志，`host_log` 要取 `STATE` 锁；
    /// 持锁 join 就是一次必然的自死锁（冒烟测试里实测卡死在这里）。
    fn take_audio(&mut self) -> Option<(Arc<AtomicBool>, std::thread::JoinHandle<()>)> {
        let stop = self.audio_stop.take()?;
        let handle = self.audio_thread.take();
        Some((stop, handle?))
    }

    fn take_privacy(&mut self) -> Option<(Arc<AtomicBool>, std::thread::JoinHandle<()>)> {
        let stop = self.privacy_stop.take()?;
        let handle = self.privacy_thread.take();
        Some((stop, handle?))
    }

    fn take_obs(&mut self) -> Option<Sender<obs::ObsCmd>> {
        self.obs_tx.take()
    }
}

/// 置停止标志并在锁外 join。`handle` 为 None 时只置标志。
fn join_thread(stop: Arc<AtomicBool>, handle: Option<std::thread::JoinHandle<()>>) {
    stop.store(true, Ordering::Relaxed);
    if let Some(h) = handle {
        let _ = h.join();
    }
}

/// 停止音频：先摘句柄（持锁），再 join（不持锁）。
fn halt_audio() {
    let taken = {
        let mut g = match STATE.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        g.as_mut().and_then(|st| st.runtime.take_audio())
    };
    if let Some((stop, handle)) = taken {
        join_thread(stop, Some(handle));
    }
}

fn halt_privacy() {
    let taken = {
        let mut g = match STATE.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        g.as_mut().and_then(|st| st.runtime.take_privacy())
    };
    if let Some((stop, handle)) = taken {
        join_thread(stop, Some(handle));
    }
}

/// 停止全部（供以后的外部调用点复用；当前 shutdown 走的是内联版本，
/// 因为那里需要先把 PluginState 整体 take 出来）。
#[allow(dead_code)]
fn halt_all() {
    halt_privacy();
    halt_audio();
    let tx = {
        let mut g = match STATE.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        g.as_mut().and_then(|st| st.runtime.take_obs())
    };
    if let Some(tx) = tx {
        let _ = tx.send(obs::ObsCmd::Shutdown);
    }
}

struct PluginState {
    user_data: usize,
    log_fn: Option<extern "C" fn(*mut c_void, i32, *const c_char)>,
    host_invoke_fn:
        Option<extern "C" fn(*mut c_void, *const c_char, *const c_char) -> *mut c_char>,
    config: Config,
    runtime: Runtime,
}

static STATE: Mutex<Option<PluginState>> = Mutex::new(None);

/// 同一 DLL 被宿主重复加载时共享同一份静态变量；
/// 用计数保证只有最后一个实例退出时才清理状态。
static LIVE_INSTANCES: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

// ---------------------------------------------------------------- 日志

fn host_log(level: i32, msg: &str) {
    file_log(level, msg);
    // 先取回调再放锁：回调可能间接进 STATE，长阻塞会拖住 invoke
    let (log_fn, user_data) = match STATE.lock() {
        Ok(g) => match g.as_ref() {
            Some(st) => (st.log_fn, st.user_data),
            None => (None, 0),
        },
        Err(_) => (None, 0),
    };
    if let Some(f) = log_fn {
        if user_data != 0 {
            if let Ok(c) = CString::new(msg) {
                f(user_data as *mut c_void, level, c.as_ptr());
            }
        }
    }
}

/// 插件日志同步写一份到 `%TEMP%`：宿主环形日志在推流这种高频场景不好取。
static FILE_LOG_LOCK: Mutex<()> = Mutex::new(());

fn file_log(level: i32, msg: &str) {
    use std::io::Write;
    let _g = match FILE_LOG_LOCK.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    let path = std::env::temp_dir().join("stream-bridge-plugin.log");
    let too_big = std::fs::metadata(&path)
        .map(|m| m.len() > 512 * 1024)
        .unwrap_or(false);
    let mut opts = std::fs::OpenOptions::new();
    opts.create(true).write(true);
    if too_big {
        // 超限直接重写，避免无限增长
        opts.truncate(true);
    } else {
        opts.append(true);
    }
    if let Ok(mut f) = opts.open(&path) {
        let tag = match level {
            0 => "TRACE",
            1 => "DEBUG",
            2 => "INFO",
            3 => "WARN",
            _ => "ERROR",
        };
        let _ = writeln!(f, "[{}] {} {}", now_stamp(), tag, msg);
    }
}

#[cfg(windows)]
fn now_stamp() -> String {
    use windows::Win32::Foundation::SYSTEMTIME;
    use windows::Win32::System::SystemInformation::GetLocalTime;
    let st: SYSTEMTIME = unsafe { GetLocalTime() };
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}",
        st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond, st.wMilliseconds
    )
}

#[cfg(not(windows))]
fn now_stamp() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}", d.as_secs(), d.subsec_millis())
}

/// 给后台线程用的日志闭包。
fn log_fn() -> audio::LogFn {
    Arc::new(|level: i32, msg: String| host_log(level, &msg))
}

fn ok_envelope(data: serde_json::Value) -> CString {
    let env = serde_json::json!({ "ok": true, "data": data });
    CString::new(env.to_string()).unwrap_or_else(|_| CString::new("{\"ok\":true}").unwrap())
}

fn err_envelope(code: &str, message: &str) -> CString {
    let env = serde_json::json!({
        "ok": false,
        "error": { "code": code, "message": message }
    });
    CString::new(env.to_string())
        .unwrap_or_else(|_| CString::new("{\"ok\":false}").unwrap())
}

// ---------------------------------------------------------------- 配置持久化

/// `%APPDATA%/air-icon-launcher/plugin-data/com.air.stream.bridge/config.json`
fn config_path() -> std::path::PathBuf {
    let base = std::env::var("APPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    base.join("air-icon-launcher")
        .join("plugin-data")
        .join("com.air.stream.bridge")
        .join("config.json")
}

fn load_config() -> Config {
    let path = config_path();
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Config::default();
    };
    match serde_json::from_str::<Config>(&text) {
        Ok(c) => c,
        Err(e) => {
            // 写坏了先备份，别让下一次保存把原文件彻底覆盖
            let bak = path.with_extension("json.corrupt");
            let _ = std::fs::write(&bak, &text);
            host_log(3, &format!("[config] 解析失败，已备份到 {bak:?}: {e}"));
            Config::default()
        }
    }
}

fn save_config(cfg: &Config) -> Result<(), String> {
    let path = config_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &text).map_err(|e| format!("写临时文件失败: {e}"))?;
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&path);
        std::fs::rename(&tmp, &path).map_err(|e| format!("替换配置失败: {e}"))?;
    }
    Ok(())
}

// ---------------------------------------------------------------- 启停

fn current_config() -> Config {
    match STATE.lock() {
        Ok(g) => match g.as_ref() {
            Some(st) => st.config.clone(),
            None => load_config(),
        },
        Err(_) => load_config(),
    }
}

/// 启动音频推流。已在运行则先停。
/// 起一路推流线程并把句柄塞进 Runtime。主路和麦克风共用这套。
///
/// `slot` 决定存到哪个字段，避免两路互相覆盖。
fn spawn_push(
    push: audio::PushConfig,
    slot: PushSlot,
    tag: &'static str,
) -> Result<serde_json::Value, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let stats = Arc::new(Mutex::new(audio::PushStats::default()));
    let log = log_fn();

    // 采集线程会阻塞在 WASAPI 事件上，用独立线程承载；
    // 这里不 join，失败通过 stats.last_error 反馈。
    let s2 = stop.clone();
    let stats2 = stats.clone();
    let cfg2 = push.clone();
    let log2 = log.clone();
    let handle = std::thread::spawn(move || {
        if let Err(e) = audio::run_push(cfg2, s2, log2, stats2.clone()) {
            host_log(4, &format!("[{tag}] 采集线程退出: {e}"));
            if let Ok(mut st) = stats2.lock() {
                st.last_error = e;
                st.running = false;
            }
        }
    });

    {
        let mut g = STATE.lock().map_err(|_| "state lock poisoned".to_string())?;
        if let Some(st) = g.as_mut() {
            match slot {
                PushSlot::Main => {
                    st.runtime.audio_stop = Some(stop);
                    st.runtime.audio_thread = Some(handle);
                    st.runtime.audio_stats = stats.clone();
                }
                PushSlot::Mic => {
                    st.runtime.mic_stop = Some(stop);
                    st.runtime.mic_thread = Some(handle);
                    st.runtime.mic_stats = stats.clone();
                }
            }
        }
    }

    Ok(serde_json::json!({
        "started": true,
        "dest": push.dest,
        "rate": push.rate,
        "frames_per_packet": push.frames_per_packet,
        "source": push.source.as_str(),
    }))
}

#[derive(Clone, Copy)]
enum PushSlot {
    Main,
    Mic,
}

fn start_audio() -> Result<serde_json::Value, String> {
    let cfg = current_config();
    let push = cfg.push_config();

    // 先停旧的。halt_audio 内部把 join 放在 STATE 锁外，
    // 否则后台线程退出时打日志会与这里互等。
    halt_audio();
    spawn_push(push, PushSlot::Main, "audio")
}

fn stop_audio() -> serde_json::Value {
    halt_audio();
    serde_json::json!({ "stopped": true })
}

fn start_mic() -> Result<serde_json::Value, String> {
    let cfg = current_config();
    let push = cfg.mic_push_config();
    halt_mic();
    spawn_push(push, PushSlot::Mic, "mic")
}

fn stop_mic() -> serde_json::Value {
    halt_mic();
    serde_json::json!({ "stopped": true })
}

/// 停止麦克风那一路：先摘句柄（持锁），再 join（不持锁）。
fn halt_mic() {
    let taken = {
        let mut g = match STATE.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        g.as_mut().and_then(|st| st.runtime.take_mic())
    };
    if let Some((stop, handle)) = taken {
        join_thread(stop, Some(handle));
    }
}

/// 启动隐私监视。OBS 指令通道若不存在则先建。
fn start_privacy() -> Result<serde_json::Value, String> {
    let cfg = current_config();
    let pcfg = cfg.privacy_config();
    let ocfg = cfg.obs_config();

    // 先停旧的监视线程：join 必须在 STATE 锁外（线程退出会打日志）
    halt_privacy();

    let (tx, rx) = std::sync::mpsc::channel::<obs::ObsCmd>();
    let log = log_fn();

    {
        let mut g = STATE.lock().map_err(|_| "state lock poisoned".to_string())?;
        let st = g.as_mut().ok_or("插件未初始化")?;
        if let Some(old) = st.runtime.obs_tx.take() {
            let _ = old.send(obs::ObsCmd::Shutdown);
        }
        st.runtime.obs_tx = Some(tx.clone());
    }

    obs::spawn_obs_worker(ocfg, rx, log.clone());

    let stop = Arc::new(AtomicBool::new(false));
    let tx2 = tx.clone();
    let on_change: Arc<dyn Fn(bool) + Send + Sync> = Arc::new(move |blur: bool| {
        obs::send_cmd(&tx2, obs::ObsCmd::Blur(blur));
    });

    let s2 = stop.clone();
    let pcfg2 = pcfg.clone();
    let handle = privacy::spawn_watcher(pcfg2, s2, log, on_change);

    {
        let mut g = STATE.lock().map_err(|_| "state lock poisoned".to_string())?;
        if let Some(st) = g.as_mut() {
            st.runtime.privacy_stop = Some(stop);
            st.runtime.privacy_thread = Some(handle);
        }
    }

    Ok(serde_json::json!({
        "watching": true,
        "poll_ms": pcfg.poll_ms,
        "debounce_ms": pcfg.debounce_ms,
        "obs_url": cfg.obs_url,
        "mode": cfg.obs_mode,
    }))
}

fn stop_privacy() -> serde_json::Value {
    halt_privacy();
    serde_json::json!({ "stopped": true })
}

/// 应用配置变更：音频/隐私在运行时则按新配置重启。
fn apply_config(new_cfg: Config) -> Result<Config, String> {
    let (audio_running, privacy_running) = {
        let g = STATE.lock().map_err(|_| "state lock poisoned".to_string())?;
        match g.as_ref() {
            Some(st) => (
                st.runtime.audio_stop.is_some(),
                st.runtime.privacy_stop.is_some(),
            ),
            None => (false, false),
        }
    };

    save_config(&new_cfg)?;
    {
        let mut g = STATE.lock().map_err(|_| "state lock poisoned".to_string())?;
        let st = g.as_mut().ok_or("插件未初始化")?;
        st.config = new_cfg.clone();
    }

    if audio_running {
        start_audio()?;
    }
    if privacy_running {
        start_privacy()?;
    }

    Ok(new_cfg)
}

// ---------------------------------------------------------------- ABI

#[no_mangle]
pub extern "C" fn air_plugin_abi_version() -> u32 {
    ABI_VERSION
}

#[no_mangle]
pub extern "C" fn air_plugin_manifest() -> *mut c_char {
    let json = include_str!("../manifest.json");
    match CString::new(json) {
        Ok(c) => c.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

#[no_mangle]
pub extern "C" fn air_plugin_init(host: *const AirHostVTable, _user_data: *mut c_void) -> i32 {
    if host.is_null() {
        return -1;
    }
    let vt = unsafe { &*host };
    if vt.abi_version != ABI_VERSION {
        return -2;
    }

    // 重复 init（宿主重载同一 DLL）：只更新回调，保留内存中的配置与线程
    let already = match STATE.lock() {
        Ok(g) => g.is_some(),
        Err(_) => return -3,
    };
    if already {
        if let Ok(mut g) = STATE.lock() {
            if let Some(st) = g.as_mut() {
                st.user_data = vt.user_data as usize;
                st.log_fn = Some(vt.log);
                st.host_invoke_fn = Some(vt.host_invoke);
            }
        }
        LIVE_INSTANCES.fetch_add(1, Ordering::SeqCst);
        host_log(2, "[init] 重复加载同一实例，保留运行中的线程");
        return 0;
    }

    let cfg = load_config();
    if let Ok(mut g) = STATE.lock() {
        *g = Some(PluginState {
            user_data: vt.user_data as usize,
            log_fn: Some(vt.log),
            host_invoke_fn: Some(vt.host_invoke),
            config: cfg.clone(),
            runtime: Runtime::new(),
        });
    }
    LIVE_INSTANCES.fetch_add(1, Ordering::SeqCst);
    host_log(2, &format!("air_stream_bridge initialized, config: {cfg:?}"));

    // 自动起线程：两个开关独立
    if cfg.audio_enabled {
        if let Err(e) = start_audio() {
            host_log(4, &format!("[init] 自动启动推流失败: {e}"));
        }
    }
    if cfg.mic_enabled {
        if let Err(e) = start_mic() {
            host_log(4, &format!("[init] 自动启动麦克风失败: {e}"));
        }
    }
    if cfg.privacy_enabled {
        if let Err(e) = start_privacy() {
            host_log(4, &format!("[init] 自动启动隐私监视失败: {e}"));
        }
    }
    0
}

#[no_mangle]
pub extern "C" fn air_plugin_invoke(
    method: *const c_char,
    args_json: *const c_char,
) -> *mut c_char {
    // 跨 FFI 不能 unwind：panic 逃出 extern "C" 是 UB，宿主会直接崩
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        invoke_impl(method, args_json)
    }));
    match result {
        Ok(ptr) => ptr,
        Err(payload) => {
            let msg = panic_message(&payload);
            host_log(4, &format!("[invoke] panic: {msg}"));
            err_envelope("PLUGIN_PANIC", &format!("插件内部 panic: {msg}")).into_raw()
        }
    }
}

fn panic_message(payload: &Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "未知 panic".to_string()
    }
}

fn invoke_impl(method: *const c_char, args_json: *const c_char) -> *mut c_char {
    if method.is_null() {
        return err_envelope("INVALID_INPUT", "method is null").into_raw();
    }
    let method = unsafe { CStr::from_ptr(method) }
        .to_string_lossy()
        .into_owned();
    let args: serde_json::Value = if args_json.is_null() {
        serde_json::Value::Null
    } else {
        let raw = unsafe { CStr::from_ptr(args_json) }
            .to_string_lossy()
            .into_owned();
        serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null)
    };

    let cfg = current_config();

    let result: Result<serde_json::Value, String> = match method.as_str() {
        // ---- 音频 ----
        "audio_start" => start_audio(),
        "audio_stop" => Ok(stop_audio()),
        // ---- 麦克风 ----
        "mic_start" => start_mic(),
        "mic_stop" => Ok(stop_mic()),
        "mic_status" => {
            let stats = {
                let g = match STATE.lock() {
                    Ok(g) => g,
                    Err(_) => return err_envelope("LOCK", "state lock poisoned").into_raw(),
                };
                match g.as_ref() {
                    Some(st) => st.runtime.mic_stats.clone(),
                    None => Arc::new(Mutex::new(audio::PushStats::default())),
                }
            };
            let s = stats.lock().map(|s| s.clone()).unwrap_or_default();
            Ok(serde_json::json!({
                "running": s.running,
                "endpoint": s.endpoint,
                "mix_format": s.mix_format,
                "packets": s.packets,
                "frames": s.frames,
                "send_errors": s.send_errors,
                "last_error": s.last_error,
                "dest": cfg.mic_dest,
                "gain": cfg.mic_gain,
            }))
        }
        "audio_processes" => audio::list_audio_processes().map(|mut v| {
            if let Some(obj) = v.as_object_mut() {
                obj.insert("configured".into(), serde_json::json!(cfg.audio_process));
            }
            v
        }),
        "mic_devices" => audio::list_capture_devices().map(|mut v| {
            if let Some(obj) = v.as_object_mut() {
                obj.insert("configured".into(), serde_json::json!(cfg.mic_device));
            }
            v
        }),

        "audio_devices" => audio::list_render_devices().map(|mut v| {
            // 附上当前配置值，前端可用它判断「已选设备是否还存在」
            if let Some(obj) = v.as_object_mut() {
                obj.insert(
                    "configured".into(),
                    serde_json::json!(cfg.audio_device),
                );
            }
            v
        }),
        "audio_status" => {
            let stats = {
                let g = match STATE.lock() {
                    Ok(g) => g,
                    Err(_) => return err_envelope("LOCK", "state lock poisoned").into_raw(),
                };
                match g.as_ref() {
                    Some(st) => st.runtime.audio_stats.clone(),
                    None => Arc::new(Mutex::new(audio::PushStats::default())),
                }
            };
            let s = stats.lock().map(|s| s.clone()).unwrap_or_default();
            Ok(serde_json::json!({
                "running": s.running,
                "endpoint": s.endpoint,
                "mix_format": s.mix_format,
                "device_period_ms": s.device_period_ms,
                "packets": s.packets,
                "frames": s.frames,
                "silent_packets": s.silent_packets,
                "send_errors": s.send_errors,
                "capture_lag_ms": s.capture_lag_ms,
                "last_error": s.last_error,
                "dest": cfg.audio_dest,
            }))
        }

        // ---- 隐私 ----
        "privacy_start" => start_privacy(),
        "privacy_stop" => Ok(stop_privacy()),
        "privacy_status" => {
            let info = privacy::probe_foreground();
            let watching = {
                let g = match STATE.lock() {
                    Ok(g) => g,
                    Err(_) => return err_envelope("LOCK", "state lock poisoned").into_raw(),
                };
                g.as_ref()
                    .map(|st| st.runtime.privacy_stop.is_some())
                    .unwrap_or(false)
            };
            Ok(serde_json::json!({
                "watching": watching,
                "foreground": info,
                "poll_ms": cfg.privacy_poll_ms,
                "debounce_ms": cfg.privacy_debounce_ms,
                "allowlist": cfg.privacy_allowlist,
            }))
        }

        // ---- OBS ----
        "obs_probe" => obs::probe_once(&cfg.obs_config()),
        "obs_list" => obs::list_sources_once(&cfg.obs_config()),
        "obs_source_settings" => {
            let name = args
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(&cfg.obs_source)
                .to_string();
            let mut w = obs::ObsWorker::new(cfg.obs_config());
            let log = log_fn();
            w.get_input_settings(&name, &log)
        }
        "obs_set_source_settings" => {
            let name = args
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(&cfg.obs_source)
                .to_string();
            match args.get("settings") {
                None => Err("缺少 settings".to_string()),
                Some(s) => {
                    let mut w = obs::ObsWorker::new(cfg.obs_config());
                    let log = log_fn();
                    w.set_input_settings(&name, s.clone(), &log)
                }
            }
        }
        "obs_create_filter" => {
            let kind = args
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or("blur_filter_v1");
            obs::ensure_filter_once(&cfg.obs_config(), kind)
        }
        "obs_filter_setting" => match args.get("key").and_then(|v| v.as_str()) {
            None => Err("缺少 key".to_string()),
            Some(key) => {
                let key = key.to_string();
                let value = args.get("value").cloned().unwrap_or(serde_json::Value::Null);
                let mut w = obs::ObsWorker::new(cfg.obs_config());
                let log = log_fn();
                w.set_filter_setting(&key, value.clone(), &log)
                    .map(|_| serde_json::json!({ "key": key, "value": value }))
            }
        },
        "obs_remove_filter" => {
            let name = args
                .get("filter")
                .and_then(|v| v.as_str())
                .unwrap_or(&cfg.obs_filter)
                .to_string();
            let mut w = obs::ObsWorker::new(cfg.obs_config());
            let log = log_fn();
            w.remove_filter(&name, &log)
        }
        "obs_replace_filter_settings" => {
            let name = args
                .get("filter")
                .and_then(|v| v.as_str())
                .unwrap_or(&cfg.obs_filter)
                .to_string();
            match args.get("settings") {
                None => Err("缺少 settings".to_string()),
                Some(s) => {
                    let mut w = obs::ObsWorker::new(cfg.obs_config());
                    let log = log_fn();
                    w.replace_filter_settings(&name, s.clone(), &log)
                }
            }
        }
        "obs_filter_kinds" => {
            let mut w = obs::ObsWorker::new(cfg.obs_config());
            let log = log_fn();
            w.filter_kinds(&log)
        }
        "obs_filter_info" => {
            let name = args
                .get("filter")
                .and_then(|v| v.as_str())
                .unwrap_or(&cfg.obs_filter)
                .to_string();
            let mut w = obs::ObsWorker::new(cfg.obs_config());
            let log = log_fn();
            w.filter_info(&name, &log)
        }
        "obs_blur" => {
            let on = args.get("on").and_then(|v| v.as_bool()).unwrap_or(true);
            // 手动调试走**独立连接**，不经过监视线程的 worker。
            //
            // 之前把命令塞进 privacy 的 obs_tx，结果和自动监视抢状态：
            // 手动开虚化后，监视线程下一次采样判定「全屏」就把画面还原了，
            // 看起来像「开关没反应」。手动调试本来就不该影响自动逻辑。
            let mut w = obs::ObsWorker::new(cfg.obs_config());
            let log = log_fn();
            match w.set_blur(on, &log) {
                Ok(()) => Ok(serde_json::json!({ "blur": on, "applied": true })),
                Err(e) => Err(e),
            }
        }
        "obs_reconnect" => {
            let tx = {
                let g = match STATE.lock() {
                    Ok(g) => g,
                    Err(_) => return err_envelope("LOCK", "state lock poisoned").into_raw(),
                };
                g.as_ref().and_then(|st| st.runtime.obs_tx.clone())
            };
            match tx {
                Some(tx) => {
                    obs::send_cmd(&tx, obs::ObsCmd::Reconnect);
                    Ok(serde_json::json!({ "queued": true }))
                }
                None => Err("隐私监视未启动".into()),
            }
        }

        // ---- 配置 ----
        "settings.get" | "get_config" => Ok(serde_json::to_value(&cfg).unwrap_or_default()),
        "settings.set" | "set_config" => {
            let mut new_cfg = cfg.clone();
            let a = &args;
            if let Some(v) = a.get("audio_enabled").and_then(|v| v.as_bool()) {
                new_cfg.audio_enabled = v;
            }
            if let Some(v) = a.get("audio_dest").and_then(|v| v.as_str()) {
                new_cfg.audio_dest = v.to_string();
            }
            if let Some(v) = a.get("audio_device").and_then(|v| v.as_str()) {
                new_cfg.audio_device = v.to_string();
            }
            if let Some(v) = a.get("audio_rate").and_then(|v| v.as_u64()) {
                new_cfg.audio_rate = v as u32;
            }
            if let Some(v) = a.get("audio_frames_per_packet").and_then(|v| v.as_u64()) {
                new_cfg.audio_frames_per_packet = v as u32;
            }
            if let Some(v) = a.get("audio_period_ms").and_then(|v| v.as_f64()) {
                new_cfg.audio_period_ms = v;
            }
            if let Some(v) = a.get("audio_keepalive").and_then(|v| v.as_bool()) {
                new_cfg.audio_keepalive = v;
            }
            if let Some(v) = a.get("audio_gain").and_then(|v| v.as_f64()) {
                new_cfg.audio_gain = v;
            }
            if let Some(v) = a.get("audio_process").and_then(|v| v.as_str()) {
                new_cfg.audio_process = v.to_string();
            }
            if let Some(v) = a.get("mic_enabled").and_then(|v| v.as_bool()) {
                new_cfg.mic_enabled = v;
            }
            if let Some(v) = a.get("mic_dest").and_then(|v| v.as_str()) {
                new_cfg.mic_dest = v.to_string();
            }
            if let Some(v) = a.get("mic_device").and_then(|v| v.as_str()) {
                new_cfg.mic_device = v.to_string();
            }
            if let Some(v) = a.get("mic_gain").and_then(|v| v.as_f64()) {
                new_cfg.mic_gain = v;
            }
            if let Some(v) = a.get("mic_keepalive").and_then(|v| v.as_bool()) {
                new_cfg.mic_keepalive = v;
            }
            if let Some(v) = a.get("privacy_enabled").and_then(|v| v.as_bool()) {
                new_cfg.privacy_enabled = v;
            }
            if let Some(v) = a.get("privacy_poll_ms").and_then(|v| v.as_u64()) {
                new_cfg.privacy_poll_ms = v;
            }
            if let Some(v) = a.get("privacy_debounce_ms").and_then(|v| v.as_u64()) {
                new_cfg.privacy_debounce_ms = v;
            }
            if let Some(v) = a.get("privacy_fail_safe").and_then(|v| v.as_bool()) {
                new_cfg.privacy_fail_safe = v;
            }
            if let Some(v) = a.get("privacy_allowlist").and_then(|v| v.as_str()) {
                new_cfg.privacy_allowlist = v.to_string();
            }
            if let Some(v) = a.get("obs_url").and_then(|v| v.as_str()) {
                new_cfg.obs_url = v.to_string();
            }
            if let Some(v) = a.get("obs_password").and_then(|v| v.as_str()) {
                new_cfg.obs_password = v.to_string();
            }
            if let Some(v) = a.get("obs_mode").and_then(|v| v.as_str()) {
                // blur = 缩放滤镜做真模糊（默认，效果最好）
                // scene = 切到专用隐私场景
                if v == "blur" || v == "scene" {
                    new_cfg.obs_mode = v.to_string();
                } else {
                    return err_envelope("INVALID_INPUT", "obs_mode 只能是 blur 或 scene")
                        .into_raw();
                }
            }
            if let Some(v) = a.get("obs_source").and_then(|v| v.as_str()) {
                new_cfg.obs_source = v.to_string();
            }
            if let Some(v) = a.get("obs_filter").and_then(|v| v.as_str()) {
                new_cfg.obs_filter = v.to_string();
            }
            if let Some(v) = a.get("obs_privacy_scene").and_then(|v| v.as_str()) {
                new_cfg.obs_privacy_scene = v.to_string();
            }
            if let Some(v) = a.get("obs_normal_scene").and_then(|v| v.as_str()) {
                new_cfg.obs_normal_scene = v.to_string();
            }
            // 返回**配置对象本身**，不要包一层。
            //
            // 前端 saveSetting 会把返回值直接当成新的 settings 整体替换：
            //   settings.value = r.value
            // 之前这里返回 {saved, audio_restarted, config}，前端就把这层包装
            // 当成了设置表，于是刚改的项全部「消失」（其实是路径错了），
            // 必须重进页面重新 settings.get 才正常。
            // 迈从插件返回 serde_json::to_value(&new_cfg)，也是这个形状。
            apply_config(new_cfg)
                .map(|c| serde_json::to_value(&c).unwrap_or_default())
        }

        // ---- 自启钩子：宿主在 --autostart 时调用 ----
        "run_on_autostart" => {
            let mut started = Vec::new();
            if cfg.audio_enabled {
                if start_audio().is_ok() {
                    started.push("audio");
                }
            }
            if cfg.mic_enabled {
                if start_mic().is_ok() {
                    started.push("mic");
                }
            }
            if cfg.privacy_enabled {
                if start_privacy().is_ok() {
                    started.push("privacy");
                }
            }
            Ok(serde_json::json!({ "started": started }))
        }

        other => Err(format!("Unknown method '{other}'")),
    };

    match result {
        Ok(v) => ok_envelope(v).into_raw(),
        Err(e) => {
            host_log(3, &format!("[invoke] {method} 失败: {e}"));
            err_envelope("PLUGIN_ERROR", &e).into_raw()
        }
    }
}

#[no_mangle]
pub extern "C" fn air_plugin_on_event(event_json: *const c_char) {
    if event_json.is_null() {
        return;
    }
    let raw = unsafe { CStr::from_ptr(event_json) }
        .to_string_lossy()
        .into_owned();
    host_log(1, &format!("[event] {raw}"));
}

#[no_mangle]
pub extern "C" fn air_plugin_free_string(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    unsafe { drop(CString::from_raw(ptr)) };
}

#[no_mangle]
pub extern "C" fn air_plugin_shutdown() {
    let n = LIVE_INSTANCES.fetch_sub(1, Ordering::SeqCst);
    if n > 1 {
        // 还有别的实例持有同一份静态变量，不动线程
        host_log(2, "[shutdown] 仍有存活实例，保留运行中的线程");
        return;
    }
    let _ = LIVE_INSTANCES.swap(0, Ordering::SeqCst);
    host_log(2, "air_stream_bridge shutdown");
    // 先把状态整体取出并释放锁，再停线程：
    // 线程退出路径上的 host_log 要取 STATE 锁，持锁 join 会自死锁。
    let taken = {
        let mut g = match STATE.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        g.take()
    };
    if let Some(st) = taken {
        let mut rt = st.runtime;
        let audio = rt.take_audio();
        let privacy = rt.take_privacy();
        let obs = rt.take_obs();
        if let Some((stop, h)) = privacy {
            join_thread(stop, Some(h));
        }
        if let Some((stop, h)) = audio {
            join_thread(stop, Some(h));
        }
        if let Some(tx) = obs {
            let _ = tx.send(obs::ObsCmd::Shutdown);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_roundtrip_json() {
        let c = Config::default();
        let s = serde_json::to_string(&c).unwrap();
        let back: Config = serde_json::from_str(&s).unwrap();
        assert_eq!(back.audio_dest, c.audio_dest);
        assert_eq!(back.audio_device, "MCHOSE");
        assert_eq!(back.obs_mode, "blur");
    }

    #[test]
    fn partial_config_uses_defaults() {
        // 老配置文件缺字段时不能被判为损坏
        let c: Config = serde_json::from_str(r#"{"audio_enabled":true}"#).unwrap();
        assert!(c.audio_enabled);
        assert_eq!(c.audio_rate, 48000);
        assert_eq!(c.obs_source, "视频采集设备 (V4L2)");
    }

    #[test]
    fn push_config_clamps_bad_values() {
        let mut c = Config::default();
        c.audio_frames_per_packet = 99999;
        c.audio_rate = 1;
        c.audio_gain = 100.0;
        let p = c.push_config();
        assert_eq!(p.frames_per_packet, 4096);
        assert_eq!(p.rate, 8000);
        assert_eq!(p.gain, 4.0);
    }

    #[test]
    fn empty_device_becomes_none() {
        let mut c = Config::default();
        c.audio_device = "  ".into();
        assert!(c.push_config().device.is_none());
    }

    #[test]
    fn privacy_config_clamps_poll() {
        let mut c = Config::default();
        c.privacy_poll_ms = 1;
        assert_eq!(c.privacy_config().poll_ms, 50);
        c.privacy_poll_ms = 999_999;
        assert_eq!(c.privacy_config().poll_ms, 5000);
    }

    #[test]
    fn unknown_method_reports_error() {
        let m = CString::new("nope").unwrap();
        let ptr = air_plugin_invoke(m.as_ptr(), std::ptr::null());
        assert!(!ptr.is_null());
        let s = unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned();
        air_plugin_free_string(ptr);
        assert!(s.contains("PLUGIN_ERROR"), "got {s}");
    }
}
