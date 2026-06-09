use crate::error::AppResult;
use crate::memory_profiler::{MemoryProfiler, MemoryStats};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn get_memory_stats(
    clipboard_state: State<'_, Arc<crate::clipboard::ClipboardState>>,
    search_state: State<'_, crate::commands::search::SearchState>,
    config_manager: State<'_, crate::config::ConfigManager>,
) -> AppResult<MemoryStats> {
    let profiler = MemoryProfiler::new();

    let clipboard_stats = profiler.analyze_clipboard_state(clipboard_state.inner());
    let search_stats = profiler.analyze_search_state_from_ref(search_state.inner());
    let config_stats = profiler.analyze_config_state_from_ref(config_manager.inner());
    let process_memory = profiler.get_process_memory();
    let recommendations = profiler.generate_recommendations(&clipboard_stats, &search_stats, &process_memory);

    let known_modules_bytes = clipboard_stats.estimated_total_bytes
        + search_stats.estimated_total_bytes
        + config_stats.estimated_total_bytes;

    let estimated_runtime_mb = 30.0;
    let estimated_shared_libraries_mb = 15.0;
    let estimated_gpu_memory_mb = 10.0;
    let estimated_rust_heap_mb = known_modules_bytes as f64 / 1024.0 / 1024.0;
    let unaccounted_mb = (process_memory.private_usage_mb
        - estimated_rust_heap_mb
        - estimated_runtime_mb
        - estimated_shared_libraries_mb
        - estimated_gpu_memory_mb)
        .max(0.0);

    let memory_breakdown = crate::memory_profiler::MemoryBreakdown {
        estimated_rust_heap_mb,
        estimated_runtime_mb,
        estimated_shared_libraries_mb,
        estimated_gpu_memory_mb,
        unaccounted_mb,
    };

    let mut module_stats = std::collections::HashMap::new();
    module_stats.insert(
        "clipboard".to_string(),
        crate::memory_profiler::ModuleMemoryInfo {
            estimated_bytes: clipboard_stats.estimated_total_bytes,
            item_count: 0,
            capacity: 0,
            description: "剪贴板历史".to_string(),
        },
    );
    module_stats.insert(
        "search".to_string(),
        crate::memory_profiler::ModuleMemoryInfo {
            estimated_bytes: search_stats.estimated_total_bytes,
            item_count: search_stats.indexed_items,
            capacity: search_stats.index_capacity,
            description: "搜索索引".to_string(),
        },
    );
    module_stats.insert(
        "config".to_string(),
        crate::memory_profiler::ModuleMemoryInfo {
            estimated_bytes: config_stats.estimated_total_bytes,
            item_count: if config_stats.config_loaded { 1 } else { 0 },
            capacity: 1,
            description: "配置文件缓存".to_string(),
        },
    );

    Ok(MemoryStats {
        process_memory,
        memory_breakdown,
        module_stats,
        clipboard_stats,
        search_stats,
        config_stats,
        recommendations,
    })
}

#[tauri::command]
pub fn force_memory_cleanup(
    _clipboard_state: State<'_, Arc<crate::clipboard::ClipboardState>>,
    search_state: State<'_, crate::commands::search::SearchState>,
) -> AppResult<String> {
    let mut report = String::new();

    // 清理搜索索引
    {
        let mut items = search_state.items.lock().unwrap();
        let before_count = items.len();
        let before_capacity = items.capacity();
        items.clear();
        items.shrink_to_fit();
        let after_count = items.len();
        let after_capacity = items.capacity();
        report.push_str(&format!(
            "搜索索引: 清理前 {} 项 (容量 {}), 清理后 {} 项 (容量 {})\n",
            before_count, before_capacity, after_count, after_capacity
        ));

        let mut index = search_state.index.lock().unwrap();
        *index = crate::search::SearchIndex::new();
        report.push_str("搜索索引已重建\n");
    }

    // 强制垃圾回收
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::System::Memory::{GetProcessHeap, HeapCompact, HEAP_FLAGS};
        use windows::Win32::System::ProcessStatus::EmptyWorkingSet;
        use windows::Win32::System::Threading::GetCurrentProcess;

        unsafe {
            if let Ok(heap) = GetProcessHeap() {
                let _ = HeapCompact(heap, HEAP_FLAGS(0));
            }
            let _ = EmptyWorkingSet(GetCurrentProcess());
        }
        report.push_str("已执行 Windows 内存整理\n");
    }

    Ok(report)
}

#[tauri::command]
pub fn get_memory_recommendations(
    clipboard_state: State<'_, Arc<crate::clipboard::ClipboardState>>,
    search_state: State<'_, crate::commands::search::SearchState>,
) -> AppResult<Vec<crate::memory_profiler::MemoryRecommendation>> {
    let profiler = MemoryProfiler::new();
    let clipboard_stats = profiler.analyze_clipboard_state(clipboard_state.inner());
    let search_stats = profiler.analyze_search_state_from_ref(search_state.inner());
    let process_memory = profiler.get_process_memory();

    Ok(profiler.generate_recommendations(&clipboard_stats, &search_stats, &process_memory))
}
