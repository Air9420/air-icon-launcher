//! 极简 obs-websocket v5 客户端（阻塞式，跑在独立线程）。
//!
//! 只做隐私虚化需要的三件事：
//! - 握手（含 challenge/salt 认证）
//! - `SetSourceFilterEnabled` —— 开关采集源上的模糊滤镜
//! - `SetCurrentProgramScene` —— 备选方案，切到专用「隐私场景」
//!
//! 协议参考：obs-websocket 5.x `protocol.md`。
//! op: 0 Hello / 1 Identify / 2 Identified / 6 Request / 7 RequestResponse / 9 RequestBatch

use std::net::TcpStream;
use std::sync::mpsc::{Receiver, Sender};
use std::time::{Duration, Instant};

use base64::Engine;
use sha2::{Digest, Sha256};
use tungstenite::{Message, WebSocket};

use crate::audio::LogFn;

type Ws = WebSocket<tungstenite::stream::MaybeTlsStream<TcpStream>>;

#[derive(Debug, Clone)]
pub struct ObsConfig {
    pub url: String,
    pub password: String,
    /// 虚化实现方式：`filter` 开关滤镜 | `scene` 切换场景
    pub mode: String,
    /// 采集源名（滤镜模式）
    pub source: String,
    /// 滤镜名（滤镜模式）
    pub filter: String,
    /// 隐私场景名（场景模式）
    pub privacy_scene: String,
    /// 正常场景名（场景模式切回时使用，空 = 记录进入隐私前的场景）
    pub normal_scene: String,
}

impl Default for ObsConfig {
    fn default() -> Self {
        Self {
            url: "ws://192.168.31.66:4455".into(),
            password: String::new(),
            mode: "blur".into(),
            source: "视频采集设备 (V4L2)".into(),
            filter: "隐私虚化".into(),
            privacy_scene: "隐私".into(),
            normal_scene: String::new(),
        }
    }
}

/// 发往 OBS 线程的指令。
#[derive(Debug, Clone)]
pub enum ObsCmd {
    /// 目标虚化状态（true = 虚化）
    Blur(bool),
    /// 手动重连
    Reconnect,
    /// 停止线程
    Shutdown,
}

fn sha256_b64(input: &str) -> String {
    let digest = Sha256::digest(input.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(digest)
}

/// obs-websocket v5 认证串：base64(sha256(base64(sha256(password + salt)) + challenge))
pub fn auth_string(password: &str, salt: &str, challenge: &str) -> String {
    let secret = sha256_b64(&format!("{password}{salt}"));
    sha256_b64(&format!("{secret}{challenge}"))
}

struct Session {
    ws: Ws,
    next_id: u64,
}

impl Session {
    fn connect(cfg: &ObsConfig) -> Result<Self, String> {
        let (ws, _resp) = tungstenite::connect(cfg.url.as_str())
            .map_err(|e| format!("连接 {} 失败: {e}", cfg.url))?;
        let mut s = Session { ws, next_id: 1 };
        s.handshake(cfg)?;
        Ok(s)
    }

    fn read_json(&mut self, timeout: Duration) -> Result<serde_json::Value, String> {
        // tungstenite 的阻塞读没有超时参数，靠 socket 读超时控制
        if let tungstenite::stream::MaybeTlsStream::Plain(tcp) = self.ws.get_mut() {
            let _ = tcp.set_read_timeout(Some(timeout));
        }
        loop {
            match self.ws.read() {
                Ok(Message::Text(t)) => {
                    return serde_json::from_str(&t)
                        .map_err(|e| format!("OBS 返回非法 JSON: {e}"));
                }
                Ok(Message::Binary(b)) => {
                    return serde_json::from_slice(&b)
                        .map_err(|e| format!("OBS 返回非法二进制 JSON: {e}"));
                }
                Ok(Message::Ping(p)) => {
                    let _ = self.ws.send(Message::Pong(p));
                }
                Ok(Message::Close(_)) => return Err("OBS 主动关闭连接".into()),
                Ok(_) => continue,
                Err(tungstenite::Error::Io(e))
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut =>
                {
                    return Err("timeout".into());
                }
                Err(e) => return Err(format!("读取 OBS 消息失败: {e}")),
            }
        }
    }

    fn handshake(&mut self, cfg: &ObsConfig) -> Result<(), String> {
        let hello = self.read_json(Duration::from_secs(5))?;
        let op = hello.get("op").and_then(|v| v.as_i64()).unwrap_or(-1);
        if op != 0 {
            return Err(format!("期望 Hello(op 0)，实际 op {op}"));
        }
        let d = hello.get("d").cloned().unwrap_or_default();
        let rpc = d.get("rpcVersion").and_then(|v| v.as_i64()).unwrap_or(1);

        let mut identify = serde_json::json!({
            "rpcVersion": rpc,
            "eventSubscriptions": 0,
        });

        if let Some(auth) = d.get("authentication") {
            let salt = auth.get("salt").and_then(|v| v.as_str()).unwrap_or("");
            let challenge = auth.get("challenge").and_then(|v| v.as_str()).unwrap_or("");
            if cfg.password.is_empty() {
                return Err("OBS 要求密码，但插件未配置".into());
            }
            identify["authentication"] = serde_json::json!(auth_string(&cfg.password, salt, challenge));
        }

        let msg = serde_json::json!({ "op": 1, "d": identify });
        self.ws
            .send(Message::Text(msg.to_string().into()))
            .map_err(|e| format!("发送 Identify 失败: {e}"))?;

        let resp = self.read_json(Duration::from_secs(5))?;
        let op = resp.get("op").and_then(|v| v.as_i64()).unwrap_or(-1);
        if op != 2 {
            return Err(format!("Identify 被拒绝（op {op}）: {resp}"));
        }
        Ok(())
    }

    /// 发一条 Request 并等它的 RequestResponse。返回 `responseData`。
    fn request(
        &mut self,
        kind: &str,
        data: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let id = format!("sb-{}", self.next_id);
        self.next_id += 1;
        let msg = serde_json::json!({
            "op": 6,
            "d": { "requestType": kind, "requestId": id, "requestData": data }
        });
        self.ws
            .send(Message::Text(msg.to_string().into()))
            .map_err(|e| format!("发送 {kind} 失败: {e}"))?;

        let deadline = Instant::now() + Duration::from_secs(4);
        while Instant::now() < deadline {
            let v = match self.read_json(Duration::from_secs(2)) {
                Ok(v) => v,
                Err(e) if e == "timeout" => continue,
                Err(e) => return Err(e),
            };
            let op = v.get("op").and_then(|x| x.as_i64()).unwrap_or(-1);
            if op != 7 {
                // 事件或别的响应，跳过
                continue;
            }
            let d = v.get("d").cloned().unwrap_or_default();
            if d.get("requestId").and_then(|x| x.as_str()) != Some(id.as_str()) {
                continue;
            }
            if let Some(status) = d.get("requestStatus") {
                if status.get("result").and_then(|x| x.as_bool()).unwrap_or(false) {
                    return Ok(d.get("responseData").cloned().unwrap_or_default());
                }
                let code = status.get("code").and_then(|x| x.as_i64()).unwrap_or(0);
                let comment = status
                    .get("comment")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                return Err(format!("{kind} 失败 code {code}: {comment}"));
            }
            return Ok(d.get("responseData").cloned().unwrap_or_default());
        }
        Err(format!("{kind} 超时"))
    }
}

/// OBS 侧状态机：按 `Blur(bool)` 指令做幂等下发。
pub struct ObsWorker {
    cfg: ObsConfig,
    session: Option<Session>,
    /// 已经下发的状态；None = 未知（重连后要重新同步）
    applied: Option<bool>,
    /// 进入隐私前的场景（场景模式切回用）
    saved_scene: Option<String>,
    /// 进入隐私前的源变换（transform 模式还原用）
    saved_transform: Option<serde_json::Value>,
}

impl ObsWorker {
    pub fn new(cfg: ObsConfig) -> Self {
        Self {
            cfg,
            session: None,
            applied: None,
            saved_scene: None,
            saved_transform: None,
        }
    }

    fn ensure_session(&mut self, log: &LogFn) -> Result<&mut Session, String> {
        if self.session.is_none() {
            match Session::connect(&self.cfg) {
                Ok(s) => {
                    log(2, format!("[obs] 已连接 {}", self.cfg.url));
                    self.session = Some(s);
                    // 重连后真实状态未知，强制下次下发
                    self.applied = None;
                }
                Err(e) => {
                    log(3, format!("[obs] {e}"));
                    return Err(e);
                }
            }
        }
        Ok(self.session.as_mut().expect("session just set"))
    }


    fn apply_scene(&mut self, on: bool, log: &LogFn) -> Result<(), String> {
        let cfg = self.cfg.clone();
        if on {
            // 先记住当前节目场景，退出隐私时切回
            if self.saved_scene.is_none() {
                if let Ok(session) = self.ensure_session(log) {
                    if let Ok(d) = session.request("GetCurrentProgramScene", serde_json::json!({})) {
                        self.saved_scene = d
                            .get("currentProgramSceneName")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                    }
                }
            }
            let target = cfg.privacy_scene.clone();
            let session = self.ensure_session(log)?;
            session.request(
                "SetCurrentProgramScene",
                serde_json::json!({ "sceneName": target }),
            )?;
            log(2, format!("[obs] 切到隐私场景 '{target}'"));
        } else {
            let target = if cfg.normal_scene.is_empty() {
                self.saved_scene.clone().unwrap_or_default()
            } else {
                cfg.normal_scene.clone()
            };
            if target.is_empty() {
                log(3, "[obs] 无可用回切场景，跳过".into());
                return Ok(());
            }
            let session = self.ensure_session(log)?;
            session.request(
                "SetCurrentProgramScene",
                serde_json::json!({ "sceneName": target }),
            )?;
            log(2, format!("[obs] 切回场景 '{target}'"));
        }
        Ok(())
    }

    /// 在采集源上创建模糊滤镜（若已存在则直接返回）。
    ///
    /// OBS 内置模糊滤镜的 kind 是 `blur_filter_v1`；先向 OBS 查一遍
    /// `GetSourceFilterKindList`，确认它真的可用再创建，避免写死一个不存在的 id。
    pub fn create_filter(
        &mut self,
        kind_hint: &str,
        log: &LogFn,
    ) -> Result<serde_json::Value, String> {
        let source = self.cfg.source.clone();
        let filter = self.cfg.filter.clone();
        let session = self.ensure_session(log)?;

        let existing = session
            .request(
                "GetSourceFilterList",
                serde_json::json!({ "sourceName": source }),
            )
            .unwrap_or_default();
        if let Some(arr) = existing.get("filters").and_then(|v| v.as_array()) {
            if arr
                .iter()
                .any(|f| f.get("filterName").and_then(|n| n.as_str()) == Some(filter.as_str()))
            {
                return Ok(serde_json::json!({
                    "created": false,
                    "reason": "滤镜已存在",
                    "filter": filter,
                }));
            }
        }

        let kinds = session
            .request("GetSourceFilterKindList", serde_json::json!({}))
            .unwrap_or_default();
        let available: Vec<String> = kinds
            .get("sourceFilterKinds")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|k| k.as_str())
                    .map(|s| s.to_string())
                    .collect()
            })
            .unwrap_or_default();

        // 候选 kind：先试调用方给的，再试已知的模糊 id，最后在可用列表里找。
        //
        // 不能只看 `GetSourceFilterKindList`：某些发行版的 OBS 会把内置滤镜
        // 注册成列表里查不到的名字，而 `CreateSourceFilter` 用对 id 照样成功。
        // 所以顺序是「先按候选真建一次，失败再换下一个」。
        let mut candidates: Vec<String> = Vec::new();
        for c in [kind_hint, "blur_filter_v1", "blur_filter", "obs_blur_filter"] {
            if !c.is_empty() && !candidates.iter().any(|x| x == c) {
                candidates.push(c.to_string());
            }
        }
        for k in &available {
            if k.contains("blur") && !candidates.iter().any(|x| x == k) {
                candidates.push(k.clone());
            }
        }

        let mut last_err = String::new();
        for kind in &candidates {
            match session.request(
                "CreateSourceFilter",
                serde_json::json!({
                    "sourceName": source,
                    "filterName": filter,
                    "filterKind": kind,
                    "filterSettings": {},
                }),
            ) {
                Ok(_) => {
                    log(
                        2,
                        format!("[obs] 已创建滤镜 '{source}/{filter}'（kind {kind}）"),
                    );
                    return Ok(serde_json::json!({
                        "created": true,
                        "filter": filter,
                        "kind": kind,
                    }));
                }
                Err(e) => {
                    last_err = e;
                    // 400 = 参数/类型错误，换下一个候选
                }
            }
        }

        Err(format!(
            "创建滤镜失败：{last_err}；可用 kind: {}",
            available.join(", ")
        ))
    }

    /// 调整滤镜强度。模糊滤镜用 `blur_radius`（单位见 OBS 界面）。
    pub fn set_filter_setting(
        &mut self,
        key: &str,
        value: serde_json::Value,
        log: &LogFn,
    ) -> Result<(), String> {
        let source = self.cfg.source.clone();
        let filter = self.cfg.filter.clone();
        let session = self.ensure_session(log)?;
        session.request(
            "SetSourceFilterSettings",
            serde_json::json!({
                "sourceName": source,
                "filterName": filter,
                "filterSettings": { key: value },
                "overlay": true,
            }),
        )?;
        Ok(())
    }


    /// 读某个输入源的设置（如音频采集源当前绑的设备名）。
    pub fn get_input_settings(
        &mut self,
        name: &str,
        log: &LogFn,
    ) -> Result<serde_json::Value, String> {
        let name = name.to_string();
        let session = self.ensure_session(log)?;
        session.request(
            "GetInputSettings",
            serde_json::json!({ "inputName": name }),
        )
    }

    /// 改某个输入源的设置。`overlay=true` 表示与现有设置合并而不是整体替换。
    pub fn set_input_settings(
        &mut self,
        name: &str,
        settings: serde_json::Value,
        log: &LogFn,
    ) -> Result<serde_json::Value, String> {
        let name = name.to_string();
        let session = self.ensure_session(log)?;
        session.request(
            "SetInputSettings",
            serde_json::json!({
                "inputName": name,
                "inputSettings": settings,
                "overlay": true,
            }),
        )?;
        Ok(serde_json::json!({ "input": name, "applied": settings }))
    }

    /// 删除采集源上的同名滤镜（清理旧版本留下的错误滤镜用）。
    pub fn remove_filter(&mut self, name: &str, log: &LogFn) -> Result<serde_json::Value, String> {
        let source = self.cfg.source.clone();
        let name = name.to_string();
        let session = self.ensure_session(log)?;
        session.request(
            "RemoveSourceFilter",
            serde_json::json!({ "sourceName": source, "filterName": name }),
        )?;
        Ok(serde_json::json!({ "removed": name, "source": source }))
    }


    /// 读某个滤镜的 kind 与参数，用来确认模糊滤镜是不是真的按预期配置了。
    pub fn filter_info(
        &mut self,
        name: &str,
        log: &LogFn,
    ) -> Result<serde_json::Value, String> {
        let source = self.cfg.source.clone();
        let name = name.to_string();
        let session = self.ensure_session(log)?;
        let list = session
            .request(
                "GetSourceFilterList",
                serde_json::json!({ "sourceName": source }),
            )
            .unwrap_or_default();
        let entry = list
            .get("filters")
            .and_then(|v| v.as_array())
            .and_then(|arr| {
                arr.iter()
                    .find(|f| f.get("filterName").and_then(|n| n.as_str()) == Some(name.as_str()))
                    .cloned()
            });
        Ok(serde_json::json!({
            "source": source,
            "filter": name,
            "found": entry.is_some(),
            "entry": entry,
        }))
    }

    /// 真模糊：优先用 Composite Blur 插件，退回内置 scale_filter。
    ///
    /// 为什么不再用 scale_filter 当主方案：它把画面缩到 32×18 再放大，
    /// 虽然数学上是模糊，但 OBS 的采样模式让它在 1080p 下几乎看不出来
    /// （实测「没任何效果」）。Composite Blur 是真 GPU 卷积模糊，效果明确。
    ///
    /// 顺序：
    /// 1. `obs_composite_blur`（Composite Blur 插件）—— 真模糊
    /// 2. `scale_filter`（OBS 内置）—— 兜底，效果弱
    fn apply_blur(&mut self, on: bool, log: &LogFn) -> Result<(), String> {
        let source = self.cfg.source.clone();
        let filter = self.cfg.filter.clone();
        let session = self.ensure_session(log)?;

        // 探测 Composite Blur 是否可用
        let kinds = session
            .request("GetSourceFilterKindList", serde_json::json!({}))
            .unwrap_or_default();
        let available: Vec<String> = kinds
            .get("sourceFilterKinds")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|k| k.as_str())
                    .map(|s| s.to_string())
                    .collect()
            })
            .unwrap_or_default();

        // 优先 Composite Blur（真高斯模糊），没装才退回内置 scale_filter。
        //
        // Composite Blur 的 shader 路径是「插件目录 / data / shaders / xxx.effect」。
        // Flatpak 下插件装在 config/obs-studio/plugins/，所以 shader 必须放在
        //   config/obs-studio/plugins/obs-composite-blur/data/shaders/
        // 少一层 data/ 就会全部 ENOENT，滤镜只剩黑屏（这个坑踩过）。
        let has_composite = available.iter().any(|k| k == "obs_composite_blur");
        let want_kind = if has_composite {
            "obs_composite_blur"
        } else {
            "scale_filter"
        };

        // 现有滤镜列表
        let existing = session
            .request(
                "GetSourceFilterList",
                serde_json::json!({ "sourceName": source }),
            )
            .unwrap_or_default();
        let entry = existing
            .get("filters")
            .and_then(|v| v.as_array())
            .and_then(|arr| {
                arr.iter()
                    .find(|f| f.get("filterName").and_then(|n| n.as_str()) == Some(filter.as_str()))
                    .cloned()
            });
        let cur_kind = entry
            .as_ref()
            .and_then(|e| e.get("filterKind"))
            .and_then(|k| k.as_str())
            .unwrap_or("")
            .to_string();

        // 想要的 kind 见上面的 want_kind（Composite Blur 优先，退回 scale_filter）

        if on {
            // 已存在但 kind 不对（比如旧版本建的 mask_filter / scale_filter），先删掉重建
            if entry.is_some() && cur_kind != want_kind {
                session
                    .request(
                        "RemoveSourceFilter",
                        serde_json::json!({ "sourceName": source, "filterName": filter }),
                    )
                    .ok();
                log(
                    2,
                    format!("[obs] 滤镜 kind 从 '{cur_kind}' 换成 '{want_kind}'"),
                );
            }

            let need_create = entry.is_none() || cur_kind != want_kind;
            if need_create {
                let settings = if has_composite {
                    serde_json::json!({
                        // Composite Blur 的真实键名（从 .so 字符串表确认）：
                        // blur_algorithm / blur_radius / blur_type / effect_mask
                        // 写成 "CompositeBlurFilter.Radius" 这种形式无效，
                        // 键名对不上 = 半径取默认 0 = 全黑。
                        "blur_algorithm": "Gaussian",
                        "blur_radius": 20.0,
                        "blur_type": 1,
                        "effect_mask": "None",
                    })
                } else {
                    serde_json::json!({
                        // scale_filter 兜底：真实键只有 resolution / sampling /
                        // multiplier，multiplier 0.02 = 缩到 2% 再放大。
                        "multiplier": 0.02,
                    })
                };
                session.request(
                    "CreateSourceFilter",
                    serde_json::json!({
                        "sourceName": source,
                        "filterName": filter,
                        "filterKind": want_kind,
                        "filterSettings": settings,
                    }),
                )?;
                log(
                    2,
                    format!("[obs] 已创建滤镜 '{filter}'（{want_kind}）"),
                );
            }

            // 必须显式启用：CreateSourceFilter 建出来的滤镜默认停用
            session.request(
                "SetSourceFilterEnabled",
                serde_json::json!({
                    "sourceName": source,
                    "filterName": filter,
                    "filterEnabled": true,
                }),
            )?;
            log(
                2,
                format!("[obs] 虚化开启（{want_kind}）"),
            );
        } else {
            session
                .request(
                    "SetSourceFilterEnabled",
                    serde_json::json!({
                        "sourceName": source,
                        "filterName": filter,
                        "filterEnabled": false,
                    }),
                )
                .ok();
            log(2, "[obs] 虚化关闭".into());
        }
        Ok(())
    }

    /// 列出 OBS 当前可用的滤镜 kind，用来确认插件有没有装上。
    pub fn filter_kinds(&mut self, log: &LogFn) -> Result<serde_json::Value, String> {
        let session = self.ensure_session(log)?;
        let kinds = session
            .request("GetSourceFilterKindList", serde_json::json!({}))
            .unwrap_or_default();
        let list: Vec<String> = kinds
            .get("sourceFilterKinds")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|k| k.as_str())
                    .map(|s| s.to_string())
                    .collect()
            })
            .unwrap_or_default();
        let has_composite = list.iter().any(|k| k == "obs_composite_blur");
        Ok(serde_json::json!({
            "has_composite_blur": has_composite,
            "kinds": list,
        }))
    }

    /// 直接覆盖滤镜的全部参数（调试与探测用）。
    ///
    /// 和 `set_filter_setting` 的区别：这个不走 overlay，整块替换，
    /// 用来试验「哪些键名是 OBS 真正认识的」。
    pub fn replace_filter_settings(
        &mut self,
        name: &str,
        settings: serde_json::Value,
        log: &LogFn,
    ) -> Result<serde_json::Value, String> {
        let source = self.cfg.source.clone();
        let name = name.to_string();
        let session = self.ensure_session(log)?;
        session.request(
            "SetSourceFilterSettings",
            serde_json::json!({
                "sourceName": source,
                "filterName": name,
                "filterSettings": settings,
                "overlay": false,
            }),
        )?;
        Ok(serde_json::json!({ "filter": name, "settings": settings }))
    }

    pub fn set_blur(&mut self, on: bool, log: &LogFn) -> Result<(), String> {
        if self.applied == Some(on) {
            return Ok(());
        }
        let result = match self.cfg.mode.as_str() {
            "scene" => self.apply_scene(on, log),
            _ => self.apply_blur(on, log),
        };
        match result {
            Ok(()) => {
                self.applied = Some(on);
                Ok(())
            }
            Err(e) => {
                // 连接断了：丢掉会话，下次指令重连
                self.session = None;
                self.applied = None;
                self.saved_transform = None;
                Err(e)
            }
        }
    }

    pub fn probe(&mut self, log: &LogFn) -> Result<serde_json::Value, String> {
        let source = self.cfg.source.clone();
        let session = self.ensure_session(log)?;
        let version = session
            .request("GetVersion", serde_json::json!({}))
            .unwrap_or_default();
        let scene = session
            .request("GetCurrentProgramScene", serde_json::json!({}))
            .unwrap_or_default();
        let filters = session
            .request(
                "GetSourceFilterList",
                serde_json::json!({ "sourceName": source }),
            )
            .unwrap_or_default();
        Ok(serde_json::json!({
            "connected": true,
            "obs_version": version.get("obsVersion"),
            "ws_version": version.get("obsWebSocketVersion"),
            "scene": scene.get("currentProgramSceneName"),
            "filters": filters.get("filters"),
            "blur_applied": self.applied,
        }))
    }

    /// 枚举 OBS 里真实存在的场景与输入源，用来填对 `obs_source` / 滤镜名。
    ///
    /// 同时列出每个输入的滤镜，方便确认「隐私虚化」滤镜是否已经建好。
    pub fn list_sources(&mut self, log: &LogFn) -> Result<serde_json::Value, String> {
        let session = self.ensure_session(log)?;
        let scenes = session
            .request("GetSceneList", serde_json::json!({}))
            .unwrap_or_default();
        let inputs = session
            .request("GetInputList", serde_json::json!({}))
            .unwrap_or_default();

        let scene_names: Vec<String> = scenes
            .get("scenes")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|s| s.get("sceneName").and_then(|n| n.as_str()))
                    .map(|s| s.to_string())
                    .collect()
            })
            .unwrap_or_default();

        let mut inputs_out = Vec::new();
        if let Some(arr) = inputs.get("inputs").and_then(|v| v.as_array()) {
            for inp in arr {
                let Some(name) = inp.get("inputName").and_then(|n| n.as_str()) else {
                    continue;
                };
                let kind = inp
                    .get("inputKind")
                    .and_then(|k| k.as_str())
                    .unwrap_or("")
                    .to_string();
                let filters = session
                    .request(
                        "GetSourceFilterList",
                        serde_json::json!({ "sourceName": name }),
                    )
                    .ok()
                    .and_then(|d| d.get("filters").cloned())
                    .unwrap_or(serde_json::Value::Array(vec![]));
                let filter_names: Vec<String> = filters
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|f| f.get("filterName").and_then(|n| n.as_str()))
                            .map(|s| s.to_string())
                            .collect()
                    })
                    .unwrap_or_default();
                inputs_out.push(serde_json::json!({
                    "name": name,
                    "kind": kind,
                    "filters": filter_names,
                }));
            }
        }

        Ok(serde_json::json!({
            "current_scene": scenes.get("currentProgramSceneName"),
            "scenes": scene_names,
            "inputs": inputs_out,
            "configured_source": self.cfg.source,
            "configured_filter": self.cfg.filter,
        }))
    }
}

/// OBS 线程：串行处理指令，断线后由下一条指令触发重连。
pub fn spawn_obs_worker(
    cfg: ObsConfig,
    rx: Receiver<ObsCmd>,
    log: LogFn,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut worker = ObsWorker::new(cfg);
        while let Ok(cmd) = rx.recv() {
            match cmd {
                ObsCmd::Blur(on) => {
                    if let Err(e) = worker.set_blur(on, &log) {
                        log(3, format!("[obs] 虚化下发失败: {e}"));
                    }
                }
                ObsCmd::Reconnect => {
                    worker.session = None;
                    worker.applied = None;
                    log(2, "[obs] 手动重连".into());
                }
                ObsCmd::Shutdown => break,
            }
        }
        log(2, "[obs] worker 退出".into());
    })
}

/// 供插件 invoke 直接调用的同步探测（不经过 worker 队列）。
pub fn probe_once(cfg: &ObsConfig) -> Result<serde_json::Value, String> {
    let mut w = ObsWorker::new(cfg.clone());
    let quiet: LogFn = std::sync::Arc::new(|_, _| {});
    w.probe(&quiet)
}

pub fn list_sources_once(cfg: &ObsConfig) -> Result<serde_json::Value, String> {
    let mut w = ObsWorker::new(cfg.clone());
    let quiet: LogFn = std::sync::Arc::new(|_, _| {});
    w.list_sources(&quiet)
}

pub fn ensure_filter_once(cfg: &ObsConfig, kind_hint: &str) -> Result<serde_json::Value, String> {
    let mut w = ObsWorker::new(cfg.clone());
    let quiet: LogFn = std::sync::Arc::new(|_, _| {});
    w.create_filter(kind_hint, &quiet)
}

pub fn send_cmd(tx: &Sender<ObsCmd>, cmd: ObsCmd) {
    let _ = tx.send(cmd);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_matches_reference_vector() {
        // obs-websocket 文档给出的计算方式，用固定输入交叉验证两级 sha256
        let secret = sha256_b64("supersecretmysalt");
        let expect = sha256_b64(&format!("{secret}challenge123"));
        assert_eq!(auth_string("supersecret", "mysalt", "challenge123"), expect);
        assert_eq!(secret.len(), 44); // base64 of 32 bytes
    }

    #[test]
    fn default_obs_config() {
        let c = ObsConfig::default();
        assert_eq!(c.mode, "blur");
        assert!(c.url.starts_with("ws://"));
    }
}
