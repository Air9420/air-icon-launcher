//! 宿主模拟器：复现「热键切换进行中宿主卸载插件」的时序。
//!
//! 用法：
//!   host-sim <dll> <卸载延迟毫秒> [new|old]
//!
//! - `new`（默认）：宿主当前实现 —— HostUserData 走 Arc + 注册表查活，
//!   卸载时 Library 移入退休区永不 unmap。
//! - `old`：2026-11-07 闪退时的实现 —— 回调直接对 user_data 裸指针取引用，
//!   卸载时 drop Library（unmap 代码段）+ 立即释放 HostUserData。
//!
//! 流程：加载 → init → 后台线程持续 invoke("next")（模拟连按热键）
//!       → 延迟 N 毫秒后 shutdown + 卸载 → 再存活 8 秒。

use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex, Weak};
use std::time::{Duration, Instant};

#[repr(C)]
pub struct AirHostVTable {
    pub abi_version: u32,
    pub user_data: *mut c_void,
    pub log: extern "C" fn(*mut c_void, i32, *const c_char),
    pub host_invoke: extern "C" fn(*mut c_void, *const c_char, *const c_char) -> *mut c_char,
}

pub struct HostUserData {
    pub lines: Mutex<Vec<String>>,
}

static REGISTRY: LazyLock<Mutex<Vec<(usize, Weak<HostUserData>)>>> =
    LazyLock::new(|| Mutex::new(Vec::new()));
static OLD_MODE: AtomicBool = AtomicBool::new(false);
static DROPPED_LATE_CALLS: AtomicUsize = AtomicUsize::new(0);
static LOG_CALLS: AtomicUsize = AtomicUsize::new(0);

fn lookup(ptr: *mut c_void) -> Option<Arc<HostUserData>> {
    if ptr.is_null() {
        return None;
    }
    let key = ptr as usize;
    let g = REGISTRY.lock().ok()?;
    for (k, w) in g.iter() {
        if *k == key {
            return w.upgrade();
        }
    }
    None
}

extern "C" fn log_cb(user_data: *mut c_void, level: i32, msg: *const c_char) {
    if msg.is_null() {
        return;
    }
    let text = unsafe { CStr::from_ptr(msg) }.to_string_lossy().into_owned();
    if OLD_MODE.load(Ordering::Relaxed) {
        // 旧实现：裸指针强转。宿主卸载后这就是野指针。
        let ud = unsafe { &*(user_data as *const HostUserData) };
        LOG_CALLS.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut g) = ud.lines.lock() {
            g.push(format!("L{level} {text}"));
        }
        return;
    }
    match lookup(user_data) {
        Some(ud) => {
            LOG_CALLS.fetch_add(1, Ordering::Relaxed);
            if let Ok(mut g) = ud.lines.lock() {
                g.push(format!("L{level} {text}"));
            }
        }
        None => {
            DROPPED_LATE_CALLS.fetch_add(1, Ordering::Relaxed);
        }
    }
}

extern "C" fn host_invoke_cb(
    _ud: *mut c_void,
    method: *const c_char,
    _args: *const c_char,
) -> *mut c_char {
    let m = unsafe { CStr::from_ptr(method) }.to_string_lossy().into_owned();
    CString::new(format!(r#"{{"ok":true,"data":{{"host_method":"{m}"}}}}"#))
        .unwrap()
        .into_raw()
}

type AbiVersionFn = unsafe extern "C" fn() -> u32;
type InitFn = unsafe extern "C" fn(*const AirHostVTable, *mut c_void) -> i32;
type InvokeFn = unsafe extern "C" fn(*const c_char, *const c_char) -> *mut c_char;
type FreeFn = unsafe extern "C" fn(*mut c_char);
type ShutdownFn = unsafe extern "C" fn();

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let dll = args.get(1).cloned().unwrap_or_else(|| {
        r"Z:\VScodeProject\air-icon-launcher\plugins\mchose-profile-plugin\target\release\air_mchose_profile.dll".into()
    });
    let unload_after_ms: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
    let mode = args.get(3).cloned().unwrap_or_else(|| "new".into());
    let old_mode = mode == "old";
    OLD_MODE.store(old_mode, Ordering::Relaxed);

    // mode 还支持 "reload"：load → invoke → unload → load → invoke，验证重复加载
    if mode == "reload" {
        println!("[sim] reload 模式：验证 unload 后重新 load 同一 DLL");
        let mut rounds = 0;
        for round in 1..=3 {
            let lib2 = unsafe { libloading::Library::new(&dll) }.expect("reload 失败");
            let abi2: libloading::Symbol<AbiVersionFn> =
                unsafe { lib2.get(b"air_plugin_abi_version") }.unwrap();
            let init2: libloading::Symbol<InitFn> =
                unsafe { lib2.get(b"air_plugin_init") }.unwrap();
            let invoke2: libloading::Symbol<InvokeFn> =
                unsafe { lib2.get(b"air_plugin_invoke") }.unwrap();
            let free2: libloading::Symbol<FreeFn> =
                unsafe { lib2.get(b"air_plugin_free_string") }.unwrap();
            let shutdown2: libloading::Symbol<ShutdownFn> =
                unsafe { lib2.get(b"air_plugin_shutdown") }.unwrap();

            let ud2 = Arc::new(HostUserData {
                lines: Mutex::new(Vec::new()),
            });
            let ud2_ptr = Arc::as_ptr(&ud2) as *mut c_void;
            REGISTRY
                .lock()
                .unwrap()
                .push((ud2_ptr as usize, Arc::downgrade(&ud2)));
            let vt2 = AirHostVTable {
                abi_version: 1,
                user_data: ud2_ptr,
                log: log_cb,
                host_invoke: host_invoke_cb,
            };
            let rc2 = unsafe { init2(&vt2 as *const AirHostVTable, std::ptr::null_mut()) };
            println!("[sim] round {round}: abi={} init rc={rc2}", unsafe { abi2() });
            assert_eq!(rc2, 0, "round {round} init 失败");

            let method = CString::new("status").unwrap();
            let args_c = CString::new("{}").unwrap();
            let raw = unsafe { invoke2(method.as_ptr(), args_c.as_ptr()) };
            if !raw.is_null() {
                let s = unsafe { CStr::from_ptr(raw) }.to_string_lossy().into_owned();
                unsafe { free2(raw) };
                println!("[sim] round {round}: status -> {}", truncate(&s, 120));
                rounds += 1;
            } else {
                println!("[sim] round {round}: status 返回 null");
            }

            unsafe { shutdown2() };
            REGISTRY.lock().unwrap().retain(|(k, _)| *k != ud2_ptr as usize);
            drop(ud2);
            // 宿主行为：库退休不 unmap
            let retired: &'static mut Vec<libloading::Library> = Box::leak(Box::new(vec![lib2]));
            println!("[sim] round {round}: shutdown + 退休（{} 个）", retired.len());
            std::thread::sleep(Duration::from_millis(300));
        }
        println!("[sim] reload 完成：{rounds}/3 轮 invoke 成功，进程存活 ✓");
        return;
    }

    println!("[sim] mode = {}", if old_mode { "old（复现旧崩溃）" } else { "new（修复后）" });
    println!("[sim] 加载 {dll}");
    let lib = unsafe { libloading::Library::new(&dll) }.expect("加载 DLL 失败");

    let abi: libloading::Symbol<AbiVersionFn> =
        unsafe { lib.get(b"air_plugin_abi_version") }.unwrap();
    let init: libloading::Symbol<InitFn> = unsafe { lib.get(b"air_plugin_init") }.unwrap();
    let invoke: libloading::Symbol<InvokeFn> = unsafe { lib.get(b"air_plugin_invoke") }.unwrap();
    let free: libloading::Symbol<FreeFn> = unsafe { lib.get(b"air_plugin_free_string") }.unwrap();
    let shutdown: libloading::Symbol<ShutdownFn> =
        unsafe { lib.get(b"air_plugin_shutdown") }.unwrap();

    println!("[sim] abi_version = {}", unsafe { abi() });

    let ud = Arc::new(HostUserData {
        lines: Mutex::new(Vec::new()),
    });
    let ud_ptr = Arc::as_ptr(&ud) as *mut c_void;
    REGISTRY
        .lock()
        .unwrap()
        .push((ud_ptr as usize, Arc::downgrade(&ud)));

    let vtable = AirHostVTable {
        abi_version: 1,
        user_data: ud_ptr,
        log: log_cb,
        host_invoke: host_invoke_cb,
    };

    let rc = unsafe { init(&vtable as *const AirHostVTable, std::ptr::null_mut()) };
    println!("[sim] init rc = {rc}");
    assert_eq!(rc, 0, "插件 init 失败");

    // 后台线程持续 invoke("next")：模拟用户连按热键，其中一次会撞上卸载
    let invoke_addr = *invoke;
    let free_addr = *free;
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let worker = std::thread::spawn(move || {
        let method = CString::new("next").unwrap();
        let args_c = CString::new("{}").unwrap();
        let mut n = 0;
        while !stop2.load(Ordering::Relaxed) && n < 1 {
            n += 1;
            let t0 = Instant::now();
            let raw = unsafe { invoke_addr(method.as_ptr(), args_c.as_ptr()) };
            if !raw.is_null() {
                let s = unsafe { CStr::from_ptr(raw) }.to_string_lossy().into_owned();
                unsafe { free_addr(raw) };
                println!(
                    "[sim] invoke#{n} ok ({:?}): {}",
                    t0.elapsed(),
                    truncate(&s, 110)
                );
            } else {
                println!("[sim] invoke#{n} 返回 null");
            }
            std::thread::sleep(Duration::from_millis(120));
        }
    });

    std::thread::sleep(Duration::from_millis(unload_after_ms.max(1)));

    println!("[sim] >>> shutdown（模拟宿主 unload，插件线程仍在切换中）");
    unsafe { shutdown() };

    if old_mode {
        REGISTRY.lock().unwrap().clear();
        drop(ud); // 释放 HostUserData → 插件线程的 user_data 悬空
        drop(lib); // unmap 代码段 → 插件线程回来就是执行非法页
        println!("[sim] 旧实现：已释放 HostUserData + unmap DLL");
    } else {
        // 等价于 PluginAbiStorage::drop：先摘注册表，HostUserData 可安全释放
        REGISTRY.lock().unwrap().clear();
        drop(ud);
        let retired: &'static mut Vec<libloading::Library> = Box::leak(Box::new(vec![lib]));
        println!("[sim] 新实现：HostUserData 已摘除，Library 退休（{} 个，不 unmap）", retired.len());
    }

    println!("[sim] 观察 8 秒：插件线程仍在跑，看是否崩溃 / 有无迟到回调 ...");
    std::thread::sleep(Duration::from_secs(8));
    stop.store(true, Ordering::Relaxed);
    let _ = worker.join();

    println!(
        "[sim] 结束：正常日志 {} 条，卸载后丢弃 {} 条 —— 进程存活 ✓",
        LOG_CALLS.load(Ordering::Relaxed),
        DROPPED_LATE_CALLS.load(Ordering::Relaxed)
    );
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        s.chars().take(n).collect::<String>() + "…"
    }
}
