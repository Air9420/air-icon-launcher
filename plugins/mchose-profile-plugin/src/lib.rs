//! MCHOSE 板载配置切换插件 —— Air Icon Launcher (cdylib ABI v1)
//!
//! 功能：
//! - 按键在板载配置间轮换 / 在选定两个配置间切换
//! - 切换后把状态推送到远端 Linux 主机显示 OSD
//!
//! 协议见 docs/architecture/mchose-mouse-protocol.md

pub mod hid;
pub mod hotkey;

use serde::{Deserialize, Serialize};
use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::Mutex;

pub const ABI_VERSION: u32 = 1;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct AirHostVTable {
    pub abi_version: u32,
    pub user_data: *mut c_void,
    pub log: extern "C" fn(*mut c_void, level: i32, msg: *const c_char),
    pub host_invoke:
        extern "C" fn(*mut c_void, method: *const c_char, args: *const c_char) -> *mut c_char,
}

struct PluginState {
    user_data: usize,
    log_fn: Option<extern "C" fn(*mut c_void, i32, *const c_char)>,
    host_invoke_fn:
        Option<extern "C" fn(*mut c_void, *const c_char, *const c_char) -> *mut c_char>,
    config: Config,
}

static STATE: Mutex<Option<PluginState>> = Mutex::new(None);

// ---------------------------------------------------------------- 配置

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// 轮换模式："cycle" 全部轮换 | "pair" 两选一切换
    #[serde(default = "default_mode")]
    pub mode: String,
    /// 参与轮换的槽位（0 起），cycle 模式用
    #[serde(default = "default_slots")]
    pub active_slots: Vec<u8>,
    /// pair 模式的两个槽位
    #[serde(default = "default_pair")]
    pub pair: Vec<u8>,
    /// OSD 服务地址
    #[serde(default = "default_osd_url")]
    pub osd_url: String,
    /// OSD 显示时长（秒）
    #[serde(default = "default_duration")]
    pub duration: f32,
    /// 是否显示电量
    #[serde(default = "default_true")]
    pub show_battery: bool,
    /// 全局热键，如 "ctrl+shift+m"
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    /// 插件加载后是否自动注册热键
    #[serde(default = "default_true")]
    pub hotkey_enabled: bool,
}

fn default_mode() -> String {
    "cycle".into()
}
fn default_slots() -> Vec<u8> {
    vec![0, 1, 2]
}
fn default_pair() -> Vec<u8> {
    vec![1, 2]
}
fn default_osd_url() -> String {
    "http://192.168.31.66:8766".into()
}
fn default_duration() -> f32 {
    2.5
}
fn default_true() -> bool {
    true
}
fn default_hotkey() -> String {
    "ctrl+shift+m".into()
}

impl Default for Config {
    fn default() -> Self {
        Self {
            mode: default_mode(),
            active_slots: default_slots(),
            pair: default_pair(),
            osd_url: default_osd_url(),
            duration: default_duration(),
            show_battery: default_true(),
            hotkey: default_hotkey(),
            hotkey_enabled: default_true(),
        }
    }
}

// ---------------------------------------------------------------- 日志

fn host_log(level: i32, msg: &str) {
    // 同时写文件，便于在宿主进程内排查（宿主的环形日志不易取出）
    debug_file_log(level, msg);
    if let Ok(guard) = STATE.lock() {
        if let Some(st) = guard.as_ref() {
            if let Some(log_fn) = st.log_fn {
                if st.user_data != 0 {
                    if let Ok(c) = CString::new(msg) {
                        log_fn(st.user_data as *mut c_void, level, c.as_ptr());
                    }
                }
            }
        }
    }
}

/// 追加写入 %TEMP%/mchose-profile-plugin.log（超过 256KB 时截断重建）
fn debug_file_log(level: i32, msg: &str) {
    use std::io::Write;
    let path = std::env::temp_dir().join("mchose-profile-plugin.log");
    let too_big = std::fs::metadata(&path)
        .map(|m| m.len() > 256 * 1024)
        .unwrap_or(false);
    let mut opts = std::fs::OpenOptions::new();
    opts.create(true).write(true);
    if too_big {
        opts.truncate(true);
    } else {
        opts.append(true);
    }
    if let Ok(mut f) = opts.open(&path) {
        let _ = writeln!(f, "[{}] L{level} {msg}", chrono_like_now());
    }
}

/// 极简时间戳（避免引入 chrono 依赖）
fn chrono_like_now() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}", d.as_secs(), d.subsec_millis())
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
    CString::new(env.to_string()).unwrap_or_else(|_| CString::new("{\"ok\":false}").unwrap())
}

// ---------------------------------------------------------------- 核心逻辑

/// 计算下一个槽位
pub fn next_slot(current: u8, cfg: &Config) -> u8 {
    let slots: Vec<u8> = if cfg.mode == "pair" {
        cfg.pair.clone()
    } else {
        cfg.active_slots.clone()
    };
    if slots.is_empty() {
        return current;
    }
    match slots.iter().position(|&s| s == current) {
        Some(i) => slots[(i + 1) % slots.len()],
        None => slots[0],
    }
}

/// 构造推送给 OSD 的 JSON
fn build_osd_payload(
    profile: &hid::MouseProfile,
    names: &[String; 3],
    battery: Option<hid::BatteryInfo>,
    cfg: &Config,
) -> serde_json::Value {
    let idx = profile.profile_index as usize;
    let name = names
        .get(idx)
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| format!("配置 {}", idx + 1));

    let slots: Vec<u8> = if cfg.mode == "pair" {
        cfg.pair.clone()
    } else {
        cfg.active_slots.clone()
    };

    // 显示序号必须按「启用槽位列表」计算，而不是原始槽位号。
    // 例如 pair=[1,2] 时，槽 1 应显示 1/2，槽 2 显示 2/2。
    let display_index = slots
        .iter()
        .position(|&s| s == profile.profile_index)
        .map(|p| p + 1)
        .unwrap_or(profile.profile_index as usize + 1);

    // 取当前档位的 DPI（X 轴）
    let stage = profile.active_dpi_stage.saturating_sub(1) as usize;
    let dpi_x = profile
        .dpi_stages
        .get(stage)
        .copied()
        .filter(|&d| d > 0)
        .or_else(|| profile.dpi_stages.iter().copied().find(|&d| d > 0));

    // Y 轴：仅当独立设置时取，否则与 X 相同
    let dpi_y = if profile.axis_y_enabled {
        profile
            .dpi_stages_y
            .get(stage)
            .copied()
            .filter(|&d| d > 0)
    } else {
        None
    };

    let mut payload = serde_json::json!({
        "profile_name": name,
        "profile_index": display_index,
        "profile_count": slots.len(),
        "active_slots": slots.iter().map(|s| s + 1).collect::<Vec<u8>>(),
        "duration": cfg.duration,
    });

    if let Some(d) = dpi_x {
        payload["dpi"] = serde_json::json!(d);
    }
    // X/Y 独立时额外带 Y 值，OSD 端显示 "1200 x 1600"
    if let Some(y) = dpi_y {
        payload["dpi_y"] = serde_json::json!(y);
        payload["dpi_xy"] = serde_json::json!(true);
    }
    if cfg.show_battery {
        if let Some(b) = battery {
            payload["battery"] = serde_json::json!(b.percent);
            payload["charging"] = serde_json::json!(b.charging);
        }
    }
    payload
}

/// 推送到 OSD 服务
fn push_osd(url: &str, payload: &serde_json::Value) -> Result<(), String> {
    let endpoint = format!("{}/state", url.trim_end_matches('/'));
    let body = serde_json::to_string(payload).map_err(|e| e.to_string())?;

    match ureq::post(&endpoint)
        .timeout(std::time::Duration::from_secs(3))
        .set("Content-Type", "application/json; charset=utf-8")
        .send_string(&body)
    {
        Ok(resp) => {
            let text = resp.into_string().unwrap_or_default();
            host_log(2, &format!("[osd] 推送成功: {text}"));
            Ok(())
        }
        Err(e) => {
            let msg = format!("[osd] 推送失败: {e}");
            host_log(1, &msg);
            Err(msg)
        }
    }
}

/// 槽位名称缓存：槽名极少变化，缓存避免每次切换都读 3 次
static NAME_CACHE: Mutex<Option<([String; 3], std::time::Instant)>> = Mutex::new(None);

/// 电量缓存：读失败时用上次的值兜底（电量不会突变，比显示空白好）
static LAST_BATTERY: Mutex<Option<hid::BatteryInfo>> = Mutex::new(None);

/// 取槽位名称（带 30 秒缓存）
fn get_slot_names(mouse: &hid::Mouse) -> [String; 3] {
    if let Ok(g) = NAME_CACHE.lock() {
        if let Some((names, at)) = g.as_ref() {
            if at.elapsed() < std::time::Duration::from_secs(30) {
                return names.clone();
            }
        }
    }
    let names = mouse.read_all_slot_names();
    if let Ok(mut g) = NAME_CACHE.lock() {
        *g = Some((names.clone(), std::time::Instant::now()));
    }
    names
}

/// 执行一次切换：读当前 → 算下一个 → 切换 → 重读 → 推送
///
/// 性能优化：
/// - 槽名走缓存（30 秒）
/// - 重读用「截止时间 + 索引校验」而不是固定次数，通常 1~2 次即命中
/// - 电量读取很快（~40ms），同步读，保证 OSD 一次显示完整信息
fn do_switch(cfg: &Config, explicit_target: Option<u8>) -> Result<serde_json::Value, String> {
    let mouse = hid::Mouse::open()?;

    // 连续快速触发时设备可能还在处理上一条命令，只回空帧。
    // 外层再兜一层重试，避免一次失败就整个切换失败。
    let mut before = None;
    let mut last_err = String::new();
    for attempt in 0..3 {
        match mouse.read_profile() {
            Ok(p) => {
                before = Some(p);
                break;
            }
            Err(e) => {
                last_err = e;
                std::thread::sleep(std::time::Duration::from_millis(120 + attempt * 120));
            }
        }
    }
    let before = before.ok_or_else(|| {
        let msg = format!("读取当前配置失败: {last_err}");
        host_log(0, &msg);
        msg
    })?;
    let names = get_slot_names(&mouse);

    let target = match explicit_target {
        Some(t) => t,
        None => next_slot(before.profile_index, cfg),
    };

    let already = target == before.profile_index;
    if !already {
        mouse.switch_profile(target)?;
        // 给固件一点时间让新配置生效；下面的重读循环会兜住未就绪的情况
        std::thread::sleep(std::time::Duration::from_millis(80));
    }

    // 必须重新读取：每个槽的 DPI / X-Y 独立标志都不同，
    // 直接复用 before 会导致显示上一个槽的数据。
    // 读到 profile_index 与目标一致才算成功。
    let after = if already {
        before.clone()
    } else {
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(1500);
        let mut got = None;
        while std::time::Instant::now() < deadline {
            match mouse.read_profile() {
                Ok(p) if p.profile_index == target => {
                    got = Some(p);
                    break;
                }
                Ok(_) => std::thread::sleep(std::time::Duration::from_millis(40)),
                Err(_) => std::thread::sleep(std::time::Duration::from_millis(60)),
            }
        }
        match got {
            Some(p) => p,
            None => {
                host_log(
                    1,
                    &format!("[switch] 切换后未能读到槽 {target} 的配置，降级为只显示 X 轴 DPI"),
                );
                // 拿不到新槽数据时，绝不能沿用旧槽的 Y 轴设置——
                // 那正是「日常显示成 1200 x 1600」的成因。
                // 宁可少显示 Y，也不要显示错的。
                let mut p = before.clone();
                p.profile_index = target;
                p.axis_y_enabled = false;
                p
            }
        }
    };

    // 电量：读取很快（~40ms），直接同步读，保证 OSD 一次显示完整信息。
    // 连续快速触发时偶尔读不到，用上次的缓存值兜底（电量不会突变）。
    let battery = if cfg.show_battery {
        match mouse.read_battery() {
            Ok(b) => {
                if let Ok(mut g) = LAST_BATTERY.lock() {
                    *g = Some(b.clone());
                }
                Some(b)
            }
            Err(e) => {
                host_log(1, &format!("[battery] 读取失败，用缓存值: {e}"));
                LAST_BATTERY.lock().ok().and_then(|g| g.clone())
            }
        }
    } else {
        None
    };

    let payload = build_osd_payload(&after, &names, battery, cfg);

    // 推送 OSD
    let osd_result = push_osd(&cfg.osd_url, &payload);

    Ok(serde_json::json!({
        "from": before.profile_index,
        "to": target,
        "name": payload.get("profile_name"),
        "battery": payload.get("battery"),
        "osd_pushed": osd_result.is_ok(),
        "osd_error": osd_result.err(),
    }))
}

// ---------------------------------------------------------------- 配置持久化

/// 配置文件路径：%APPDATA%/air-icon-launcher/plugin-data/com.air.mchose.profile/config.json
fn config_path() -> std::path::PathBuf {
    let base = std::env::var("APPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    base.join("air-icon-launcher")
        .join("plugin-data")
        .join("com.air.mchose.profile")
        .join("config.json")
}

fn load_config() -> Config {
    let path = config_path();
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<Config>(&text).unwrap_or_else(|e| {
            host_log(0, &format!("[config] 解析失败，用默认值: {e}"));
            Config::default()
        }),
        Err(_) => Config::default(),
    }
}

fn save_config(cfg: &Config) -> Result<(), String> {
    let path = config_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("写入配置失败: {e}"))?;
    Ok(())
}

/// 注册全局热键：按下时触发一次轮换
fn setup_hotkey(cfg: &Config) {
    if !cfg.hotkey_enabled {
        hotkey::stop();
        host_log(2, "[hotkey] 已禁用");
        return;
    }
    let Some((vk, mods)) = hotkey::parse_hotkey(&cfg.hotkey) else {
        host_log(0, &format!("[hotkey] 无法解析热键: {}", cfg.hotkey));
        return;
    };

    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let ok = hotkey::start(vk, mods, tx);

    if !ok {
        host_log(
            0,
            &format!(
                "[hotkey] 注册失败: {} (vk=0x{vk:02X}, mods={mods}) —— 可能被其他程序占用",
                cfg.hotkey
            ),
        );
        return;
    }

    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            host_log(2, "[hotkey] 触发切换");
            let cfg = match STATE.lock() {
                Ok(g) => g.as_ref().map(|s| s.config.clone()).unwrap_or_default(),
                Err(_) => Config::default(),
            };
            match do_switch(&cfg, None) {
                Ok(v) => host_log(
                    2,
                    &format!("[hotkey] 切换成功: {}", serde_json::to_string(&v).unwrap_or_default()),
                ),
                Err(e) => host_log(0, &format!("[hotkey] 切换失败: {e}")),
            }
        }
    });

    host_log(2, &format!("[hotkey] 已注册: {}", cfg.hotkey));
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
    // 从磁盘加载配置（首次运行用默认值）
    let cfg = load_config();

    if let Ok(mut guard) = STATE.lock() {
        *guard = Some(PluginState {
            user_data: vt.user_data as usize,
            log_fn: Some(vt.log),
            host_invoke_fn: Some(vt.host_invoke),
            config: cfg.clone(),
        });
    }
    host_log(2, &format!("air_mchose_profile initialized, config: {cfg:?}"));

    // 自动注册全局热键
    setup_hotkey(&cfg);
    0
}

#[no_mangle]
pub extern "C" fn air_plugin_invoke(
    method: *const c_char,
    args_json: *const c_char,
) -> *mut c_char {
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

    let cfg = match STATE.lock() {
        Ok(g) => g.as_ref().map(|s| s.config.clone()).unwrap_or_default(),
        Err(_) => Config::default(),
    };

    let result = match method.as_str() {
        // 读取状态：当前配置、名称、电量
        "status" => match hid::Mouse::open() {
            Ok(m) => match m.read_profile() {
                Ok(p) => {
                    let names = m.read_all_slot_names();
                    let battery = m.read_battery().ok();
                    Ok(serde_json::json!({
                        "profile_index": p.profile_index,
                        "profile_names": names,
                        "dpi_stages": p.dpi_stages,
                        "dpi_count": p.dpi_count,
                        "active_dpi_stage": p.active_dpi_stage,
                        "report_rate_hz": p.report_rate_hz,
                        "battery": battery.as_ref().map(|b| b.percent),
                        "charging": battery.as_ref().map(|b| b.charging),
                    }))
                }
                Err(e) => Err(e),
            },
            Err(e) => Err(e),
        },

        // 轮换到下一个
        "next" => do_switch(&cfg, None),

        // 指定切换到某个槽位
        "switch" => {
            let target = args.get("index").and_then(|v| v.as_u64()).map(|v| v as u8);
            match target {
                Some(t) if t < 3 => do_switch(&cfg, Some(t)),
                _ => Err("index 必须是 0..2".into()),
            }
        }

        // 获取/更新配置
        "get_config" => Ok(serde_json::to_value(&cfg).unwrap_or_default()),
        "set_config" => {
            let mut new_cfg = cfg.clone();
            if let Some(m) = args.get("mode").and_then(|v| v.as_str()) {
                if m == "cycle" || m == "pair" {
                    new_cfg.mode = m.to_string();
                }
            }
            if let Some(arr) = args.get("active_slots").and_then(|v| v.as_array()) {
                new_cfg.active_slots = arr
                    .iter()
                    .filter_map(|v| v.as_u64())
                    .filter(|&v| v < 3)
                    .map(|v| v as u8)
                    .collect();
            }
            if let Some(arr) = args.get("pair").and_then(|v| v.as_array()) {
                let p: Vec<u8> = arr
                    .iter()
                    .filter_map(|v| v.as_u64())
                    .filter(|&v| v < 3)
                    .map(|v| v as u8)
                    .collect();
                if p.len() == 2 {
                    new_cfg.pair = p;
                }
            }
            if let Some(u) = args.get("osd_url").and_then(|v| v.as_str()) {
                new_cfg.osd_url = u.to_string();
            }
            if let Some(d) = args.get("duration").and_then(|v| v.as_f64()) {
                new_cfg.duration = d as f32;
            }
            if let Some(b) = args.get("show_battery").and_then(|v| v.as_bool()) {
                new_cfg.show_battery = b;
            }
            if let Some(h) = args.get("hotkey").and_then(|v| v.as_str()) {
                if hotkey::parse_hotkey(h).is_none() {
                    return err_envelope(
                        "INVALID_INPUT",
                        &format!("无法解析热键 '{h}'，示例：ctrl+shift+m / alt+f9"),
                    )
                    .into_raw();
                }
                new_cfg.hotkey = h.to_string();
            }
            if let Some(e) = args.get("hotkey_enabled").and_then(|v| v.as_bool()) {
                new_cfg.hotkey_enabled = e;
            }
            // 持久化到磁盘
            if let Err(e) = save_config(&new_cfg) {
                return err_envelope("SAVE_FAILED", &e).into_raw();
            }
            if let Ok(mut g) = STATE.lock() {
                if let Some(st) = g.as_mut() {
                    st.config = new_cfg.clone();
                }
            }
            host_log(2, &format!("[config] 已更新并保存: {new_cfg:?}"));
            // 热键配置变化后重新注册
            setup_hotkey(&new_cfg);
            Ok(serde_json::to_value(&new_cfg).unwrap_or_default())
        }

        // 热键状态
        "hotkey_status" => Ok(serde_json::json!({
            "running": hotkey::is_running(),
            "spec": cfg.hotkey,
            "enabled": cfg.hotkey_enabled,
        })),

        // ---- 设置界面：读取全部配置项 ----
        "settings.get" => Ok(serde_json::to_value(&cfg).unwrap_or_default()),

        // ---- 设置界面：写入单项或多项 ----
        "settings.set" => {
            let mut new_cfg = cfg.clone();
            if let Some(h) = args.get("hotkey").and_then(|v| v.as_str()) {
                if hotkey::parse_hotkey(h).is_none() {
                    return err_envelope(
                        "INVALID_INPUT",
                        &format!("无法解析热键 '{h}'，示例：ctrl+shift+m / alt+f9"),
                    )
                    .into_raw();
                }
                new_cfg.hotkey = h.to_string();
            }
            if let Some(m) = args.get("mode").and_then(|v| v.as_str()) {
                if m == "cycle" || m == "pair" {
                    new_cfg.mode = m.to_string();
                }
            }
            if let Some(arr) = args.get("active_slots").and_then(|v| v.as_array()) {
                let slots: Vec<u8> = arr
                    .iter()
                    .filter_map(|v| v.as_u64())
                    .filter(|&v| v < 3)
                    .map(|v| v as u8)
                    .collect();
                if !slots.is_empty() {
                    new_cfg.active_slots = slots;
                }
            }
            if let Some(arr) = args.get("pair").and_then(|v| v.as_array()) {
                let p: Vec<u8> = arr
                    .iter()
                    .filter_map(|v| v.as_u64())
                    .filter(|&v| v < 3)
                    .map(|v| v as u8)
                    .collect();
                if p.len() == 2 {
                    new_cfg.pair = p;
                }
            }
            if let Some(u) = args.get("osd_url").and_then(|v| v.as_str()) {
                new_cfg.osd_url = u.to_string();
            }
            if let Some(d) = args.get("duration").and_then(|v| v.as_f64()) {
                new_cfg.duration = d as f32;
            }
            if let Some(b) = args.get("show_battery").and_then(|v| v.as_bool()) {
                new_cfg.show_battery = b;
            }
            if let Some(e) = args.get("hotkey_enabled").and_then(|v| v.as_bool()) {
                new_cfg.hotkey_enabled = e;
            }

            if let Err(e) = save_config(&new_cfg) {
                return err_envelope("SAVE_FAILED", &e).into_raw();
            }
            if let Ok(mut g) = STATE.lock() {
                if let Some(st) = g.as_mut() {
                    st.config = new_cfg.clone();
                }
            }
            setup_hotkey(&new_cfg);
            host_log(2, &format!("[settings] 已保存: {new_cfg:?}"));
            Ok(serde_json::to_value(&new_cfg).unwrap_or_default())
        }

        // ---- 读取槽位名称（供设置界面展示）----
        "slot_names" => match hid::Mouse::open() {
            Ok(m) => {
                let names = m.read_all_slot_names();
                Ok(serde_json::json!({ "names": names }))
            }
            Err(e) => Err(e),
        },

        // 测试 OSD 连通性
        "test_osd" => {
            let payload = serde_json::json!({
                "profile_name": "连接测试",
                "profile_index": 1,
                "profile_count": 3,
                "active_slots": [1, 2, 3],
                "dpi": 1600,
                "battery": 85,
                "duration": 2.0,
            });
            push_osd(&cfg.osd_url, &payload).map(|_| serde_json::json!({ "pushed": true }))
        }

        other => Err(format!("Unknown method '{other}'")),
    };

    match result {
        Ok(v) => ok_envelope(v).into_raw(),
        Err(e) => err_envelope("PLUGIN_ERROR", &e).into_raw(),
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
    host_log(1, &format!("on_event: {raw}"));
}

#[no_mangle]
pub extern "C" fn air_plugin_free_string(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    unsafe {
        drop(CString::from_raw(ptr));
    }
}

#[no_mangle]
pub extern "C" fn air_plugin_shutdown() {
    host_log(2, "air_mchose_profile shutdown");
    if let Ok(mut g) = STATE.lock() {
        *g = None;
    }
}
