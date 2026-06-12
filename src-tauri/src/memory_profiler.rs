use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStats {
    pub process_memory: ProcessMemoryInfo,
    pub memory_breakdown: MemoryBreakdown,
    pub module_stats: HashMap<String, ModuleMemoryInfo>,
    pub clipboard_stats: ClipboardMemoryStats,
    pub search_stats: SearchMemoryStats,
    pub config_stats: ConfigMemoryStats,
    pub recommendations: Vec<MemoryRecommendation>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemoryInfo {
    pub working_set_size_mb: f64,
    pub private_usage_mb: f64,
    pub peak_working_set_size_mb: f64,
    pub page_file_usage_mb: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryBreakdown {
    pub estimated_rust_heap_mb: f64,
    pub estimated_runtime_mb: f64,
    pub estimated_shared_libraries_mb: f64,
    pub estimated_gpu_memory_mb: f64,
    pub unaccounted_mb: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleMemoryInfo {
    pub estimated_bytes: u64,
    pub item_count: usize,
    pub capacity: usize,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardMemoryStats {
    pub estimated_total_bytes: u64,
    pub database_connected: bool,
    pub images_dir_exists: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMemoryStats {
    pub indexed_items: usize,
    pub index_capacity: usize,
    pub estimated_total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigMemoryStats {
    pub config_loaded: bool,
    pub launcher_data_loaded: bool,
    pub estimated_total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRecommendation {
    pub severity: String,
    pub module: String,
    pub issue: String,
    pub suggestion: String,
    pub estimated_savings_mb: f64,
}

pub struct MemoryProfiler;

impl MemoryProfiler {
    pub fn new() -> Self {
        Self
    }

    #[cfg(target_os = "windows")]
    pub fn get_process_memory(&self) -> ProcessMemoryInfo {
        use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
        use windows::Win32::System::Threading::GetCurrentProcess;

        unsafe {
            let mut counters = PROCESS_MEMORY_COUNTERS::default();
            let size = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;

            if GetProcessMemoryInfo(
                GetCurrentProcess(),
                &mut counters as *mut _ as *mut _,
                size,
            )
            .is_ok()
            {
                ProcessMemoryInfo {
                    working_set_size_mb: counters.WorkingSetSize as f64 / 1024.0 / 1024.0,
                    private_usage_mb: counters.PagefileUsage as f64 / 1024.0 / 1024.0,
                    peak_working_set_size_mb: counters.PeakWorkingSetSize as f64 / 1024.0 / 1024.0,
                    page_file_usage_mb: counters.PagefileUsage as f64 / 1024.0 / 1024.0,
                }
            } else {
                ProcessMemoryInfo {
                    working_set_size_mb: 0.0,
                    private_usage_mb: 0.0,
                    peak_working_set_size_mb: 0.0,
                    page_file_usage_mb: 0.0,
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    pub fn get_process_memory(&self) -> ProcessMemoryInfo {
        ProcessMemoryInfo {
            working_set_size_mb: 0.0,
            private_usage_mb: 0.0,
            peak_working_set_size_mb: 0.0,
            page_file_usage_mb: 0.0,
        }
    }

    pub fn analyze_clipboard_state(
        &self,
        clipboard_state: &Arc<crate::clipboard::ClipboardState>,
    ) -> ClipboardMemoryStats {
        let _config = clipboard_state.config.lock().unwrap();
        let database = clipboard_state.database.lock().unwrap();

        let estimated_total_bytes = 0u64;

        ClipboardMemoryStats {
            estimated_total_bytes,
            database_connected: database.is_some(),
            images_dir_exists: clipboard_state
                .images_dir
                .lock()
                .unwrap()
                .exists(),
        }
    }

    #[allow(dead_code)]
    pub fn analyze_search_state(
        &self,
        search_state: &Arc<crate::commands::search::SearchState>,
    ) -> SearchMemoryStats {
        let items = search_state.items.lock().unwrap();
        let _index = search_state.index.lock().unwrap();

        let indexed_items = items.len();
        let index_capacity = items.capacity();

        // 估算内存使用
        let estimated_item_size = 200; // 每个搜索项大约 200 字节
        let estimated_total_bytes = (indexed_items * estimated_item_size) as u64;

        SearchMemoryStats {
            indexed_items,
            index_capacity,
            estimated_total_bytes,
        }
    }

    pub fn analyze_search_state_from_ref(
        &self,
        search_state: &crate::commands::search::SearchState,
    ) -> SearchMemoryStats {
        let items = search_state.items.lock().unwrap();
        let _index = search_state.index.lock().unwrap();

        let indexed_items = items.len();
        let index_capacity = items.capacity();

        // 估算内存使用
        let estimated_item_size = 200; // 每个搜索项大约 200 字节
        let estimated_total_bytes = (indexed_items * estimated_item_size) as u64;

        SearchMemoryStats {
            indexed_items,
            index_capacity,
            estimated_total_bytes,
        }
    }

    pub fn analyze_config_state_from_ref(
        &self,
        config_manager: &crate::config::ConfigManager,
    ) -> ConfigMemoryStats {
        // ConfigManager 使用 cached_config 缓存 AppConfig，避免重复磁盘读取
        // 这里检查配置文件是否存在，以及缓存是否已填充
        let config_path = config_manager.config_path();
        let launcher_data_path = config_manager.launcher_data_path();

        let config_loaded = config_path.exists();
        let launcher_data_loaded = launcher_data_path.exists();

        // 估算配置文件大小（缓存后这些字节也在堆内存中）
        let config_size = if config_loaded {
            std::fs::metadata(&config_path)
                .map(|m| m.len())
                .unwrap_or(0)
        } else {
            0
        };

        let launcher_data_size = if launcher_data_loaded {
            std::fs::metadata(&launcher_data_path)
                .map(|m| m.len())
                .unwrap_or(0)
        } else {
            0
        };

        ConfigMemoryStats {
            config_loaded,
            launcher_data_loaded,
            estimated_total_bytes: config_size + launcher_data_size,
        }
    }

    #[allow(dead_code)]
    pub fn analyze_config_state(
        &self,
        config_manager: &Arc<crate::config::ConfigManager>,
    ) -> ConfigMemoryStats {
        // ConfigManager 使用 cached_config 缓存 AppConfig，避免重复磁盘读取
        // 这里检查配置文件是否存在，以及缓存是否已填充
        let config_path = config_manager.config_path();
        let launcher_data_path = config_manager.launcher_data_path();

        let config_loaded = config_path.exists();
        let launcher_data_loaded = launcher_data_path.exists();

        // 估算配置文件大小
        let config_size = if config_loaded {
            std::fs::metadata(&config_path)
                .map(|m| m.len())
                .unwrap_or(0)
        } else {
            0
        };

        let launcher_data_size = if launcher_data_loaded {
            std::fs::metadata(&launcher_data_path)
                .map(|m| m.len())
                .unwrap_or(0)
        } else {
            0
        };

        ConfigMemoryStats {
            config_loaded,
            launcher_data_loaded,
            estimated_total_bytes: config_size + launcher_data_size,
        }
    }

    pub fn generate_recommendations(
        &self,
        _clipboard_stats: &ClipboardMemoryStats,
        search_stats: &SearchMemoryStats,
        config_stats: &ConfigMemoryStats,
        process_memory: &ProcessMemoryInfo,
    ) -> Vec<MemoryRecommendation> {
        let mut recommendations = Vec::new();

        if search_stats.indexed_items > 300 {
            recommendations.push(MemoryRecommendation {
                severity: "info".to_string(),
                module: "search".to_string(),
                issue: format!("搜索索引项较多: {} 项", search_stats.indexed_items),
                suggestion: "优先考虑启用拼音缓存和搜索候选向量复用，而不是扩大索引常驻内存。".to_string(),
                estimated_savings_mb: (search_stats.estimated_total_bytes as f64) / 1024.0 / 1024.0 * 0.2,
            });
        }

        if config_stats.estimated_total_bytes > 0 {
            recommendations.push(MemoryRecommendation {
                severity: "info".to_string(),
                module: "config".to_string(),
                issue: "配置已缓存，但 launcher_data 仍每次从磁盘读取".to_string(),
                suggestion: "考虑为 launcher_data 引入类似 AppConfig 的缓存机制，减少磁盘 IO。".to_string(),
                estimated_savings_mb: 0.0,
            });
        }

        if process_memory.private_usage_mb > 500.0 {
            recommendations.push(MemoryRecommendation {
                severity: "critical".to_string(),
                module: "process".to_string(),
                issue: format!(
                    "进程内存占用过高: {:.1} MB (私有使用)",
                    process_memory.private_usage_mb
                ),
                suggestion: "检查是否有内存泄漏或考虑重启应用".to_string(),
                estimated_savings_mb: 0.0,
            });
        } else if process_memory.private_usage_mb > 200.0 {
            recommendations.push(MemoryRecommendation {
                severity: "warning".to_string(),
                module: "process".to_string(),
                issue: format!(
                    "进程内存占用较高: {:.1} MB (私有使用)",
                    process_memory.private_usage_mb
                ),
                suggestion: "监控内存增长趋势，必要时重启应用".to_string(),
                estimated_savings_mb: 0.0,
            });
        }

        if process_memory.peak_working_set_size_mb > process_memory.working_set_size_mb * 2.0 {
            recommendations.push(MemoryRecommendation {
                severity: "info".to_string(),
                module: "process".to_string(),
                issue: format!(
                    "内存峰值过高: {:.1} MB (当前: {:.1} MB)",
                    process_memory.peak_working_set_size_mb, process_memory.working_set_size_mb
                ),
                suggestion: "可能存在临时大量内存分配，检查批量操作".to_string(),
                estimated_savings_mb: 0.0,
            });
        }

        recommendations
    }

    #[allow(dead_code)]
    pub fn collect_stats(
        &self,
        clipboard_state: Option<&Arc<crate::clipboard::ClipboardState>>,
        search_state: Option<&Arc<crate::commands::search::SearchState>>,
        config_manager: Option<&Arc<crate::config::ConfigManager>>,
    ) -> MemoryStats {
        let process_memory = self.get_process_memory();

        let clipboard_stats = clipboard_state
            .map(|state| self.analyze_clipboard_state(state))
            .unwrap_or_else(|| ClipboardMemoryStats {
                estimated_total_bytes: 0,
                database_connected: false,
                images_dir_exists: false,
            });

        let search_stats = search_state
            .map(|state| self.analyze_search_state_from_ref(state))
            .unwrap_or_else(|| SearchMemoryStats {
                indexed_items: 0,
                index_capacity: 0,
                estimated_total_bytes: 0,
            });

        let config_stats = config_manager
            .map(|manager| self.analyze_config_state_from_ref(manager))
            .unwrap_or_else(|| ConfigMemoryStats {
                config_loaded: false,
                launcher_data_loaded: false,
                estimated_total_bytes: 0,
            });

        let recommendations =
            self.generate_recommendations(&clipboard_stats, &search_stats, &config_stats, &process_memory);

        let mut module_stats = HashMap::new();
        module_stats.insert(
            "clipboard".to_string(),
            ModuleMemoryInfo {
                estimated_bytes: clipboard_stats.estimated_total_bytes,
                item_count: 0,
                capacity: 0,
                description: "剪贴板历史".to_string(),
            },
        );
        module_stats.insert(
            "search".to_string(),
            ModuleMemoryInfo {
                estimated_bytes: search_stats.estimated_total_bytes,
                item_count: search_stats.indexed_items,
                capacity: search_stats.index_capacity,
                description: "搜索索引".to_string(),
            },
        );
        module_stats.insert(
            "config".to_string(),
            ModuleMemoryInfo {
                estimated_bytes: config_stats.estimated_total_bytes,
                item_count: if config_stats.config_loaded { 1 } else { 0 },
                capacity: 1,
                description: "配置文件缓存".to_string(),
            },
        );

        // 计算内存分布
        let known_modules_bytes = clipboard_stats.estimated_total_bytes
            + search_stats.estimated_total_bytes
            + config_stats.estimated_total_bytes;
        
        // Tauri + WebView2 运行时通常占用 20-40 MB
        let estimated_runtime_mb = 30.0;
        // 系统 DLL 共享库通常占用 10-20 MB
        let estimated_shared_libraries_mb = 15.0;
        // GPU 内存（DirectX/OpenGL）通常占用 5-15 MB
        let estimated_gpu_memory_mb = 10.0;
        
        let known_modules_mb = known_modules_bytes as f64 / 1024.0 / 1024.0;
        let estimated_rust_heap_mb = known_modules_mb;
        
        // 计算未分类内存
        let unaccounted_mb = process_memory.private_usage_mb
            - estimated_rust_heap_mb
            - estimated_runtime_mb
            - estimated_shared_libraries_mb
            - estimated_gpu_memory_mb;
        
        let memory_breakdown = MemoryBreakdown {
            estimated_rust_heap_mb,
            estimated_runtime_mb,
            estimated_shared_libraries_mb,
            estimated_gpu_memory_mb,
            unaccounted_mb: unaccounted_mb.max(0.0),
        };

        MemoryStats {
            process_memory,
            memory_breakdown,
            module_stats,
            clipboard_stats,
            search_stats,
            config_stats,
            recommendations,
        }
    }
}

impl Default for MemoryProfiler {
    fn default() -> Self {
        Self::new()
    }
}
