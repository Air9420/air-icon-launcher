//! MCHOSE A7 V2 Ultra+ 板载配置读写
//!
//! 协议要点（详见 docs/architecture/mchose-mouse-protocol.md）：
//! - 配置接口 usage_page=0xFF01 usage=0x01
//! - 发送 feature report 0x12 / 0x11，接收 feature report 0x11
//! - **所有字节 XOR 0xFF**
//! - **payload 不含 report id**：0x12 类 63 字节，0x11 类 19 字节
//!   （多一个字节固件会判为非法帧，只回显不返回数据）

use hidapi::{HidApi, HidDevice};
use std::sync::Mutex;

/// 全局互斥：同一时刻只允许一个线程操作设备。
/// 热键线程和 UI 线程并发访问会导致响应串包（实测过）。
static DEV_LOCK: Mutex<()> = Mutex::new(());

pub const VENDOR_ID: u16 = 0x3837;
/// A7 V2 Ultra+
pub const PID_A7_V2: u16 = 0x100B;

pub const USAGE_PAGE_CONFIG: u16 = 0xFF01;
pub const USAGE_CONFIG: u16 = 0x0001;

const RECV_RID: u8 = 0x11;
/// 0x12 类命令的 payload 长度（不含 report id）
const FRAME_63: usize = 63;
/// 0x11 类命令的 payload 长度（不含 report id）
const FRAME_19: usize = 19;

/// 轮询率索引 → Hz
pub fn rate_hz(idx: u8) -> u32 {
    match idx {
        0 => 125,
        1 => 250,
        2 => 500,
        3 => 1000,
        4 => 2000,
        5 => 4000,
        6 => 8000,
        _ => 1000,
    }
}

#[derive(Debug, Clone)]
pub struct MouseProfile {
    /// 当前槽位（0 起）
    pub profile_index: u8,
    /// X 轴各档 DPI
    pub dpi_stages: [u16; 6],
    /// Y 轴各档 DPI（仅 axis_y_enabled 时有效，否则等于 X）
    pub dpi_stages_y: [u16; 6],
    /// X/Y 是否独立设置
    pub axis_y_enabled: bool,
    pub dpi_count: u8,
    pub active_dpi_stage: u8,
    pub report_rate_hz: u32,
    pub debounce: u8,
    pub sleep: u8,
}

#[derive(Debug, Clone)]
pub struct BatteryInfo {
    pub percent: u8,
    pub charging: bool,
}

pub struct Mouse {
    dev: HidDevice,
}

impl Mouse {
    /// 打开 A7 V2 的配置接口
    pub fn open() -> Result<Self, String> {
        let api = HidApi::new().map_err(|e| format!("HidApi 初始化失败: {e}"))?;

        let info = api
            .device_list()
            .filter(|d| {
                d.vendor_id() == VENDOR_ID
                    && d.product_id() == PID_A7_V2
                    && d.usage_page() == USAGE_PAGE_CONFIG
                    && d.usage() == USAGE_CONFIG
            })
            .next()
            .ok_or_else(|| "未找到 MCHOSE A7 V2 配置接口".to_string())?;

        let dev = info
            .open_device(&api)
            .map_err(|e| format!("打开设备失败: {e}"))?;

        Ok(Self { dev })
    }

    /// 构造帧：tokens 依次写入，剩余补 0，然后整体 XOR 0xFF
    fn build_frame(tokens: &[u8], len: usize) -> Vec<u8> {
        let mut body = vec![0u8; len];
        for (i, &t) in tokens.iter().enumerate() {
            if i < len {
                body[i] = t;
            }
        }
        body.iter().map(|b| b ^ 0xFF).collect()
    }

    /// 发送并读回（XOR 还原后的响应）
    ///
    /// `send_rid` 决定命令通道：0x12 用 63 字节 payload，0x11 用 19 字节。
    /// 返回的 `dec` 已 XOR 还原：`dec[0]` 是 0xED/0xEE，`dec[1]` 是命令码回显。
    ///
    /// 全程持锁，避免与热键线程并发导致响应串包。
    ///
    /// **重要**：设备偶尔不产生新响应，此时 `get_feature_report` 会返回
    /// **上一次写入的帧**（`buf[0]` 变成 0x11/0x12 而不是 0xED/0xEE）。
    /// 只清一条残留不够，必须循环读到帧头正确的响应为止，
    /// 否则上层会把「自己发出去的帧」当成设备响应（表现为 `[12, 67, 0, 0...]`）。
    fn xfer(&self, send_rid: u8, tokens: &[u8]) -> Result<Vec<u8>, String> {
        let _guard = DEV_LOCK.lock().map_err(|_| "设备锁中毒".to_string())?;

        let len = if send_rid == 0x11 { FRAME_19 } else { FRAME_63 };
        let payload = Self::build_frame(tokens, len);

        let mut tx = Vec::with_capacity(len + 1);
        tx.push(send_rid);
        tx.extend_from_slice(&payload);

        // 清掉可能残留的旧响应
        {
            let mut stale = vec![0u8; 65];
            stale[0] = RECV_RID;
            let _ = self.dev.get_feature_report(&mut stale);
        }

        self.dev
            .send_feature_report(&tx)
            .map_err(|e| format!("发送失败: {e}"))?;

        // 设备响应很快（~40ms），但忙时会更久；轮询读到有效帧为止
        let mut last: Vec<u8> = Vec::new();
        for i in 0..12 {
            std::thread::sleep(std::time::Duration::from_millis(if i == 0 { 35 } else { 25 }));

            let mut buf = vec![0u8; 65];
            buf[0] = RECV_RID;
            let n = match self.dev.get_feature_report(&mut buf) {
                Ok(n) => n,
                Err(e) => return Err(format!("读取失败: {e}")),
            };
            buf.truncate(n);

            // buf[0] 是 report id，不参与 XOR 还原
            let mut dec: Vec<u8> = Vec::with_capacity(n);
            dec.push(buf[0]);
            dec.extend(buf[1..].iter().map(|b| b ^ 0xFF));

            // 有效响应的 report id 等于请求通道（0x12 命令回 0x12，0x11 命令回 0x11）。
            // 注意：协议文档里写的 dec[0]=0xED/0xEE 是「连 report id 一起 XOR」
            // 的记法（0x12^0xFF=0xED），实际读到的 buf[0] 是未 XOR 的 0x12/0x11。
            if dec.len() >= 2 && (dec[0] == send_rid || dec[0] == send_rid ^ 0xFF) {
                return Ok(dec);
            }
            last = dec;
        }

        Err(format!(
            "设备无有效响应，最后帧头: {:02X?}",
            &last[..last.len().min(6)]
        ))
    }

    /// 读板载配置（0x12 0x67）
    ///
    /// 响应（XOR 还原后）：dec[0]=0xED, dec[1]=0x67(命令回显), dec[2..]=数据
    /// 注意：设备偶尔返回空帧，必须重试。
    pub fn read_profile(&self) -> Result<MouseProfile, String> {
        let mut last = Vec::new();
        let mut last_err = String::new();
        // 实测约 15% 概率返回空帧，重试要够
        for _attempt in 0..10 {
            // xfer 本身已会重试到有效帧头；失败就再发一次，不要直接返回
            let dec = match self.xfer(0x12, &[0x67]) {
                Ok(d) => d,
                Err(e) => {
                    last_err = e;
                    std::thread::sleep(std::time::Duration::from_millis(60));
                    continue;
                }
            };
            // 严格校验：必须是 0xED + 命令码 0x67 回显
            if dec.len() < 24 || dec[1] != 0x67 {
                last = dec;
                std::thread::sleep(std::time::Duration::from_millis(50));
                continue;
            }
            // dec[0]=0xED, dec[1]=cmd echo, 数据从 dec[2] 开始
            let body = &dec[2..];
            let nonzero = body.iter().filter(|&&b| b != 0).count();
            let idx = body[0];
            let dpi_sum = body[16];
            // 有效性：槽位 0..2、档位 1..6、数据量足够
            if nonzero > 5 && idx <= 2 && (1..=6).contains(&dpi_sum) {
                let dpi_stages = {
                    let mut arr = [0u16; 6];
                    for i in 0..6 {
                        arr[i] = u16::from_le_bytes([body[4 + i * 2], body[5 + i * 2]]);
                    }
                    arr
                };

                // Y 轴数据在尾部：body[49]=dpiDirection, body[50] 的 bit0 = Y 是否独立
                // body[51..] 是 Y 组 DPI
                // 实测：槽1 body[50]=0x80 → Y 跟随 X（Y 组数据无效）
                //       槽2 body[50]=0x81 → Y 独立，Y0=1600 而 X0=1200
                let (axis_y_enabled, dpi_stages_y) = if body.len() >= 63 {
                    let has_y = body[50] & 0x01 != 0;
                    let mut arr = [0u16; 6];
                    if has_y {
                        for i in 0..6 {
                            let off = 51 + i * 2;
                            if off + 1 < body.len() {
                                arr[i] = u16::from_le_bytes([body[off], body[off + 1]]);
                            }
                        }
                    }
                    (has_y, arr)
                } else {
                    (false, [0u16; 6])
                };

                // body[2]: 低 4 位 = 当前 DPI 档位索引（0 基），高 4 位 = 轮询率索引
                // 实测 body[2]=0x20 → 档位 0（即第 1 档）、轮询率索引 2
                let stage_0based = body[2] & 0x0F;
                let rate_idx = body[2] >> 4;

                let dpi_count = body[16].clamp(1, 6);

                return Ok(MouseProfile {
                    profile_index: idx,
                    dpi_stages,
                    dpi_stages_y,
                    axis_y_enabled,
                    dpi_count,
                    // 对外统一用 1 基档位号
                    active_dpi_stage: (stage_0based + 1).min(dpi_count),
                    report_rate_hz: rate_hz(rate_idx),
                    debounce: body[18],
                    sleep: body[19],
                });
            }
            last = dec;
            std::thread::sleep(std::time::Duration::from_millis(60));
        }
        if last.is_empty() && !last_err.is_empty() {
            return Err(format!("鼠标无有效响应: {last_err}"));
        }
        Err(format!(
            "鼠标无有效响应，请确认已连接。最后响应: {:02X?}",
            &last[..last.len().min(10)]
        ))
    }

    /// 读槽位名称（0x12 0x68 0x00/01/02）
    ///
    /// 响应：dec[0]=0xED, dec[1]=0x68, dec[2]=槽位号, dec[3..]=UTF-8 名称
    /// 空槽返回全 0；设备偶尔返回空帧，需重试。
    pub fn read_slot_name(&self, slot: u8) -> Result<String, String> {
        let mut empty_hits = 0;
        for _ in 0..8 {
            let dec = match self.xfer(0x12, &[0x68, slot]) {
                Ok(d) => d,
                Err(_) => {
                    std::thread::sleep(std::time::Duration::from_millis(60));
                    continue;
                }
            };
            if dec.len() < 4 {
                std::thread::sleep(std::time::Duration::from_millis(50));
                continue;
            }
            // 校验：命令回显与槽位号都要对上
            if dec[1] != 0x68 || dec[2] != slot {
                std::thread::sleep(std::time::Duration::from_millis(50));
                continue;
            }
            let name_bytes: Vec<u8> = dec[3..]
                .iter()
                .copied()
                .take_while(|&b| b != 0)
                .collect();
            if name_bytes.is_empty() {
                // 连续两次读到空才认定真空槽
                empty_hits += 1;
                if empty_hits >= 2 {
                    return Ok(String::new());
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
                continue;
            }
            return Ok(String::from_utf8_lossy(&name_bytes).trim().to_string());
        }
        Err(format!("读取槽位 {slot} 名称失败"))
    }

    /// 读电量（0x11 0x06）
    ///
    /// 响应结构（XOR 还原后，数据从 dec[2] 开始）：
    /// ```
    /// [0..2]  vid          uint16 LE
    /// [2..4]  pid          uint16 LE
    /// [4..8]  fwVersion    uint32 LE
    /// [8]     connectMode(bit3) | connectStatus(bit1) | inReserved(bit4)
    /// [9]     batteryLevel uint8   ← 电量百分比
    /// [10]    chargeStatus uint8
    /// ```
    /// 实测 `0x11 0x06` 返回 `37 38 21 40 05 2e 02 04 09 56 00 ...`
    /// → `body[9] = 0x56 = 86%`
    pub fn read_battery(&self) -> Result<BatteryInfo, String> {
        let mut last = Vec::new();
        for attempt in 0..8 {
            let dec = match self.xfer(0x11, &[0x06]) {
                Ok(d) => d,
                Err(_) => {
                    std::thread::sleep(std::time::Duration::from_millis(60));
                    continue;
                }
            };
            // 校验命令码回显
            if dec.len() >= 13 && dec[1] == 0x06 {
                let body = &dec[2..];
                let pct = body[9];
                if (1..=100).contains(&pct) {
                    return Ok(BatteryInfo {
                        percent: pct,
                        charging: body[10] != 0,
                    });
                }
            }
            last = dec;
            std::thread::sleep(std::time::Duration::from_millis(60 + attempt * 20));
        }
        Err(format!(
            "读取电量失败，响应: {:02X?}",
            &last[..last.len().min(12)]
        ))
    }

    /// 切换板载配置
    ///
    /// 帧：`0x11` 通道，payload = [0x58, <index>]，19 字节。
    /// 注意不要再带一个 0x58 —— 那会让固件只回显不执行。
    /// ACK：dec[0]=0xEE, dec[1]=0x58, dec[2]=index。
    ///
    /// 校验要严格：若 `dec[1]` 不是 0x58（例如是 0x68），
    /// 说明读到的是上一条命令的残留响应，需重试。
    pub fn switch_profile(&self, index: u8) -> Result<(), String> {
        if index > 2 {
            return Err(format!("槽位越界: {index}"));
        }

        let mut last = Vec::new();
        for attempt in 0..4 {
            let dec = match self.xfer(0x11, &[0x58, index]) {
                Ok(d) => d,
                Err(_) => {
                    std::thread::sleep(std::time::Duration::from_millis(60));
                    continue;
                }
            };
            // 严格校验：命令码回显 + 索引回显都要对上
            if dec.len() >= 3 && dec[1] == 0x58 && dec[2] == index {
                return Ok(());
            }
            last = dec;
            if attempt < 3 {
                std::thread::sleep(std::time::Duration::from_millis(120));
            }
        }
        Err(format!(
            "切换未确认，响应: {:02X?}",
            &last[..last.len().min(8)]
        ))
    }

    /// 一次性读取三个槽位名称
    pub fn read_all_slot_names(&self) -> [String; 3] {
        [
            self.read_slot_name(0).unwrap_or_default(),
            self.read_slot_name(1).unwrap_or_default(),
            self.read_slot_name(2).unwrap_or_default(),
        ]
    }
}
