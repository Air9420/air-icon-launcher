use super::types::{simple_hash, ClipboardConfig, ClipboardRecord};
use crate::clipboard::image::{get_clipboard_image, save_image_atomic};
use crate::clipboard::platform::get_clipboard_text;
use crate::clipboard::ClipboardState;
use crate::db::{ClipboardDatabase, ClipboardRecordDb};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
#[cfg(not(target_os = "windows"))]
use std::thread;
#[cfg(not(target_os = "windows"))]
use std::time::Duration;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri::{Emitter, Manager};

/// 检测文本内容是否为代码
fn detect_code_subtype(text: &str) -> Option<String> {
    let trimmed = text.trim();
    
    // 代码特征模式
    let code_patterns = [
        // 常见代码关键字
        "function ", "const ", "let ", "var ", "class ", "import ", "export ",
        "def ", "return ", "if (", "for (", "while (", "switch (",
        "public ", "private ", "protected ", "static ", "void ", "int ",
        "#include", "#define", "#pragma",
        // 常见代码符号组合
        "({", "})", "=>", "->", "::", "&&", "||", "!=",
        // 常见代码结构
        "};", "];", ");", "{\n", "}\n",
        // HTML/XML
        "</div>", "</span>", "<script", "<style", "<template",
        // Shell/命令行
        "$ ", "#!/", "sudo ", "chmod ", "mkdir ",
        // SQL
        "SELECT ", "INSERT ", "UPDATE ", "DELETE ", "CREATE TABLE",
        // JSON
        "\"\":", "\"\": ",
    ];
    
    let code_keyword_count = code_patterns.iter()
        .filter(|pattern| trimmed.contains(*pattern))
        .count();
    
    // 如果匹配多个代码特征，认为是代码
    if code_keyword_count >= 2 {
        return Some("code".to_string());
    }
    
    // 检查是否有多行且有缩进（代码的常见特征）
    let lines: Vec<&str> = trimmed.lines().collect();
    if lines.len() >= 3 {
        let indented_lines = lines.iter()
            .filter(|line| line.starts_with("    ") || line.starts_with("\t"))
            .count();
        if indented_lines >= 2 {
            return Some("code".to_string());
        }
    }
    
    None
}

pub struct EventDeduplicator {
    last_event_hash: Option<String>,
    last_event_time: Option<Instant>,
}

impl EventDeduplicator {
    pub fn new() -> Self {
        Self {
            last_event_hash: None,
            last_event_time: None,
        }
    }

    pub fn should_process(&mut self, hash: &str) -> bool {
        let now = Instant::now();

        if let (Some(ref last_hash), Some(last_time)) =
            (&self.last_event_hash, &self.last_event_time)
        {
            if last_hash == hash && now.duration_since(*last_time).as_millis() < 100 {
                return false;
            }
        }

        self.last_event_hash = Some(hash.to_string());
        self.last_event_time = Some(now);
        true
    }
}

#[cfg(target_os = "windows")]
use crate::clipboard_listener::listen_clipboard;
#[cfg(target_os = "windows")]
use crate::clipboard_listener::stop_clipboard_listener;

#[cfg(target_os = "windows")]
struct ClipboardMonitor {
    _dummy: (),
}

#[cfg(target_os = "windows")]
impl ClipboardMonitor {
    fn new() -> Option<Self> {
        Some(Self { _dummy: () })
    }
}

#[cfg(not(target_os = "windows"))]
struct ClipboardMonitor {
    _dummy: (),
}

#[cfg(not(target_os = "windows"))]
impl ClipboardMonitor {
    fn new() -> Option<Self> {
        Some(Self { _dummy: () })
    }
}

pub fn get_default_storage_path(app_handle: &AppHandle) -> PathBuf {
    if let Some(app_data_dir) = app_handle.path().app_data_dir().ok() {
        let _ = std::fs::create_dir_all(&app_data_dir);
        app_data_dir.join("clipboard_history")
    } else {
        std::env::temp_dir().join("air_icon_launcher_clipboard_history")
    }
}

pub fn start_clipboard_monitor(app_handle: AppHandle, state: Arc<ClipboardState>) {
    let is_monitoring = state.is_monitoring.clone();
    {
        let mut monitoring = is_monitoring.lock().unwrap();
        if *monitoring {
            return;
        }
        *monitoring = true;
    }

    let max_records = {
        let config = state.config.lock().unwrap();
        config.max_records
    };

    if let Some(db) = state.database.lock().unwrap().as_ref() {
        if max_records > 0 {
            let protected_hashes = state.favorite_hashes.lock().unwrap().clone();
            if let Ok(pruned) =
                db.enforce_max_records_with_protected(max_records, &protected_hashes)
            {
                for record in pruned {
                    if let Some(image_path) = record.image_path {
                        if !image_path.is_empty() {
                            let _ = std::fs::remove_file(image_path);
                        }
                    }
                }
            }
        }

        if let Ok(Some(latest)) = db.get_latest() {
            let mut hash = state.last_content_hash.lock().unwrap();
            *hash = latest.hash;
        }
    }

    let last_content_hash = state.last_content_hash.clone();
    let is_monitoring_clone = is_monitoring.clone();
    let config = state.config.clone();
    let images_dir = state.images_dir.clone();
    let database = state.database.clone();
    let app_handle_clone = app_handle.clone();

    let _monitor = ClipboardMonitor::new();

    #[cfg(target_os = "windows")]
    {
        let callback = Arc::new(move || {
            let monitoring = is_monitoring_clone.lock().unwrap();
            if !*monitoring {
                return;
            }
            drop(monitoring);

            let mut dedup = EventDeduplicator::new();
            process_clipboard_change(
                &last_content_hash,
                &config,
                &images_dir,
                &database,
                &app_handle_clone,
                &mut dedup,
            );
        });

        listen_clipboard(callback);
    }

    #[cfg(not(target_os = "windows"))]
    {
        thread::spawn(move || {
            let mut dedup = EventDeduplicator::new();

            loop {
                {
                    let monitoring = is_monitoring_clone.lock().unwrap();
                    if !*monitoring {
                        break;
                    }
                }

                process_clipboard_change(
                    &last_content_hash,
                    &config,
                    &images_dir,
                    &database,
                    &app_handle_clone,
                    &mut dedup,
                );

                thread::sleep(Duration::from_millis(100));
            }
        });
    }
}

pub fn stop_clipboard_monitor(state: &Arc<ClipboardState>) {
    {
        let mut monitoring = state.is_monitoring.lock().unwrap();
        *monitoring = false;
    }

    #[cfg(target_os = "windows")]
    {
        stop_clipboard_listener();
    }
}

fn process_clipboard_change(
    last_content_hash: &Arc<Mutex<String>>,
    config: &Arc<Mutex<ClipboardConfig>>,
    images_dir: &Arc<Mutex<PathBuf>>,
    database: &Arc<Mutex<Option<ClipboardDatabase>>>,
    app_handle: &AppHandle,
    dedup: &mut EventDeduplicator,
) -> Option<ClipboardRecord> {
    let max_image_size = {
        let cfg = config.lock().unwrap();
        (cfg.max_image_size_mb * 1024.0 * 1024.0) as usize
    };

    if let Some(image_data) = get_clipboard_image() {
        if image_data.len() <= max_image_size {
            let hash = simple_hash(&image_data);

            if !dedup.should_process(&hash) {
                return None;
            }

            let should_process = {
                let mut last = last_content_hash.lock().unwrap();
                if *last != hash {
                    *last = hash.clone();
                    true
                } else {
                    false
                }
            };

            if should_process {
                if let Some(db) = database.lock().unwrap().as_ref() {
                    if db.hash_exists(&hash).unwrap_or(false) {
                        return None;
                    }
                }

                let id = generate_id();
                let images_dir_path = images_dir.lock().unwrap().clone();
                let image_path = save_image_atomic(&images_dir_path, &id, &image_data).ok();

                let record = ClipboardRecord {
                    id,
                    record_type: "image".to_string(),
                    content_subtype: None,
                    text_content: None,
                    image_path,
                    hash: hash.clone(),
                    timestamp: get_timestamp(),
                    is_favorite: false,
                };

                if let Some(db) = database.lock().unwrap().as_ref() {
                    let db_record: ClipboardRecordDb = (&record).into();
                    let _ = db.insert(&db_record);
                }

                let _ = app_handle.emit("clipboard-changed", record.clone());
                return Some(record);
            }
        }
    } else if let Some(text) = get_clipboard_text() {
        if !text.is_empty() {
            let hash = simple_hash(text.as_bytes());

            if !dedup.should_process(&hash) {
                return None;
            }

            let should_process = {
                let mut last = last_content_hash.lock().unwrap();
                if *last != hash {
                    *last = hash.clone();
                    true
                } else {
                    false
                }
            };

            if should_process {
                if let Some(db) = database.lock().unwrap().as_ref() {
                    if db.hash_exists(&hash).unwrap_or(false) {
                        return None;
                    }
                }

                let content_subtype = detect_code_subtype(&text);

                let record = ClipboardRecord {
                    id: generate_id(),
                    record_type: "text".to_string(),
                    content_subtype,
                    text_content: Some(text.clone()),
                    image_path: None,
                    hash: hash.clone(),
                    timestamp: get_timestamp(),
                    is_favorite: false,
                };

                if let Some(db) = database.lock().unwrap().as_ref() {
                    let db_record: ClipboardRecordDb = (&record).into();
                    let _ = db.insert(&db_record);
                }

                let _ = app_handle.emit("clipboard-changed", record.clone());
                return Some(record);
            }
        }
    }
    None
}

fn generate_id() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let random: u32 = rand();
    format!("cb-{}-{:08x}", ts, random)
}

fn rand() -> u32 {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let state = RandomState::new();
    let mut hasher = state.build_hasher();
    hasher.write_u32(get_timestamp() as u32);
    hasher.finish() as u32
}

fn get_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
