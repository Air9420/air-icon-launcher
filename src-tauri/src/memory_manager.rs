use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::State;
use tokio::sync::watch;
use tokio::time::{sleep, Duration};

#[cfg(target_os = "windows")]
use windows::Win32::System::Memory::{GetProcessHeap, HeapCompact, HEAP_FLAGS};
#[cfg(target_os = "windows")]
use windows::Win32::System::ProcessStatus::EmptyWorkingSet;
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::GetCurrentProcess;

const LEVEL_1_DELAY_SECS: u64 = 60;
const LEVEL_2_DELAY_SECS: u64 = 5 * 60;
const LEVEL_3_DELAY_SECS: u64 = 15 * 60;

/// 内存管理器
pub struct MemoryManager {
    task_handle: Option<tauri::async_runtime::JoinHandle<()>>,
    cancel_sender: Option<watch::Sender<bool>>,
    enabled: Arc<AtomicBool>,
}

/// 共享内存管理器状态
pub(crate) struct MemoryManagerState {
    manager: std::sync::Mutex<MemoryManager>,
}

impl MemoryManagerState {
    pub(crate) fn new(manager: MemoryManager) -> Self {
        Self {
            manager: std::sync::Mutex::new(manager),
        }
    }

    pub fn start(&self) -> Result<(), String> {
        let mut manager = self
            .manager
            .lock()
            .map_err(|_| "Failed to lock memory manager state".to_string())?;
        manager.start();
        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut manager = self
            .manager
            .lock()
            .map_err(|_| "Failed to lock memory manager state".to_string())?;
        manager.stop();
        Ok(())
    }
}

#[tauri::command]
pub fn start_memory_release(state: State<'_, MemoryManagerState>) -> Result<(), String> {
    state.start()
}

#[tauri::command]
pub fn stop_memory_release(state: State<'_, MemoryManagerState>) -> Result<(), String> {
    state.stop()
}

impl MemoryManager {
    pub fn new() -> Self {
        Self {
            task_handle: None,
            cancel_sender: None,
            enabled: Arc::new(AtomicBool::new(true)),
        }
    }

    /// 设置启用状态
    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Relaxed);
    }

    /// 启动内存管理任务
    pub fn start(&mut self) {
        // 如果已禁用，不启动
        if !self.enabled.load(Ordering::Relaxed) {
            println!("[MemoryManager] 功能已禁用，不启动");
            return;
        }

        // 已有任务在运行时直接返回，避免反复 stop/start 造成抖动和竞态
        if self.task_handle.is_some() {
            println!("[MemoryManager] 任务已在运行，跳过重复启动");
            return;
        }

        println!("[MemoryManager] 启动内存释放任务");
        let (cancel_sender, cancel_receiver) = watch::channel(false);
        self.cancel_sender = Some(cancel_sender);

        let handle = tauri::async_runtime::spawn(async move {
            Self::run_memory_release_task(cancel_receiver).await;
        });

        self.task_handle = Some(handle);
    }

    /// 停止内存管理任务
    pub fn stop(&mut self) {
        if let Some(sender) = self.cancel_sender.take() {
            let _ = sender.send(true);
        }

        if let Some(handle) = self.task_handle.take() {
            println!("[MemoryManager] 停止内存释放任务");
            handle.abort();
        }
    }

    /// 运行内存释放任务
    async fn run_memory_release_task(mut cancel_receiver: watch::Receiver<bool>) {
        // Level 1: 1分钟后释放工作集
        tokio::select! {
            _ = sleep(Duration::from_secs(LEVEL_1_DELAY_SECS)) => {
                println!("[MemoryManager] Level 1: 释放工作集");
                Self::release_level_1();
            }
            _ = cancel_receiver.changed() => {
                println!("[MemoryManager] 任务被取消");
                return;
            }
        }

        // Level 2: 5分钟后释放工作集 + 堆压缩
        tokio::select! {
            _ = sleep(Duration::from_secs(LEVEL_2_DELAY_SECS - LEVEL_1_DELAY_SECS)) => {
                println!("[MemoryManager] Level 2: 释放工作集 + 堆压缩");
                Self::release_level_2();
            }
            _ = cancel_receiver.changed() => {
                println!("[MemoryManager] 任务被取消");
                return;
            }
        }

        // Level 3: 15分钟后激进释放
        tokio::select! {
            _ = sleep(Duration::from_secs(LEVEL_3_DELAY_SECS - LEVEL_2_DELAY_SECS)) => {
                println!("[MemoryManager] Level 3: 激进释放");
                Self::release_level_3();
            }
            _ = cancel_receiver.changed() => {
                println!("[MemoryManager] 任务被取消");
                return;
            }
        }
    }

    /// Level 1: 释放工作集
    fn release_level_1() {
        #[cfg(target_os = "windows")]
        unsafe {
            let _ = EmptyWorkingSet(GetCurrentProcess());
        }
    }

    /// Level 2: 释放工作集 + 堆压缩
    fn release_level_2() {
        #[cfg(target_os = "windows")]
        unsafe {
            let _ = EmptyWorkingSet(GetCurrentProcess());
            if let Ok(heap) = GetProcessHeap() {
                let _ = HeapCompact(heap, HEAP_FLAGS(0));
            }
        }
    }

    /// Level 3: 激进释放
    fn release_level_3() {
        #[cfg(target_os = "windows")]
        unsafe {
            let _ = EmptyWorkingSet(GetCurrentProcess());
            if let Ok(heap) = GetProcessHeap() {
                let _ = HeapCompact(heap, HEAP_FLAGS(0));
            }
            // 使用SetProcessWorkingSetSizeEx，如果不可用则跳过
            // 注意：这个API可能在某些Windows版本中不可用
        }
    }
}

impl Drop for MemoryManager {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_memory_manager_new() {
        let manager = MemoryManager::new();
        assert!(manager.enabled.load(Ordering::Relaxed));
        assert!(manager.task_handle.is_none());
        assert!(manager.cancel_sender.is_none());
    }

    #[test]
    fn test_memory_manager_set_enabled() {
        let manager = MemoryManager::new();
        assert!(manager.enabled.load(Ordering::Relaxed));

        manager.set_enabled(false);
        assert!(!manager.enabled.load(Ordering::Relaxed));

        manager.set_enabled(true);
        assert!(manager.enabled.load(Ordering::Relaxed));
    }

    #[test]
    fn test_memory_manager_start_stop() {
        let mut manager = MemoryManager::new();
        
        // 启动任务
        manager.start();
        assert!(manager.task_handle.is_some());
        assert!(manager.cancel_sender.is_some());
        
        // 停止任务
        manager.stop();
        assert!(manager.task_handle.is_none());
        assert!(manager.cancel_sender.is_none());
    }

    #[test]
    fn test_memory_manager_disabled() {
        let mut manager = MemoryManager::new();
        
        // 禁用管理器
        manager.set_enabled(false);
        
        // 尝试启动任务
        manager.start();
        assert!(manager.task_handle.is_none());
    }

    #[test]
    fn test_memory_manager_start_is_idempotent() {
        let mut manager = MemoryManager::new();

        manager.start();
        let first_handle = manager.task_handle.is_some();
        let first_sender = manager.cancel_sender.is_some();

        manager.start();

        assert!(first_handle);
        assert!(first_sender);
        assert!(manager.task_handle.is_some());
        assert!(manager.cancel_sender.is_some());

        manager.stop();
    }

    #[test]
    fn test_memory_manager_start_does_not_restart_running_task() {
        let mut manager = MemoryManager::new();

        manager.start();
        assert!(manager.task_handle.is_some());
        assert!(manager.cancel_sender.is_some());

        manager.start();

        assert!(manager.task_handle.is_some());
        assert!(manager.cancel_sender.is_some());

        manager.stop();
    }

    #[test]
    fn test_memory_manager_stop_is_idempotent() {
        let mut manager = MemoryManager::new();

        manager.stop();
        manager.stop();

        assert!(manager.task_handle.is_none());
        assert!(manager.cancel_sender.is_none());
    }

    #[test]
    fn test_memory_release_levels() {
        // 测试内存释放函数不会 panic
        MemoryManager::release_level_1();
        MemoryManager::release_level_2();
        MemoryManager::release_level_3();
    }

    #[test]
    fn test_memory_release_delays_use_production_values() {
        assert_eq!(LEVEL_1_DELAY_SECS, 60);
        assert_eq!(LEVEL_2_DELAY_SECS, 5 * 60);
        assert_eq!(LEVEL_3_DELAY_SECS, 15 * 60);
    }

}
