use super::types::{ClipboardConfig, ClipboardRecord};
use crate::clipboard::cache::{ClipboardCache, EventDeduplicator};
use crate::clipboard::image::{get_clipboard_image, save_image_atomic};
use crate::clipboard::platform::{get_clipboard_text, set_clipboard_text};
use crate::clipboard::ClipboardState;
use crossbeam_channel::{bounded, Receiver, Sender};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri::{Emitter, Manager};

#[cfg(target_os = "windows")]
use crate::clipboard_listener::listen_clipboard;

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

    let max_records = state.config.lock().unwrap().max_records;
    if let Some(db) = state.database.lock().unwrap().as_ref() {
        if max_records > 0 {
            if let Ok(images) = db.enforce_max_records(max_records) {
                for image_path in images {
                    let _ = std::fs::remove_file(image_path);
                }
            }
        }

        if let Ok(records) = db.get_all() {
            let mut cache = state.cache.lock().unwrap();
            for record in records {
                let clipboard_record: ClipboardRecord = record.into();
                cache.push_with_limit(clipboard_record, max_records);
            }
        }
    }

    let (sender, receiver) = bounded::<ClipboardRecord>(500);
    {
        let mut s = state.sender.lock().unwrap();
        *s = Some(sender.clone());
    }

    crate::clipboard::writer::start_writer_thread(receiver.clone(), state.clone());

    let cache = state.cache.clone();
    let last_content_hash = state.last_content_hash.clone();
    let is_monitoring_clone = is_monitoring.clone();
    let config = state.config.clone();
    let images_dir = state.images_dir.clone();
    let sender_clone = sender.clone();
    let receiver_clone = receiver.clone();
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
                &cache,
                &last_content_hash,
                &config,
                &images_dir,
                &sender_clone,
                &receiver_clone,
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
                    &cache,
                    &last_content_hash,
                    &config,
                    &images_dir,
                    &sender_clone,
                    &receiver_clone,
                    &app_handle_clone,
                    &mut dedup,
                );

                thread::sleep(Duration::from_millis(100));
            }
        });
    }
}

fn process_clipboard_change(
    cache: &Arc<Mutex<ClipboardCache>>,
    last_content_hash: &Arc<Mutex<String>>,
    config: &Arc<Mutex<ClipboardConfig>>,
    images_dir: &Arc<Mutex<PathBuf>>,
    sender: &Sender<ClipboardRecord>,
    receiver: &Receiver<ClipboardRecord>,
    app_handle: &AppHandle,
    dedup: &mut EventDeduplicator,
) -> Option<ClipboardRecord> {
    let (max_image_size, max_records) = {
        let cfg = config.lock().unwrap();
        (
            (cfg.max_image_size_mb * 1024.0 * 1024.0) as usize,
            cfg.max_records,
        )
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
                let id = generate_id();
                let images_dir_path = images_dir.lock().unwrap().clone();
                let image_path = save_image_atomic(&images_dir_path, &id, &image_data).ok();

                let record = ClipboardRecord {
                    id,
                    record_type: "image".to_string(),
                    text_content: None,
                    image_path,
                    hash: hash.clone(),
                    timestamp: get_timestamp(),
                };

                let mut c = cache.lock().unwrap();
                c.push_with_limit(record.clone(), max_records);
                c.clear_buffer_hashes();

                let send_result = sender.try_send(record.clone());
                if send_result.is_err() {
                    let _ = receiver.try_recv();
                    let _ = sender.try_send(record.clone());
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
                let record = ClipboardRecord {
                    id: generate_id(),
                    record_type: "text".to_string(),
                    text_content: Some(text.clone()),
                    image_path: None,
                    hash: hash.clone(),
                    timestamp: get_timestamp(),
                };

                let mut c = cache.lock().unwrap();
                c.push_with_limit(record.clone(), max_records);
                c.clear_buffer_hashes();

                let send_result = sender.try_send(record.clone());
                if send_result.is_err() {
                    let _ = receiver.try_recv();
                    let _ = sender.try_send(record.clone());
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

fn simple_hash(data: &[u8]) -> String {
    use std::hash::{DefaultHasher, Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    data.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}
