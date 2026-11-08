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

/// 存活实例计数。
///
/// 同一个 DLL 被宿主加载两次时，Windows 的 `LoadLibraryW` 返回的是**同一个模块句柄**，
/// 两个「实例」其实是同一份静态变量。此时若旧实例的 `air_plugin_shutdown`
/// 无条件清空 `STATE`，就会把新实例刚 init 好的配置一起抹掉——
/// 表现为「改任一设置项就把其他设置重置成默认值」。
/// 用计数保证只有最后一个实例退出时才真正清理。
static LIVE_INSTANCES: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

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
    // 先取出回调再放锁：回调里若间接再进 STATE（或宿主那边阻塞）
    // 会与热键 worker 抢锁，长阻塞时表现为热键无响应。
    let (log_fn, user_data) = match STATE.lock() {
        Ok(g) => match g.as_ref() {
            Some(st) => (st.log_fn, st.user_data),
            None => (None, 0),
        },
        Err(_) => (None, 0),
    };
    if let Some(log_fn) = log_fn {
        if user_data != 0 {
            if let Ok(c) = CString::new(msg) {
                log_fn(user_data as *mut c_void, level, c.as_ptr());
            }
        }
    }
}

/// 文件日志写锁。
///
/// 两个实例（宿主重复加载同一 DLL 时其实是同一份静态变量，但 worker 线程
/// 与 UI 线程会并发写）同时 open+append，实测出现
/// `[[1794019556.1591794019556.159] L2] L 2...` 这种字节级交错的烂行。
static FILE_LOG_LOCK: Mutex<()> = Mutex::new(());

/// 追加写入 %TEMP%/mchose-profile-plugin.log（超过 256KB 时截断重建）
fn debug_file_log(level: i32, msg: &str) {
    use std::io::Write;
    let _guard = match FILE_LOG_LOCK.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
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

/// 最近一次成功切换到的槽位（本地缓存）。
///
/// 游戏运行时读不到当前槽位（ACE 把数据段过滤成 0），只能靠这个缓存推算下一个。
/// 只要切换命令的 ACK 能拿到，缓存就是准的。
/// **持久化到磁盘**：否则每次重启启动器都要先在桌面按一次热键才能建立缓存，
/// 而用户往往是先开游戏再发现按不动。
static LAST_KNOWN_SLOT: Mutex<Option<u8>> = Mutex::new(None);

/// 槽位缓存文件：与 config.json 同目录
fn slot_cache_path() -> std::path::PathBuf {
    config_path().with_file_name("last-slot.json")
}

fn load_slot_cache() {
    let Ok(text) = std::fs::read_to_string(slot_cache_path()) else {
        return;
    };
    if let Ok(v) = serde_json::from_str::<u8>(text.trim()) {
        if v <= 2 {
            if let Ok(mut g) = LAST_KNOWN_SLOT.lock() {
                *g = Some(v);
            }
            host_log(2, &format!("[slot] 已从磁盘恢复上次槽位: {v}"));
        }
    }
}

fn save_slot_cache(slot: u8) {
    if let Ok(mut g) = LAST_KNOWN_SLOT.lock() {
        *g = Some(slot);
    }
    let path = slot_cache_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&path, slot.to_string());
}

/// 执行一次切换：读当前 → 算下一个 → 切换 → 重读 → 推送
///
/// **游戏内降级（盲切）**：
/// ACE 反作弊在游戏运行时会把这个 HID 接口的数据段过滤成全 0，
/// 只放行帧头回显 —— 读命令返回 `[12, 67, 00, 00, ...]`，
/// 但切换命令 `0x11 0x58` 的 ACK 仍然完整（`[11, 58, <idx>, ...]`）。
/// 所以读不到当前槽位时，改用 `LAST_KNOWN_SLOT` 推算目标，直接发切换命令。
///
/// 性能优化：
/// - 槽名走缓存（30 秒）
/// - 重读用「截止时间 + 索引校验」而不是固定次数，通常 1~2 次即命中
/// - 电量读取很快（~40ms），同步读，保证 OSD 一次显示完整信息
fn do_switch(cfg: &Config, explicit_target: Option<u8>) -> Result<serde_json::Value, String> {
    let mouse = hid::Mouse::open()?;

    // 连续快速触发时设备可能还在处理上一条命令，只回空帧。
    // 外层再兜一层重试，避免一次失败就整个切换失败。
    let mut before: Option<hid::MouseProfile> = None;
    let mut read_blocked = false;
    let mut last_err = String::new();
    for attempt in 0..3 {
        match mouse.try_read_profile() {
            Ok(hid::ReadOutcome::Ok(p)) => {
                before = Some(p);
                break;
            }
            Ok(hid::ReadOutcome::NoData) => {
                // 帧头回来了但数据被抹 → 再试一次，仍如此就走盲切
                read_blocked = true;
                std::thread::sleep(std::time::Duration::from_millis(80));
            }
            Err(e) => {
                last_err = e;
                std::thread::sleep(std::time::Duration::from_millis(120 + attempt * 120));
            }
        }
    }

    // ---- 盲切路径：读不到当前槽位 ----
    if before.is_none() {
        let cached = LAST_KNOWN_SLOT.lock().ok().and_then(|g| *g);
        let Some(current) = cached.or(explicit_target) else {
            // 从没成功读过，也没有缓存，也没有显式目标：只能如实报错
            let msg = if read_blocked {
                format!("读不到鼠标当前配置（数据被过滤），且无本地槽位缓存。请先在桌面按一次热键建立缓存")
            } else {
                format!("读取当前配置失败: {last_err}")
            };
            host_log(0, &msg);
            return Err(msg);
        };

        let target = explicit_target.unwrap_or_else(|| next_slot(current, cfg));

        // 关键：切换命令的 ACK 是通的，直接发
        match mouse.switch_profile(target) {
            Ok(()) => {
                save_slot_cache(target);
                host_log(
                    1,
                    &format!(
                        "[switch] 读不到当前配置（数据被过滤），按本地缓存盲切: {current} → {target}"
                    ),
                );

                // 名字和电量走缓存：读名称同样会被过滤，读电量也一样
                let names = match NAME_CACHE.lock() {
                    Ok(g) => g.as_ref().map(|(n, _)| n.clone()).unwrap_or_default(),
                    Err(_) => Default::default(),
                };
                let names = if names.iter().all(|s| s.is_empty()) {
                    // 缓存空就试一次实时读（可能刚好没被过滤）
                    get_slot_names(&mouse)
                } else {
                    names
                };

                let battery = if cfg.show_battery {
                    LAST_BATTERY.lock().ok().and_then(|g| g.clone())
                } else {
                    None
                };

                // 构造一个最小 profile 只用于生成 payload（DPI 未知就不显示）
                let synthetic = hid::MouseProfile {
                    profile_index: target,
                    dpi_stages: [0; 6],
                    dpi_stages_y: [0; 6],
                    axis_y_enabled: false,
                    dpi_count: 0,
                    active_dpi_stage: 0,
                    report_rate_hz: 0,
                    debounce: 0,
                    sleep: 0,
                };
                let payload = build_osd_payload(&synthetic, &names, battery, cfg);
                let osd_result = push_osd(&cfg.osd_url, &payload);

                return Ok(serde_json::json!({
                    "from": current,
                    "to": target,
                    "name": payload.get("profile_name"),
                    "battery": payload.get("battery"),
                    "osd_pushed": osd_result.is_ok(),
                    "osd_error": osd_result.err(),
                    "blind": true,
                }));
            }
            Err(e) => {
                let msg = format!("盲切失败（目标 {target}）: {e}");
                host_log(0, &msg);
                return Err(msg);
            }
        }
    }

    let before = before.expect("上面已保证 Some");
    // 读成功 → 刷新缓存，并让缓存成为「真相」
    save_slot_cache(before.profile_index);
    let names = get_slot_names(&mouse);

    let target = match explicit_target {
        Some(t) => t,
        None => next_slot(before.profile_index, cfg),
    };

    let already = target == before.profile_index;
    if !already {
        mouse.switch_profile(target)?;
        save_slot_cache(target);
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
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        // 文件不存在 = 首次运行，用默认值合理
        Err(_) => return Config::default(),
    };
    match serde_json::from_str::<Config>(&text) {
        Ok(c) => c,
        Err(e) => {
            // 文件存在但解析失败（写坏 / 被截断）：先备份，避免下次保存把它彻底覆盖掉
            let bak = path.with_extension("json.corrupt");
            let _ = std::fs::write(&bak, &text);
            host_log(
                0,
                &format!(
                    "[config] 解析失败，用默认值: {e}（原文已备份到 {}）",
                    bak.display()
                ),
            );
            Config::default()
        }
    }
}

/// 原子写入配置。
///
/// 先写临时文件再 `rename` 覆盖：两个系统共用同一个 config.json 时，
/// 直接 `write` 存在被读到半截内容的窗口，读到坏 JSON 会退回默认值，
/// 随后再保存就把整套配置重置了。
fn save_config(cfg: &Config) -> Result<(), String> {
    let path = config_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;

    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &text).map_err(|e| format!("写入临时文件失败: {e}"))?;
    // Windows 上 rename 目标已存在时失败，先删再改名；失败就退回直接写。
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&path);
        if std::fs::rename(&tmp, &path).is_err() {
            let _ = std::fs::remove_file(&tmp);
            std::fs::write(&path, &text).map_err(|e| format!("写入配置失败: {e}"))?;
        }
    }
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

    // 上一轮 worker 若还在，先标记退出并等它结束，避免两个 worker 同时抢设备
    hotkey::wait_worker_exit();

    hotkey::mark_worker_alive();
    let handle = std::thread::spawn(move || {
        while rx.recv().is_ok() {
            let ch = hotkey::last_channel_name();
            host_log(2, &format!("[hotkey] 触发切换（来源: {ch}）"));
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
        hotkey::mark_worker_dead();
        host_log(2, "[hotkey] worker 退出");
    });
    hotkey::store_worker(handle);

    host_log(
        2,
        &format!(
            "[hotkey] 已注册: {}（通道: {}）",
            cfg.hotkey,
            hotkey::active_channels().join(" + ")
        ),
    );
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

    // 已初始化过（宿主重复加载同一 DLL）：只更新宿主回调，保留内存中的配置，
    // 避免用磁盘值覆盖掉尚未落盘的修改。
    let already = {
        let guard = match STATE.lock() {
            Ok(g) => g,
            Err(_) => return -3,
        };
        guard.is_some()
    };
    if already {
        if let Ok(mut guard) = STATE.lock() {
            if let Some(st) = guard.as_mut() {
                st.user_data = vt.user_data as usize;
                st.log_fn = Some(vt.log);
                st.host_invoke_fn = Some(vt.host_invoke);
            }
        }
        LIVE_INSTANCES.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        host_log(2, "[init] 重复加载同一实例，保留现有配置");
        // 重复 init 也要保证热键可用：旧 worker 可能已在 unload 时停掉。
        let cfg = match STATE.lock() {
            Ok(g) => g.as_ref().map(|s| s.config.clone()).unwrap_or_default(),
            Err(_) => Config::default(),
        };
        if !hotkey::is_running() {
            setup_hotkey(&cfg);
        }
        load_slot_cache();
        return 0;
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
    LIVE_INSTANCES.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    host_log(2, &format!("air_mchose_profile initialized, config: {cfg:?}"));

    // 恢复上次槽位：游戏内读不到当前槽位时靠它推算下一个，
    // 否则每次重启都得先在桌面按一次热键才能建立缓存。
    load_slot_cache();

    // 自动注册全局热键
    setup_hotkey(&cfg);
    0
}

#[no_mangle]
pub extern "C" fn air_plugin_invoke(
    method: *const c_char,
    args_json: *const c_char,
) -> *mut c_char {
    // 跨 FFI 边界绝不能 unwind：panic 逃出 extern "C" 是 UB，宿主会直接崩。
    // 统一在这里兜住，转成错误信封返回。
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        invoke_impl(method, args_json)
    }));
    match result {
        Ok(ptr) => ptr,
        Err(payload) => {
            let msg = panic_message(&payload);
            host_log(0, &format!("[invoke] panic: {msg}"));
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

    // 内存态优先；万一 STATE 为空（例如宿主重复加载导致被清理），
    // 回退到磁盘配置而不是 Config::default()。
    // 用默认值兜底会把整套默认配置写回磁盘，表现为「改一项就重置全部」。
    let cfg = match STATE.lock() {
        Ok(g) => match g.as_ref() {
            Some(s) => s.config.clone(),
            None => {
                host_log(1, "[invoke] STATE 为空，回退到磁盘配置");
                load_config()
            }
        },
        Err(_) => load_config(),
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

        // 热键状态 + 通道诊断
        "hotkey_status" => {
            let (h1, h2, h3, h4) = hotkey::channel_stats();
            Ok(serde_json::json!({
                "running": hotkey::is_running(),
                "spec": cfg.hotkey,
                "enabled": cfg.hotkey_enabled,
                "channels": hotkey::active_channels(),
                "hits": { "hook": h1, "hotkey": h2, "raw_input": h3, "poll": h4 },
                "last_channel": hotkey::last_channel_name(),
            }))
        }

        // ---- 设置界面：读取全部配置项 ----
        "settings.get" => Ok(serde_json::to_value(&cfg).unwrap_or_default()),

        // ---- 设置界面：写入单项或多项 ----
        // 以磁盘上的最新配置为基准做合并：多系统共用同一份 config.json 时，
        // 内存里的旧值可能已被另一个系统改过，用内存值当基准会互相覆盖。
        "settings.set" => {
            let mut new_cfg = load_config();
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
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let raw = unsafe { CStr::from_ptr(event_json) }
            .to_string_lossy()
            .into_owned();
        host_log(1, &format!("on_event: {raw}"));
    }));
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
    // 只有最后一个实例退出时才真正清理。
    // 宿主重复加载同一 DLL 时两个「实例」共用同一份静态变量，
    // 旧实例的 shutdown 不能把新实例的状态抹掉。
    let prev = LIVE_INSTANCES.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
    if prev > 1 {
        host_log(
            2,
            &format!("air_mchose_profile shutdown（仍有 {} 个实例存活，保留状态）", prev - 1),
        );
        return;
    }
    LIVE_INSTANCES.store(0, std::sync::atomic::Ordering::SeqCst);
    host_log(2, "air_mchose_profile shutdown");
    hotkey::stop();
    if let Ok(mut g) = STATE.lock() {
        *g = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg_pair() -> Config {
        let mut c = Config::default();
        c.mode = "pair".into();
        c.pair = vec![1, 2];
        c
    }

    fn cfg_cycle() -> Config {
        let mut c = Config::default();
        c.mode = "cycle".into();
        c.active_slots = vec![0, 1, 2];
        c
    }

    /// pair 模式在两个槽之间来回
    #[test]
    fn next_slot_pair_pingpong() {
        let c = cfg_pair();
        assert_eq!(next_slot(1, &c), 2);
        assert_eq!(next_slot(2, &c), 1);
    }

    /// cycle 模式按列表循环
    #[test]
    fn next_slot_cycle_wraps() {
        let c = cfg_cycle();
        assert_eq!(next_slot(0, &c), 1);
        assert_eq!(next_slot(1, &c), 2);
        assert_eq!(next_slot(2, &c), 0);
    }

    /// 当前槽位不在启用列表里 → 落到第一个
    #[test]
    fn next_slot_unknown_current_falls_to_first() {
        let c = cfg_pair();
        assert_eq!(next_slot(0, &c), 1);
    }

    /// 空列表时保持不动（避免除零 / 越界）
    #[test]
    fn next_slot_empty_keeps_current() {
        let mut c = cfg_cycle();
        c.active_slots.clear();
        assert_eq!(next_slot(2, &c), 2);
    }

    /// 盲切缓存：写入后能读回，且 next_slot 能据此推算
    #[test]
    fn blind_switch_cache_roundtrip() {
        *LAST_KNOWN_SLOT.lock().unwrap() = Some(1);
        let cached = LAST_KNOWN_SLOT.lock().unwrap().unwrap();
        assert_eq!(cached, 1);
        // 游戏内读不到当前槽位时，就是靠这个缓存推下一个
        assert_eq!(next_slot(cached, &cfg_pair()), 2);
        *LAST_KNOWN_SLOT.lock().unwrap() = None;
    }
}
