//! HID 层独立验证程序（不依赖插件宿主）
use air_mchose_profile::hid::Mouse;

fn main() {
    println!("=== 打开 MCHOSE A7 V2 ===");
    let mouse = match Mouse::open() {
        Ok(m) => {
            println!("  已打开");
            m
        }
        Err(e) => {
            eprintln!("  失败: {e}");
            std::process::exit(1);
        }
    };

    println!("\n=== 读取板载配置 ===");
    match mouse.read_profile() {
        Ok(p) => {
            println!("  当前槽位: {}", p.profile_index);
            println!("  DPI 档数: {}", p.dpi_count);
            println!("  DPI 档位: {:?}", p.dpi_stages);
            println!("  当前档:   {}", p.active_dpi_stage);
            println!("  轮询率:   {} Hz", p.report_rate_hz);
            println!("  去抖:     {} ms", p.debounce);
            println!("  休眠:     {} min", p.sleep);
        }
        Err(e) => println!("  失败: {e}"),
    }

    println!("\n=== 读取槽位名称 ===");
    let names = mouse.read_all_slot_names();
    for (i, n) in names.iter().enumerate() {
        if n.is_empty() {
            println!("  槽 {i}: (空/默认)");
        } else {
            println!("  槽 {i}: {n}");
        }
    }

    println!("\n=== 读取电量 ===");
    match mouse.read_battery() {
        Ok(b) => println!("  {}%{}", b.percent, if b.charging { " (充电中)" } else { "" }),
        Err(e) => println!("  失败: {e}"),
    }
}
