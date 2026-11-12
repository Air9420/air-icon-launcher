//! WASAPI 环回采集 + UDP 推流。
//!
//! 采集的是**默认播放设备**（USB 耳机 / 声卡）上正在播放的音频，
//! 也就是「用户耳朵听到的那一份」，因此不依赖采集卡的音频输入。
//!
//! 事件驱动 + 端点允许的最小周期，实测端到端 8 ms 量级（见 lan-audio 基准）。

use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::wire;

/// 跨线程日志：插件把宿主 log 回调包成这个，采集线程里也能打日志。
pub type LogFn = Arc<dyn Fn(i32, String) + Send + Sync>;

/// 采集来源：决定用哪条 WASAPI 路径打开流。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceKind {
    /// 默认/指定的**播放**端点环回（抓"耳朵听到的声音"）
    RenderLoopback,
    /// 指定**采集**端点（麦克风）
    CaptureDevice,
    /// 指定进程的环回（只抓某个程序输出的声音）
    ProcessLoopback,
}

impl SourceKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            SourceKind::RenderLoopback => "render",
            SourceKind::CaptureDevice => "capture",
            SourceKind::ProcessLoopback => "process",
        }
    }

    pub fn parse(s: &str) -> SourceKind {
        match s {
            "capture" => SourceKind::CaptureDevice,
            "process" => SourceKind::ProcessLoopback,
            _ => SourceKind::RenderLoopback,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PushConfig {
    /// 副机地址 IP:PORT
    pub dest: String,
    /// 端点名称子串；None = 系统默认
    pub device: Option<String>,
    /// 采集来源
    pub source: SourceKind,
    /// 进程环回时的目标进程名（如 "chrome.exe"）或 PID
    pub process: Option<String>,
    /// 线上采样率
    pub rate: u32,
    /// 每包帧数（240 帧 = 5 ms，单包在 MTU 内）
    pub frames_per_packet: u32,
    /// 请求的设备周期（ms）；0 = 端点最小值
    pub period_ms: f64,
    /// 空闲时补静音，保持副机时间轴连续
    pub keepalive: bool,
    /// 采集增益
    pub gain: f32,
}

impl Default for PushConfig {
    fn default() -> Self {
        Self {
            dest: "192.168.31.66:47800".into(),
            device: None,
            source: SourceKind::RenderLoopback,
            process: None,
            rate: 48000,
            frames_per_packet: 240,
            period_ms: 0.0,
            keepalive: true,
            gain: 1.0,
        }
    }
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct PushStats {
    pub running: bool,
    pub endpoint: String,
    pub mix_format: String,
    pub device_period_ms: f64,
    pub packets: u64,
    pub frames: u64,
    pub bytes: u64,
    pub silent_packets: u64,
    pub send_errors: u64,
    /// 采集引擎内部积压（ms），稳态应接近 0
    pub capture_lag_ms: f64,
    pub last_error: String,
}

#[cfg(windows)]
mod imp {
    use super::*;
    use wasapi::{
        AudioCaptureClient, AudioClient, DeviceEnumerator, Direction, Handle, SampleType, StreamMode,
        WaveFormat,
    };

    pub struct Capture {
        client: AudioClient,
        pub cap: AudioCaptureClient,
        pub h_event: Handle,
        pub blockalign: usize,
        pub buffer_frames: usize,
        pub ch: usize,
        pub rate: u32,
        pub bits: u16,
        pub sub: Option<SampleType>,
        pub endpoint: String,
        pub mix_desc: String,
        pub period_ms: f64,
        pub stream_start_abs_ns: u64,
        pub frames_emitted: u64,
    }

    /// 按名称子串挑端点。`dir` 决定枚举播放还是采集设备。
    fn pick_device(
        en: &DeviceEnumerator,
        want: Option<&str>,
        dir: Direction,
    ) -> Result<wasapi::Device, String> {
        let label = match dir {
            Direction::Render => "播放",
            Direction::Capture => "采集",
        };
        match want {
            None | Some("") => en
                .get_default_device(dir)
                .map_err(|e| format!("取默认{label}设备失败: {e}")),
            Some(sub) => {
                let coll = en
                    .get_device_collection(dir)
                    .map_err(|e| format!("枚举{label}设备失败: {e}"))?;
                let n = coll
                    .get_nbr_devices()
                    .map_err(|e| format!("设备数量读取失败: {e}"))?;
                let mut hits = Vec::new();
                for i in 0..n {
                    if let Ok(d) = coll.get_device_at_index(i) {
                        let name = d.get_friendlyname().unwrap_or_default();
                        if name.to_lowercase().contains(&sub.to_lowercase()) {
                            hits.push((name, d));
                        }
                    }
                }
                match hits.len() {
                    0 => Err(format!("没有匹配 '{sub}' 的{label}端点")),
                    1 => Ok(hits.remove(0).1),
                    _ => {
                        let names: Vec<String> = hits.iter().map(|(n, _)| n.clone()).collect();
                        Err(format!(
                            "'{sub}' 匹配到 {} 个{label}端点: {}",
                            hits.len(),
                            names.join(" / ")
                        ))
                    }
                }
            }
        }
    }

    /// 打开指定进程的环回采集客户端（Windows 10 2004+）。
    ///
    /// wasapi 0.27 已经内置 `AudioClient::new_application_loopback_client`，
    /// 不用自己拼 ActivateAudioInterfaceAsync + PROPVARIANT + 完成回调
    /// （那套手写版既长又容易在 windows 0.62 的 Ref<> 签名上翻车）。
    ///
    /// 注意该方法返回的 client 有几个限制（见 wasapi 文档）：
    /// - `get_mixformat` / `get_device_period` / `get_buffer_size` 不可用
    /// - 必须用 `Direction::Capture` + `ShareMode::Shared`
    /// - 因此不能走「读混音格式」那条路，得自己指定 WaveFormat
    fn open_process_loopback(target: &str) -> Result<(wasapi::AudioClient, String), String> {
        let pid = resolve_pid(target)?;
        let label = format!("进程 {target} (pid {pid})");
        let client = wasapi::AudioClient::new_application_loopback_client(pid, true)
            .map_err(|e| {
                format!(
                    "创建进程环回失败: {e}（需要 Windows 10 2004+，且目标进程正在播放音频）"
                )
            })?;
        Ok((client, label))
    }

    /// 把 "chrome.exe" / "chrome" / "12345" 解析成 PID。
    fn resolve_pid(target: &str) -> Result<u32, String> {
        let t = target.trim();
        if t.is_empty() {
            return Err("进程环回需要指定进程名或 PID".into());
        }
        if let Ok(pid) = t.parse::<u32>() {
            return Ok(pid);
        }
        let want = t.to_ascii_lowercase();
        let want = want.trim_end_matches(".exe");

        // 用 tasklist 枚举：不引额外 crate，且能拿到完整映像名
        let out = std::process::Command::new("tasklist")
            .args(["/FO", "CSV", "/NH"])
            .output()
            .map_err(|e| format!("执行 tasklist 失败: {e}"))?;
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            let cols: Vec<&str> = line.split("\",\"").collect();
            if cols.len() < 2 {
                continue;
            }
            let name = cols[0].trim_matches('"').to_ascii_lowercase();
            let name = name.trim_end_matches(".exe");
            if name == want {
                let pid_str = cols[1].trim_matches('"');
                if let Ok(pid) = pid_str.parse::<u32>() {
                    return Ok(pid);
                }
            }
        }
        Err(format!("找不到进程 '{target}'（用完整进程名，如 chrome.exe）"))
    }

    impl Capture {
        pub fn open(cfg: &PushConfig) -> Result<Self, String> {
            // initialize_mta 返回 Result<HRESULT>，失败也不致命（可能已在 MTA 里）
            let _ = wasapi::initialize_mta();
            let en = DeviceEnumerator::new().map_err(|e| format!("创建设备枚举器失败: {e}"))?;

            // 三种来源共用后面「取混音格式 → 初始化 → 事件句柄」的流程，
            // 区别只在 client 怎么来、采集方向是什么。
            //
            // - RenderLoopback：播放端点 + Direction::Capture（环回抓播放）
            // - CaptureDevice ：采集端点 + Direction::Capture（麦克风）
            // - ProcessLoopback：进程环回，用 ActivateAudioInterfaceAsync 造 client
            let (mut client, endpoint, capture_dir) = match cfg.source {
                SourceKind::RenderLoopback => {
                    let device = pick_device(&en, cfg.device.as_deref(), Direction::Render)?;
                    let name = device.get_friendlyname().unwrap_or_default();
                    let c = device
                        .get_iaudioclient()
                        .map_err(|e| format!("取 IAudioClient 失败: {e}"))?;
                    (c, name, Direction::Capture)
                }
                SourceKind::CaptureDevice => {
                    let device = pick_device(&en, cfg.device.as_deref(), Direction::Capture)?;
                    let name = device.get_friendlyname().unwrap_or_default();
                    let c = device
                        .get_iaudioclient()
                        .map_err(|e| format!("取 IAudioClient 失败: {e}"))?;
                    (c, name, Direction::Capture)
                }
                SourceKind::ProcessLoopback => {
                    let target = cfg.process.clone().unwrap_or_default();
                    let (c, name) = open_process_loopback(&target)?;
                    (c, name, Direction::Capture)
                }
            };
            // 进程环回模式有一堆 API 不可用（wasapi 文档明确列出）：
            // get_mixformat / get_device_period / get_buffer_size 都不可靠，
            // 所以这条路径直接指定格式和周期，不去问设备。
            let (cap_fmt, autoconvert, mix_desc, period_hns) =
                if cfg.source == SourceKind::ProcessLoopback {
                    let fmt = WaveFormat::new(
                        32,
                        32,
                        SampleType::Float,
                        cfg.rate as usize,
                        2,
                        None,
                    );
                    // 周期用 10 ms：进程环回不让我们查最小值，10 ms 是安全值
                    let hns = if cfg.period_ms > 0.0 {
                        (cfg.period_ms * 10_000.0) as i64
                    } else {
                        100_000
                    };
                    (fmt, true, format!("{0} Hz / 2 ch / f32（进程环回固定格式）", cfg.rate), hns)
                } else {
                    let mix = client
                        .get_mixformat()
                        .map_err(|e| format!("取混音格式失败: {e}"))?;
                    let mix_sub = mix.get_subformat().ok();
                    let mix_bits = mix.get_bitspersample();
                    let mix_ch = mix.get_nchannels() as usize;
                    let mix_rate = mix.get_samplespersec();
                    let desc =
                        format!("{mix_rate} Hz / {mix_ch} ch / {mix_bits} bit / {mix_sub:?}");

                    // 原生混音格式 = 引擎侧零转换 = 最低延迟
                    let (fmt, autoconv) = match (mix_sub, mix_bits) {
                        (Some(SampleType::Float), 32)
                        | (Some(SampleType::Int), 16)
                        | (Some(SampleType::Int), 32) => (mix, false),
                        _ => (
                            WaveFormat::new(
                                32,
                                32,
                                SampleType::Float,
                                cfg.rate as usize,
                                2,
                                None,
                            ),
                            true,
                        ),
                    };

                    let (_def_period, min_period) = client
                        .get_device_period()
                        .map_err(|e| format!("取设备周期失败: {e}"))?;
                    let want = if cfg.period_ms > 0.0 {
                        (cfg.period_ms * 10_000.0) as i64
                    } else {
                        min_period
                    };
                    (fmt, autoconv, desc, want.max(min_period))
                };

            client
                .initialize_client(
                    &cap_fmt,
                    capture_dir,
                    StreamMode::EventsShared {
                        autoconvert,
                        buffer_duration_hns: period_hns,
                    },
                    None,
                )
                .map_err(|e| format!("初始化采集客户端失败: {e}"))?;

            let h_event = client
                .set_get_eventhandle()
                .map_err(|e| format!("取事件句柄失败: {e}"))?;
            let cap = client
                .get_audiocaptureclient()
                .map_err(|e| format!("取采集客户端失败: {e}"))?;
            let blockalign = cap_fmt.get_blockalign() as usize;
            let buffer_frames = client.get_buffer_size().unwrap_or(0) as usize;
            let ch = cap_fmt.get_nchannels() as usize;
            let rate = cap_fmt.get_samplespersec();

            Ok(Self {
                client,
                cap,
                h_event,
                blockalign,
                buffer_frames,
                ch,
                rate,
                // 从实际使用的格式取，而不是上面分支里的临时变量
                bits: cap_fmt.get_bitspersample(),
                sub: cap_fmt.get_subformat().ok(),
                endpoint,
                mix_desc,
                period_ms: period_hns as f64 / 10_000.0,
                stream_start_abs_ns: 0,
                frames_emitted: 0,
            })
        }

        pub fn start(&mut self, abs_ns: u64) -> Result<(), String> {
            self.stream_start_abs_ns = abs_ns;
            self.frames_emitted = 0;
            self.client
                .start_stream()
                .map_err(|e| format!("启动采集流失败: {e}"))
        }

        pub fn stop(&mut self) {
            let _ = self.client.stop_stream();
        }

        pub fn decode(&self, raw: &[u8], out: &mut Vec<f32>) {
            match (self.sub, self.bits) {
                (Some(SampleType::Float), 32) => {
                    for b in raw.chunks_exact(4) {
                        out.push(f32::from_le_bytes([b[0], b[1], b[2], b[3]]));
                    }
                }
                (Some(SampleType::Int), 16) => {
                    for b in raw.chunks_exact(2) {
                        out.push(i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0);
                    }
                }
                (Some(SampleType::Int), 32) => {
                    for b in raw.chunks_exact(4) {
                        out.push(i32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f32 / 2147483648.0);
                    }
                }
                _ => {
                    let frames = raw.len() / (self.ch * self.bits as usize / 8).max(1);
                    out.resize(frames * self.ch, 0.0);
                }
            }
        }
    }
}

/// 采集线程主循环。`stop` 置位后优雅退出。
#[cfg(windows)]
pub fn run_push(
    cfg: PushConfig,
    stop: Arc<AtomicBool>,
    log: LogFn,
    stats: Arc<std::sync::Mutex<PushStats>>,
) -> Result<(), String> {
    use std::time::{Duration, Instant};
    use wire::{CHANNELS, HEADER_LEN};

    let mut capture = imp::Capture::open(&cfg)?;
    log(
        2,
        format!(
            "[audio] 采集端点: {} | 混音 {} | 设备周期 {:.2} ms",
            capture.endpoint, capture.mix_desc, capture.period_ms
        ),
    );

    let dest: SocketAddr = cfg
        .dest
        .parse()
        .map_err(|_| format!("副机地址无效: {}", cfg.dest))?;

    let sock = socket2::Socket::new(
        socket2::Domain::IPV4,
        socket2::Type::DGRAM,
        Some(socket2::Protocol::UDP),
    )
    .map_err(|e| format!("创建 UDP socket 失败: {e}"))?;
    sock.set_send_buffer_size(1 << 20).ok();
    let sock: UdpSocket = sock.into();
    sock.connect(dest)
        .map_err(|e| format!("连接 {dest} 失败: {e}"))?;

    {
        let mut st = stats.lock().map_err(|_| "stats lock poisoned".to_string())?;
        st.running = true;
        st.endpoint = capture.endpoint.clone();
        st.mix_format = capture.mix_desc.clone();
        st.device_period_ms = capture.period_ms;
    }

    // 先发 CONFIG，副机据此建立抖动缓冲
    sock.send(&wire::config_packet(cfg.rate)).ok();

    let t0 = Instant::now();
    let now_ns = || t0.elapsed().as_nanos() as u64;

    let fpp = cfg.frames_per_packet.clamp(16, 4096) as usize;
    let bytes_per_packet = fpp * CHANNELS * wire::BYTES_PER_SAMPLE;

    let mut pkt = vec![0u8; HEADER_LEN + bytes_per_packet];
    let mut raw = vec![0u8; capture.blockalign * capture.buffer_frames.max(1)];
    let mut f32buf: Vec<f32> = Vec::with_capacity(8192);
    let mut s16buf: Vec<u8> = Vec::with_capacity(bytes_per_packet);
    let mut seq: u32 = 0;
    let mut ts_cursor: u64 = 0;
    let mut lag_ring: Vec<u32> = Vec::with_capacity(240);
    let mut last_stat = Instant::now();
    let mut last_err_log = Instant::now() - Duration::from_secs(10);

    capture.start(now_ns())?;

    while !stop.load(Ordering::Relaxed) {
        let mut produced = false;

        // 5 ms 超时：既不会饿死采集，也让 keepalive 的节拍足够细
        let _ = capture.h_event.wait_for_event(5);

        loop {
            let (frames, info) = match capture.cap.read_from_device(&mut raw) {
                Ok(v) => v,
                Err(wasapi::WasapiError::DataLengthTooShort { .. }) => break,
                Err(e) => {
                    let msg = format!("读采集缓冲失败: {e}");
                    if last_err_log.elapsed() > Duration::from_secs(5) {
                        last_err_log = Instant::now();
                        log(3, format!("[audio] {msg}"));
                        if let Ok(mut st) = stats.lock() {
                            st.last_error = msg;
                        }
                    }
                    break;
                }
            };
            if frames == 0 {
                break;
            }
            produced = true;

            // 采集引擎积压：本包最新帧相对已交出位置的落后量
            let newest_pos_100ns =
                info.timestamp + (frames as u64 * 10_000_000) / capture.rate.max(1) as u64;
            let our_pos_100ns =
                capture.frames_emitted * 10_000_000 / capture.rate.max(1) as u64;
            let backlog = our_pos_100ns.saturating_sub(newest_pos_100ns);
            lag_ring.push((backlog / 10) as u32);
            if lag_ring.len() > 240 {
                lag_ring.remove(0);
            }
            capture.frames_emitted += frames as u64;

            f32buf.clear();
            capture.decode(&raw[..frames as usize * capture.blockalign], &mut f32buf);
            wire::downmix_to_stereo(&mut f32buf, capture.ch);
            if capture.rate != cfg.rate {
                f32buf = wire::resample_stereo(&f32buf, capture.rate, cfg.rate);
            }
            if (cfg.gain - 1.0).abs() > f32::EPSILON {
                for s in f32buf.iter_mut() {
                    *s *= cfg.gain;
                }
            }

            // 每包打上「这帧进入音频引擎的时刻」，副机据此测真实端到端延迟
            let capture_ns = capture.stream_start_abs_ns
                + info.timestamp * 100
                + capture.frames_emitted * 10_000_000 / capture.rate.max(1) as u64;

            let mut sink = |b: &[u8]| sock.send(b);
            match wire::emit_block(
                &mut sink,
                &mut pkt,
                &mut s16buf,
                &f32buf,
                fpp,
                &mut seq,
                &mut ts_cursor,
                cfg.rate,
                Some(capture_ns),
            ) {
                Ok(sent) => {
                    if let Ok(mut st) = stats.lock() {
                        st.packets += sent as u64;
                        st.frames += (f32buf.len() / CHANNELS) as u64;
                        // 最后一包可能不足 fpp 帧，按实际载荷估算更准，但
                        // 统计用途不需要那么细，取整包大小即可。
                        st.bytes += sent as u64 * (bytes_per_packet as u64 + HEADER_LEN as u64);
                    }
                }
                Err(e) => {
                    if let Ok(mut st) = stats.lock() {
                        st.send_errors += 1;
                        st.last_error = format!("UDP 发送失败: {e}");
                    }
                }
            }
        }

        // 空闲补静音：WASAPI 环回在无声时不投递数据，
        // 不补的话副机会重新预热并产生一次爆音。
        if cfg.keepalive && !produced {
            let idle_ns = now_ns().saturating_sub(ts_cursor);
            if idle_ns > 2_000_000 {
                let need = (idle_ns as u128 * cfg.rate as u128 / 1_000_000_000) as usize;
                let pad = need.min(cfg.rate as usize / 4).max(1);
                f32buf.clear();
                f32buf.resize(pad * CHANNELS, 0.0);
                let mut sink = |b: &[u8]| sock.send(b);
                let sent = wire::emit_block(
                    &mut sink,
                    &mut pkt,
                    &mut s16buf,
                    &f32buf,
                    fpp,
                    &mut seq,
                    &mut ts_cursor,
                    cfg.rate,
                    None,
                );
                if let Ok(mut st) = stats.lock() {
                    st.silent_packets += 1;
                    // 静音包也是真发出去的包，统计口径要一致，
                    // 否则「设备空闲时 pkts 一直是 0」会被误读成发送失败。
                    if let Ok(n) = sent {
                        st.packets += n as u64;
                        st.bytes += n as u64 * (bytes_per_packet as u64 + HEADER_LEN as u64);
                    }
                }
            }
        }

        // 回 PONG / 时钟同步响应：副机的 SYNC_REQ 需要在这里应答，
        // 否则它的单向延迟测量拿不到 offset。
        drain_control(&sock, &mut pkt, now_ns);

        if last_stat.elapsed().as_secs_f64() >= 1.0 {
            last_stat = Instant::now();
            if !lag_ring.is_empty() {
                lag_ring.sort_unstable();
                let p50 = lag_ring[lag_ring.len() / 2] as f64 / 1000.0;
                if let Ok(mut st) = stats.lock() {
                    st.capture_lag_ms = p50;
                }
                lag_ring.clear();
            }
        }
    }

    capture.stop();
    if let Ok(mut st) = stats.lock() {
        st.running = false;
    }
    log(2, format!("[audio] 推流停止，共 {} 包", seq));
    Ok(())
}

/// 应答副机的 PING / SYNC_REQ。非阻塞排空，避免拖慢主循环。
#[cfg(windows)]
fn drain_control(sock: &UdpSocket, pkt: &mut [u8], now_ns: impl Fn() -> u64) {
    use wire::{HEADER_LEN, kind};
    let mut rbuf = [0u8; 64];
    let _ = sock.set_nonblocking(true);
    loop {
        match sock.recv(&mut rbuf) {
            Ok(n) if n >= HEADER_LEN => {
                let Some((k, seq, ts)) = wire::parse(&rbuf[..n]) else {
                    continue;
                };
                match k {
                    kind::PING => {
                        let mut q = [0u8; HEADER_LEN];
                        wire::write_header(&mut q, kind::PONG, seq, ts);
                        let _ = sock.send(&q);
                    }
                    kind::SYNC_REQ => {
                        // 回显副机时钟 + 本机时钟，副机据此解 offset
                        let mut q = vec![0u8; HEADER_LEN + 8];
                        wire::write_header(&mut q, kind::SYNC_REP, seq, now_ns());
                        q[HEADER_LEN..].copy_from_slice(&ts.to_le_bytes());
                        let _ = sock.send(&q);
                    }
                    _ => {}
                }
            }
            Ok(_) => continue,
            Err(_) => break,
        }
    }
    let _ = sock.set_nonblocking(false);
    let _ = pkt;
}

/// 枚举可用的**播放**端点。
///
/// 默认播放设备不一定是耳机：这台机器上默认是 `Capture Card (NVIDIA HDMI)`，
/// 而真正的声音在 `迈从 (MCHOSE V9 Turbo+)`。所以要把列表暴露成下拉选项，
/// 让人直接选，而不是指望「默认」或手工复制设备名。
///
/// 返回值同时带 `options`（给前端下拉）和 `devices`（带状态，便于排查）。
#[cfg(windows)]
pub fn list_render_devices() -> Result<serde_json::Value, String> {
    use wasapi::{DeviceEnumerator, Direction};
    let _ = wasapi::initialize_mta();
    let en = DeviceEnumerator::new().map_err(|e| format!("创建设备枚举器失败: {e}"))?;
    let coll = en
        .get_device_collection(Direction::Render)
        .map_err(|e| format!("枚举播放设备失败: {e}"))?;
    let n = coll
        .get_nbr_devices()
        .map_err(|e| format!("设备数量读取失败: {e}"))?;

    let default_name = en
        .get_default_device(Direction::Render)
        .ok()
        .and_then(|d| d.get_friendlyname().ok())
        .unwrap_or_default();

    let mut devices = Vec::new();
    let mut options = Vec::new();

    // 第一项固定是「系统默认」：留空表示跟随默认设备，
    // 用户换了默认输出时不用回来改配置。
    options.push(serde_json::json!({
        "value": "",
        "label": if default_name.is_empty() {
            "跟随系统默认".to_string()
        } else {
            format!("跟随系统默认（当前：{default_name}）")
        },
    }));

    for i in 0..n {
        let Ok(d) = coll.get_device_at_index(i) else {
            continue;
        };
        let name = d.get_friendlyname().unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        let state = d
            .get_state()
            .map(|s| format!("{s:?}"))
            .unwrap_or_else(|_| "?".into());
        let is_default = name == default_name;
        let active = state.eq_ignore_ascii_case("Active");

        devices.push(serde_json::json!({
            "index": i,
            "name": name,
            "state": state,
            "default": is_default,
        }));

        // 停用的端点也列出来但标清楚，避免选了却没声音还找不到原因
        let mut label = name.clone();
        if is_default {
            label.push_str("（系统默认）");
        }
        if !active {
            label.push_str("（未启用）");
        }
        options.push(serde_json::json!({ "value": name, "label": label }));
    }

    // 「单程序音频」不是一个端点，但放在同一个下拉里最直观：
    // 选它之后由插件改读 audio_process 走进程环回。
    options.push(serde_json::json!({
        "value": "__process__",
        "label": "单程序音频（在下一项选进程）",
    }));

    Ok(serde_json::json!({
        "options": options,
        "devices": devices,
        "default_device": default_name,
    }))
}

/// 枚举可能正在播放声音的进程，供「单程序音频」下拉使用。
///
/// wasapi 0.27 没有暴露 IAudioSessionManager2 的会话枚举，所以走
/// 「枚举有可见主窗口的进程」这条路：用户在选的几乎总是桌面程序
/// （浏览器、播放器、游戏），而不是后台服务。
///
/// 这比 tasklist 全量列出好得多——那里面几百个后台进程，没法选。
#[cfg(windows)]
pub fn list_audio_processes() -> Result<serde_json::Value, String> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, IsWindowVisible,
    };

    // 收集「可见且有主窗口」的 PID
    let mut pids: Vec<u32> = Vec::new();
    unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let out = &mut *(lparam.0 as *mut Vec<u32>);
        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid != 0 && !out.contains(&pid) {
            out.push(pid);
        }
        BOOL(1)
    }
    unsafe {
        let _ = EnumWindows(Some(enum_cb), LPARAM(&mut pids as *mut _ as isize));
    }

    // 解析成进程名，去重（同一程序多开只留一条）
    let mut seen: Vec<(String, u32)> = Vec::new();
    for pid in pids {
        if let Some(name) = process_name_by_pid(pid) {
            // 跳过本进程和几个系统 shell
            if name == "air-icon-launcher.exe"
                || name == "explorer.exe"
                || name == "textinputhost.exe"
                || name == "searchhost.exe"
            {
                continue;
            }
            if !seen.iter().any(|(n, _)| *n == name) {
                seen.push((name, pid));
            }
        }
    }

    seen.sort_by(|a, b| a.0.cmp(&b.0));
    let mut options = vec![serde_json::json!({
        "value": "",
        "label": "（未选择）",
    })];
    let mut items = Vec::new();
    for (name, pid) in &seen {
        let label = format!("{name} (pid {pid})");
        // value 用进程名：重开程序后 PID 会变，进程名更稳定
        options.push(serde_json::json!({ "value": name, "label": label }));
        items.push(serde_json::json!({ "name": name, "pid": pid }));
    }

    Ok(serde_json::json!({
        "options": options,
        "processes": items,
    }))
}

/// 由 PID 查进程映像名（小写，含 .exe）。
#[cfg(windows)]
pub fn process_name_by_pid(pid: u32) -> Option<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::core::PWSTR;

    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
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
    let _ = unsafe { CloseHandle(handle) };
    if ok.is_err() || size == 0 {
        return None;
    }
    let full = String::from_utf16_lossy(&buf[..size as usize]);
    Some(
        full.rsplit(['\\', '/'])
            .next()
            .unwrap_or(&full)
            .to_ascii_lowercase(),
    )
}

#[cfg(not(windows))]
pub fn list_audio_processes() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({ "options": [], "processes": [] }))
}

#[cfg(not(windows))]
pub fn process_name_by_pid(_pid: u32) -> Option<String> {
    None
}

/// 枚举可用的**采集**端点（麦克风），格式与 `list_render_devices` 一致。
#[cfg(windows)]
pub fn list_capture_devices() -> Result<serde_json::Value, String> {
    use wasapi::{DeviceEnumerator, Direction};
    let _ = wasapi::initialize_mta();
    let en = DeviceEnumerator::new().map_err(|e| format!("创建设备枚举器失败: {e}"))?;
    let coll = en
        .get_device_collection(Direction::Capture)
        .map_err(|e| format!("枚举采集设备失败: {e}"))?;
    let n = coll
        .get_nbr_devices()
        .map_err(|e| format!("设备数量读取失败: {e}"))?;

    let default_name = en
        .get_default_device(Direction::Capture)
        .ok()
        .and_then(|d| d.get_friendlyname().ok())
        .unwrap_or_default();

    let mut devices = Vec::new();
    let mut options = vec![serde_json::json!({
        "value": "",
        "label": if default_name.is_empty() {
            "跟随系统默认麦克风".to_string()
        } else {
            format!("跟随系统默认（当前：{default_name}）")
        },
    })];

    for i in 0..n {
        let Ok(d) = coll.get_device_at_index(i) else {
            continue;
        };
        let name = d.get_friendlyname().unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        let state = d
            .get_state()
            .map(|s| format!("{s:?}"))
            .unwrap_or_else(|_| "?".into());
        let is_default = name == default_name;
        devices.push(serde_json::json!({
            "index": i,
            "name": name,
            "state": state,
            "default": is_default,
        }));
        let mut label = name.clone();
        if is_default {
            label.push_str("（系统默认）");
        }
        options.push(serde_json::json!({ "value": name, "label": label }));
    }

    Ok(serde_json::json!({
        "options": options,
        "devices": devices,
        "default_device": default_name,
    }))
}

#[cfg(not(windows))]
pub fn list_capture_devices() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "options": [],
        "devices": [],
        "default_device": "",
        "note": "WASAPI 仅支持 Windows",
    }))
}

#[cfg(not(windows))]
pub fn list_render_devices() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "options": [],
        "devices": [],
        "default_device": "",
        "note": "WASAPI 仅支持 Windows",
    }))
}

#[cfg(not(windows))]
pub fn run_push(
    _cfg: PushConfig,
    _stop: Arc<AtomicBool>,
    log: LogFn,
    _stats: Arc<std::sync::Mutex<PushStats>>,
) -> Result<(), String> {
    log(4, "[audio] WASAPI 采集仅支持 Windows".into());
    Err("WASAPI 采集仅支持 Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_is_sane() {
        let c = PushConfig::default();
        assert_eq!(c.rate, 48000);
        assert_eq!(c.frames_per_packet, 240);
        assert!(c.keepalive);
    }

    #[test]
    fn packet_size_fits_mtu() {
        let c = PushConfig::default();
        let bytes = c.frames_per_packet as usize * wire::CHANNELS * wire::BYTES_PER_SAMPLE
            + wire::HEADER_LEN;
        assert!(bytes <= 1500, "packet {bytes} B would fragment");
    }
}
