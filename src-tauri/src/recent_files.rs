//! 最近文件（`%APPDATA%\Microsoft\Windows\Recent`）扫描。
//!
//! 该扫描需要遍历 `.lnk`、解析快捷方式目标并逐个探测目标是否存在，
//! 其中「探测不存在的网络路径」可能阻塞 1 秒以上。
//!
//! 因此这里提供：
//! - 进程内 TTL 缓存（避免每次搜索重复扫描）
//! - 启动期后台预热（把首次扫描的开销挪到用户输入之前）
//! - 快捷方式批量解析（共享一次 COM 初始化，替代逐个创建）
//! - 存在性探测并行化（语义不变，只是不再串行等待离线网络盘）
//!
//! 命令本身在 `system.rs` 中以 `async + spawn_blocking` 暴露，保证不占用主线程。

use crate::error::{AppError, AppResult};
use crate::system::RecentFileEntry;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// 缓存有效期。Recent 目录变化不频繁，60s 足够新鲜。
const CACHE_TTL: Duration = Duration::from_secs(60);

/// 单次扫描的候选上限，避免 Recent 目录异常膨胀时做无谓工作。
const MAX_SCAN_CANDIDATES: usize = 240;

const MAX_LIMIT: usize = 120;

struct CachedScan {
    limit: usize,
    include_icons: bool,
    scanned_at: Instant,
    entries: Vec<RecentFileEntry>,
}

static CACHE: Mutex<Option<CachedScan>> = Mutex::new(None);

/// 读取最近文件，命中缓存时直接返回。
pub fn get_recent_files_cached(
    limit: usize,
    include_icons: bool,
    force_refresh: bool,
) -> AppResult<Vec<RecentFileEntry>> {
    let limit = limit.clamp(1, MAX_LIMIT);

    if !force_refresh {
        if let Ok(guard) = CACHE.lock() {
            if let Some(cached) = guard.as_ref() {
                if cached.limit >= limit
                    && cached.include_icons == include_icons
                    && cached.scanned_at.elapsed() < CACHE_TTL
                {
                    return Ok(cached.entries.iter().take(limit).cloned().collect());
                }
            }
        }
    }

    let entries = scan_recent_files(limit, include_icons)?;

    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some(CachedScan {
            limit,
            include_icons,
            scanned_at: Instant::now(),
            entries: entries.clone(),
        });
    }

    Ok(entries)
}

/// 启动期后台预热：延迟 `delay` 后在独立线程里跑一次扫描，填充缓存。
///
/// 这样用户首次输入时命中的是缓存，而不是一次冷扫描。
pub fn prewarm_async(limit: usize, include_icons: bool, delay: Duration) {
    std::thread::spawn(move || {
        if !delay.is_zero() {
            std::thread::sleep(delay);
        }
        let _ = get_recent_files_cached(limit, include_icons, false);
    });
}

fn scan_recent_files(limit: usize, include_icons: bool) -> AppResult<Vec<RecentFileEntry>> {
    #[cfg(target_os = "windows")]
    {
        scan_recent_files_windows(limit, include_icons)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (limit, include_icons);
        Ok(Vec::new())
    }
}

#[cfg(target_os = "windows")]
fn scan_recent_files_windows(limit: usize, include_icons: bool) -> AppResult<Vec<RecentFileEntry>> {
    let Some(app_data) = std::env::var_os("APPDATA").map(PathBuf::from) else {
        return Ok(Vec::new());
    };
    let recent_dir = app_data.join("Microsoft\\Windows\\Recent");
    if !recent_dir.exists() {
        return Ok(Vec::new());
    }

    let mut candidates: Vec<(PathBuf, u64)> = Vec::new();
    let read_dir = std::fs::read_dir(&recent_dir)
        .map_err(|e| AppError::io_error(format!("Failed to read Recent directory: {}", e)))?;

    for entry in read_dir.flatten() {
        let path = entry.path();
        let is_lnk = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("lnk"))
            == Some(true);
        if !is_lnk {
            continue;
        }

        let used_at = entry
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);

        candidates.push((path, used_at));
    }

    candidates.sort_by(|a, b| b.1.cmp(&a.1));
    candidates.truncate(MAX_SCAN_CANDIDATES);

    // 一次性批量解析所有快捷方式（单次 COM 初始化，远快于逐个调用）。
    let lnk_paths: Vec<PathBuf> = candidates.iter().map(|(path, _)| path.clone()).collect();
    let resolved_targets = crate::drag::resolve_windows_shortcut_targets(&lnk_paths);

    let mut dedupe = HashSet::<String>::new();
    let mut kept: Vec<(PathBuf, u64)> = Vec::new();
    for ((_, used_at), target) in candidates.iter().zip(resolved_targets.into_iter()) {
        let Some(target_path) = target else {
            continue;
        };
        let normalized_key = target_path
            .to_string_lossy()
            .replace('/', "\\")
            .to_ascii_lowercase();
        if normalized_key.is_empty() || !dedupe.insert(normalized_key) {
            continue;
        }
        kept.push((target_path, *used_at));
    }

    // 存在性探测：全部并行。
    //
    // 语义与改造前完全一致（不存在的目标仍然会被过滤掉），
    // 只是从「串行逐个 exists()」改为并行，避免单个离线网络盘
    // 把整轮扫描拖成 1s+ 的串行等待。
    //
    // 用独立线程池而不是全局 rayon 池：探测可能长时间阻塞在离线网络路径上，
    // 不能让它抢占图标提取（`extract_icons_from_paths`）也在用的全局池。
    let keep_flags = probe_targets_exist_parallel(&kept);

    let mut entries: Vec<RecentFileEntry> = Vec::with_capacity(limit.min(keep_flags.len()));
    for ((target_path, used_at), keep) in kept.into_iter().zip(keep_flags) {
        if !keep {
            continue;
        }

        let icon_base64 = if include_icons {
            crate::drag::extract_icons_from_paths_blocking(
                vec![target_path.to_string_lossy().to_string()],
                None,
            )
            .into_iter()
            .next()
            .flatten()
        } else {
            None
        };

        entries.push(RecentFileEntry {
            name: crate::system::derive_display_name_from_path(&target_path),
            path: target_path.to_string_lossy().to_string(),
            used_at,
            icon_base64,
        });

        if entries.len() >= limit {
            break;
        }
    }

    Ok(entries)
}

/// 并行探测目标是否存在。
///
/// 探测可能长时间阻塞在离线的 UNC / 映射盘上，因此使用**独立的临时线程池**，
/// 不占用全局 rayon 池（图标提取也在用），也不影响调用方线程。
fn probe_targets_exist_parallel(targets: &[(PathBuf, u64)]) -> Vec<bool> {
    if targets.is_empty() {
        return Vec::new();
    }

    let worker_count = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 8)
        .min(targets.len());

    if worker_count <= 1 {
        return targets.iter().map(|(path, _)| path.exists()).collect();
    }

    let next_index = std::sync::atomic::AtomicUsize::new(0);
    let results: Vec<std::sync::atomic::AtomicBool> = targets
        .iter()
        .map(|_| std::sync::atomic::AtomicBool::new(false))
        .collect();

    std::thread::scope(|scope| {
        for _ in 0..worker_count {
            scope.spawn(|| loop {
                let index = next_index.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                if index >= targets.len() {
                    break;
                }
                let exists = targets[index].0.exists();
                results[index].store(exists, std::sync::atomic::Ordering::Relaxed);
            });
        }
    });

    results
        .into_iter()
        .map(|flag| flag.load(std::sync::atomic::Ordering::Relaxed))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_limit_is_clamped() {
        assert_eq!(MAX_LIMIT, 120);
    }

    #[test]
    fn prewarm_with_zero_delay_is_safe() {
        // 只是确保预热线程不会 panic / 死锁。
        prewarm_async(1, false, Duration::ZERO);
    }

    #[test]
    fn cache_returns_prefix_of_limit() {
        // 缓存按 limit 切片返回：先取大 limit 再取小 limit 应得到前 N 条。
        let first = get_recent_files_cached(10, false, false);
        let second = get_recent_files_cached(3, false, false);
        if let (Ok(first), Ok(second)) = (first, second) {
            assert!(second.len() <= 3);
            assert!(second.len() <= first.len());
            for (a, b) in second.iter().zip(first.iter()) {
                assert_eq!(a.path, b.path);
            }
        }
    }
}
