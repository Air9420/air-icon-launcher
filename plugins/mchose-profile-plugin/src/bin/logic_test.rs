//! 纯逻辑自测：轮换算法 + OSD 推送（不需要鼠标唤醒）
use air_mchose_profile::{next_slot, Config};

fn main() {
    println!("=== 轮换算法 ===");

    // cycle 模式：0,1,2 全轮换
    let cfg = Config {
        mode: "cycle".into(),
        active_slots: vec![0, 1, 2],
        ..Default::default()
    };
    let mut cur = 0u8;
    print!("  cycle[0,1,2]: 0");
    for _ in 0..4 {
        cur = next_slot(cur, &cfg);
        print!(" -> {cur}");
    }
    println!("   (期望 0->1->2->0->1)");

    // cycle 但屏蔽槽 0（默认槽）
    let cfg2 = Config {
        mode: "cycle".into(),
        active_slots: vec![1, 2],
        ..Default::default()
    };
    let mut cur = 1u8;
    print!("  cycle[1,2]: 1");
    for _ in 0..4 {
        cur = next_slot(cur, &cfg2);
        print!(" -> {cur}");
    }
    println!("   (期望 1->2->1->2->1)");

    // pair 模式：只在 1 和 2 之间
    let cfg3 = Config {
        mode: "pair".into(),
        pair: vec![1, 2],
        ..Default::default()
    };
    let mut cur = 1u8;
    print!("  pair[1,2]: 1");
    for _ in 0..4 {
        cur = next_slot(cur, &cfg3);
        print!(" -> {cur}");
    }
    println!("   (期望 1->2->1->2->1)");

    // 当前不在列表里 → 跳到第一个
    let cur2 = next_slot(0, &cfg3);
    println!("  pair[1,2], 当前=0 -> {cur2}   (期望 1)");

    println!("\n=== OSD 推送 ===");
    let url = "http://192.168.31.66:8766";
    let payload = serde_json::json!({
        "profile_name": "日常",
        "profile_index": 1,
        "profile_count": 3,
        "active_slots": [1, 2, 3],
        "dpi": 1200,
        "battery": 92,
        "duration": 2.5
    });
    match ureq::post(&format!("{url}/state"))
        .timeout(std::time::Duration::from_secs(3))
        .set("Content-Type", "application/json; charset=utf-8")
        .send_string(&serde_json::to_string(&payload).unwrap())
    {
        Ok(r) => println!("  推送成功: {}", r.into_string().unwrap_or_default()),
        Err(e) => println!("  推送失败: {e}"),
    }
}
