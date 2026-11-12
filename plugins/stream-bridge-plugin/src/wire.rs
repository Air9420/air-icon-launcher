//! LAUD v1 线格式：与副机 `lan-audio-recv` 完全一致。
//!
//! ```text
//!  0..4   magic   u32  = 0x4C415544 ("LAUD")
//!  4      version u8   = 1
//!  5      kind    u8
//!  6..8   pad     u16
//!  8..12  seq     u32
//! 12..20  ts      u64  纳秒，发送端时钟
//! ```
//!
//! 载荷是 s16le 立体声交织帧。20 字节头 + 240 帧 × 4 字节 = 980 字节，
//! 单包不触发 IP 分片。

pub const MAGIC: u32 = 0x4C41_5544;
pub const VERSION: u8 = 1;
pub const HEADER_LEN: usize = 20;
pub const CHANNELS: usize = 2;
pub const BYTES_PER_SAMPLE: usize = 2;

pub mod kind {
    pub const CONFIG: u8 = 0;
    pub const AUDIO: u8 = 1;
    pub const PING: u8 = 2;
    pub const PONG: u8 = 3;
    pub const SYNC_REQ: u8 = 4;
    pub const SYNC_REP: u8 = 5;
}

#[inline]
pub fn write_header(out: &mut [u8], k: u8, seq: u32, ts: u64) {
    out[0..4].copy_from_slice(&MAGIC.to_le_bytes());
    out[4] = VERSION;
    out[5] = k;
    out[6..8].copy_from_slice(&0u16.to_le_bytes());
    out[8..12].copy_from_slice(&seq.to_le_bytes());
    out[12..20].copy_from_slice(&ts.to_le_bytes());
}

#[inline]
pub fn parse(buf: &[u8]) -> Option<(u8, u32, u64)> {
    if buf.len() < HEADER_LEN {
        return None;
    }
    if u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) != MAGIC {
        return None;
    }
    if buf[4] != VERSION {
        return None;
    }
    let k = buf[5];
    let seq = u32::from_le_bytes([buf[8], buf[9], buf[10], buf[11]]);
    let ts = u64::from_le_bytes([
        buf[12], buf[13], buf[14], buf[15], buf[16], buf[17], buf[18], buf[19],
    ]);
    Some((k, seq, ts))
}

/// 交织 f32 → s16le 字节，带限幅。
pub fn f32_to_s16_bytes(src: &[f32], dst: &mut Vec<u8>) {
    dst.clear();
    dst.reserve(src.len() * BYTES_PER_SAMPLE);
    for &s in src {
        let v = (s.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        dst.extend_from_slice(&v.to_le_bytes());
    }
}

/// 折叠 N 声道交织缓冲到立体声。只取前两个声道，与 `lan-audio-recv` 的
/// 降混策略保持一致（副机端不再做二次处理）。
pub fn downmix_to_stereo(buf: &mut Vec<f32>, ch: usize) {
    if ch == 2 || ch == 0 {
        return;
    }
    let frames = buf.len() / ch;
    if ch == 1 {
        let mut v = Vec::with_capacity(frames * 2);
        for f in 0..frames {
            let s = buf[f];
            v.push(s);
            v.push(s);
        }
        *buf = v;
        return;
    }
    let mut v = Vec::with_capacity(frames * 2);
    for f in 0..frames {
        v.push(buf[f * ch]);
        v.push(buf[f * ch + 1]);
    }
    *buf = v;
}

/// 线性插值重采样（立体声交织）。仅在混音格式与目标采样率不一致时使用。
pub fn resample_stereo(src: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || from == 0 || to == 0 {
        return src.to_vec();
    }
    let frames = src.len() / 2;
    if frames == 0 {
        return Vec::new();
    }
    let ratio = from as f64 / to as f64;
    let out_frames = (frames as f64 / ratio) as usize;
    let mut out = Vec::with_capacity(out_frames * 2);
    for i in 0..out_frames {
        let p = i as f64 * ratio;
        let b = (p.floor() as usize).min(frames - 1);
        let fr = (p - b as f64) as f32;
        let b2 = (b + 1).min(frames - 1);
        for c in 0..2 {
            let a = src[b * 2 + c];
            let bb = src[b2 * 2 + c];
            out.push(a + (bb - a) * fr);
        }
    }
    out
}

/// 发送端分片发射：把一个 f32 块按 `frames_per_packet` 切成多个 UDP 包。
///
/// `ts_cursor` 是「下一帧在发送端时钟上的位置」，逐包推进，
/// 副机用它做单向延迟测量，不要改成按墙钟取整。
#[allow(clippy::too_many_arguments)]
pub fn emit_block(
    send: &mut dyn FnMut(&[u8]) -> std::io::Result<usize>,
    pkt: &mut [u8],
    s16buf: &mut Vec<u8>,
    src: &[f32],
    frames_per_packet: usize,
    seq: &mut u32,
    ts_cursor: &mut u64,
    rate: u32,
    ts_override: Option<u64>,
) -> std::io::Result<usize> {
    let mut off = 0usize;
    let mut sent = 0usize;
    if let Some(t) = ts_override {
        *ts_cursor = t;
    }
    while off < src.len() {
        let n = ((src.len() - off) / CHANNELS).min(frames_per_packet);
        if n == 0 {
            break;
        }
        f32_to_s16_bytes(&src[off..off + n * CHANNELS], s16buf);
        let total = HEADER_LEN + s16buf.len();
        write_header(&mut pkt[..total], kind::AUDIO, *seq, *ts_cursor);
        pkt[HEADER_LEN..total].copy_from_slice(s16buf);
        send(&pkt[..total])?;
        *seq = seq.wrapping_add(1);
        *ts_cursor += (n as u64 * 1_000_000_000) / rate.max(1) as u64;
        off += n * CHANNELS;
        sent += 1;
    }
    Ok(sent)
}

/// 构造 CONFIG 包（采样率 / 声道 / 采样位宽），副机据此配置抖动缓冲。
pub fn config_packet(rate: u32) -> Vec<u8> {
    let mut p = vec![0u8; HEADER_LEN + 6];
    write_header(&mut p, kind::CONFIG, 0, 0);
    p[HEADER_LEN..HEADER_LEN + 4].copy_from_slice(&rate.to_le_bytes());
    p[HEADER_LEN + 4] = CHANNELS as u8;
    p[HEADER_LEN + 5] = BYTES_PER_SAMPLE as u8;
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_roundtrip() {
        let mut buf = [0u8; HEADER_LEN];
        write_header(&mut buf, kind::AUDIO, 7, 123456789);
        assert_eq!(parse(&buf), Some((kind::AUDIO, 7, 123456789)));
    }

    #[test]
    fn rejects_foreign_packet() {
        let buf = [0u8; HEADER_LEN];
        assert!(parse(&buf).is_none());
    }

    #[test]
    fn downmix_takes_first_pair() {
        let mut buf = vec![1.0, 2.0, 9.0, 9.0, 3.0, 4.0, 9.0, 9.0];
        downmix_to_stereo(&mut buf, 4);
        assert_eq!(buf, vec![1.0, 2.0, 3.0, 4.0]);
    }

    #[test]
    fn downmix_mono_duplicates() {
        let mut buf = vec![0.5, 0.25];
        downmix_to_stereo(&mut buf, 1);
        assert_eq!(buf, vec![0.5, 0.5, 0.25, 0.25]);
    }

    #[test]
    fn emit_splits_into_mtu_sized_packets() {
        let src = vec![0.1f32; 480 * CHANNELS]; // 10 ms
        let mut pkt = vec![0u8; HEADER_LEN + 4096];
        let mut s16buf = Vec::new();
        let mut seq = 0u32;
        let mut ts = 0u64;
        let mut sizes = Vec::new();
        let mut sink = |b: &[u8]| {
            sizes.push(b.len());
            Ok(b.len())
        };
        let n = emit_block(
            &mut sink,
            &mut pkt,
            &mut s16buf,
            &src,
            240,
            &mut seq,
            &mut ts,
            48000,
            None,
        )
        .unwrap();
        assert_eq!(n, 2);
        assert_eq!(sizes, vec![20 + 240 * 4, 20 + 240 * 4]);
        assert_eq!(seq, 2);
        // 每包 240 帧 = 5 ms
        assert_eq!(ts, 10_000_000);
    }
}
