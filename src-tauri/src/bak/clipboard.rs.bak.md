use crate::db::{ClipboardDatabase, ClipboardRecordDb};
use arboard::Clipboard;
use chrono::Local;
use crossbeam_channel::{bounded, Receiver, Sender};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "windows")]
use crate::clipboard_listener::listen_clipboard;

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Gdi::{BITMAPINFOHEADER, BI_RGB};
#[cfg(target_os = "windows")]
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable,
    OpenClipboard, SetClipboardData,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};


#[cfg(target_os = "windows")]
const CF_DIB: u32 = 8;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardRecord {
    pub id: String,
    #[serde(rename = "content_type")]
    pub record_type: String,
    pub text_content: Option<String>,
    pub image_path: Option<String>,
    pub hash: String,
    pub timestamp: u64,
}

impl From<ClipboardRecordDb> for ClipboardRecord {
    fn from(db_record: ClipboardRecordDb) -> Self {
        Self {
            id: db_record.id,
            record_type: db_record.content_type,
            text_content: db_record.text_content,
            image_path: db_record.image_path,
            hash: db_record.hash,
            timestamp: db_record.timestamp as u64,
        }
    }
}

impl From<&ClipboardRecord> for ClipboardRecordDb {
    fn from(record: &ClipboardRecord) -> Self {
        Self {
            id: record.id.clone(),
            content_type: record.record_type.clone(),
            text_content: record.text_content.clone(),
            image_path: record.image_path.clone(),
            hash: record.hash.clone(),
            timestamp: record.timestamp as i64,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardConfig {
    pub max_records: usize,
    pub max_image_size_mb: f64,
    pub encrypted: bool,
    pub storage_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClipboardConfigPatch {
    pub max_records: Option<usize>,
    pub max_image_size_mb: Option<f64>,
    pub encrypted: Option<bool>,
}

impl Default for ClipboardConfig {
    fn default() -> Self {
        Self {
            max_records: 1000,
            max_image_size_mb: 1.0,
            encrypted: false,
            storage_path: None,
        }
    }
}

pub(crate) struct ClipboardCache {
    list: VecDeque<ClipboardRecord>,
    hash_index: HashSet<String>,
    content_index: HashMap<String, String>,
    buffer_hashes: HashSet<String>,
}

impl ClipboardCache {
    fn new() -> Self {
        Self {
            list: VecDeque::new(),
            hash_index: HashSet::new(),
            content_index: HashMap::new(),
            buffer_hashes: HashSet::new(),
        }
    }

    fn contains(&self, hash: &str, content: &str) -> bool {
        self.content_index
            .get(hash)
            .map(|c| c == content)
            .unwrap_or(false)
    }

    #[allow(dead_code)]
    fn hash_exists(&self, hash: &str) -> bool {
        self.hash_index.contains(hash) || self.buffer_hashes.contains(hash)
    }

    fn push(&mut self, record: ClipboardRecord) {
        if self.contains(&record.hash, record.text_content.as_deref().unwrap_or("")) {
            return;
        }

        self.hash_index.insert(record.hash.clone());
        if let Some(ref content) = record.text_content {
            self.content_index.insert(record.hash.clone(), content.clone());
        }
        self.buffer_hashes.insert(record.hash.clone());
        self.list.push_front(record);

        while self.list.len() > 1000 {
            if let Some(old) = self.list.pop_back() {
                self.hash_index.remove(&old.hash);
                self.content_index.remove(&old.hash);
            }
        }
    }

    fn remove_by_id(&mut self, id: &str) -> Option<ClipboardRecord> {
        if let Some(pos) = self.list.iter().position(|r| r.id == id) {
            let record = self.list.remove(pos).unwrap();
            self.hash_index.remove(&record.hash);
            self.content_index.remove(&record.hash);
            Some(record)
        } else {
            None
        }
    }

    fn clear_buffer_hashes(&mut self) {
        self.buffer_hashes.clear();
    }

    fn get_all(&self) -> Vec<ClipboardRecord> {
        self.list.iter().cloned().collect()
    }
}

struct EventDeduplicator {
    last_event_hash: Option<String>,
    last_event_time: Option<Instant>,
}

impl EventDeduplicator {
    fn new() -> Self {
        Self {
            last_event_hash: None,
            last_event_time: None,
        }
    }

    fn should_process(&mut self, hash: &str) -> bool {
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

pub struct ClipboardState {
    pub cache: Arc<Mutex<ClipboardCache>>,
    pub last_content_hash: Arc<Mutex<String>>,
    pub is_monitoring: Arc<Mutex<bool>>,
    pub config: Arc<Mutex<ClipboardConfig>>,
    pub storage_path: Arc<Mutex<PathBuf>>,
    pub database: Arc<Mutex<Option<ClipboardDatabase>>>,
    pub sender: Arc<Mutex<Option<Sender<ClipboardRecord>>>>,
    pub images_dir: Arc<Mutex<PathBuf>>,
}

impl Default for ClipboardState {
    fn default() -> Self {
        Self {
            cache: Arc::new(Mutex::new(ClipboardCache::new())),
            last_content_hash: Arc::new(Mutex::new(String::new())),
            is_monitoring: Arc::new(Mutex::new(false)),
            config: Arc::new(Mutex::new(ClipboardConfig::default())),
            storage_path: Arc::new(Mutex::new(PathBuf::new())),
            database: Arc::new(Mutex::new(None)),
            sender: Arc::new(Mutex::new(None)),
            images_dir: Arc::new(Mutex::new(PathBuf::new())),
        }
    }
}

impl ClipboardState {
    pub fn from_config(
        app_config: &crate::config_manager::AppConfig,
        app_handle: &AppHandle,
    ) -> Self {
        let storage_path = if let Some(path) = &app_config.clipboard_storage_path {
            PathBuf::from(path)
        } else {
            get_default_storage_path(app_handle)
        };

        let db_path = storage_path.with_extension("db");
        let images_dir = storage_path.parent().unwrap_or(&storage_path).join("images");

        let database = ClipboardDatabase::new(&db_path).ok();

        fs::create_dir_all(&images_dir).ok();

        Self {
            cache: Arc::new(Mutex::new(ClipboardCache::new())),
            last_content_hash: Arc::new(Mutex::new(String::new())),
            is_monitoring: Arc::new(Mutex::new(false)),
            config: Arc::new(Mutex::new(ClipboardConfig {
                max_records: app_config.clipboard_max_records,
                max_image_size_mb: app_config.clipboard_max_image_size_mb,
                encrypted: app_config.clipboard_encrypted,
                storage_path: app_config.clipboard_storage_path.clone(),
            })),
            storage_path: Arc::new(Mutex::new(storage_path)),
            database: Arc::new(Mutex::new(database)),
            sender: Arc::new(Mutex::new(None)),
            images_dir: Arc::new(Mutex::new(images_dir)),
        }
    }

    #[allow(dead_code)]
    pub fn get_images_dir(&self) -> PathBuf {
        self.images_dir.lock().unwrap().clone()
    }

    pub fn rebuild_database(&self, new_path: &Path) -> Result<(), String> {
        let db_path = new_path.with_extension("db");
        let images_dir = new_path.parent().unwrap_or(new_path).join("images");

        if let Some(parent) = new_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

        let new_db = ClipboardDatabase::new(&db_path)
            .map_err(|e| e.to_string())?;

        let mut db_lock = self.database.lock().unwrap();
        *db_lock = Some(new_db);

        let mut images_lock = self.images_dir.lock().unwrap();
        *images_lock = images_dir;

        Ok(())
    }
}

fn get_clipboard_text() -> Option<String> {
    let mut clipboard = Clipboard::new().ok()?;
    clipboard.get_text().ok()
}

fn set_clipboard_text(text: &str) -> bool {
    let mut clipboard = match Clipboard::new() {
        Ok(c) => c,
        Err(_) => return false,
    };
    clipboard.set_text(text).is_ok()
}

#[allow(dead_code)]
fn is_base64_image(content: &str) -> bool {
    content.starts_with("data:image/")
}

#[allow(dead_code)]
fn decode_base64_image(content: &str) -> Option<Vec<u8>> {
    let base64_start = content.find(',')? + 1;
    let base64_data = &content[base64_start..];
    use base64::Engine;
    let engine = base64::engine::general_purpose::STANDARD;
    engine.decode(base64_data).ok()
}

fn set_clipboard_image_from_png(png_data: &[u8]) -> bool {
    #[cfg(target_os = "windows")]
    {
        set_clipboard_image_windows(png_data)
    }
    #[cfg(not(target_os = "windows"))]
    {
        use arboard::ImageData;

        let img = match image::load_from_memory(png_data) {
            Ok(i) => i,
            Err(_) => return false,
        };

        let rgba = img.to_rgba8();
        let (width, height) = rgba.dimensions();

        let mut clipboard = match Clipboard::new() {
            Ok(c) => c,
            Err(_) => return false,
        };

        let image_data = ImageData {
            width: width as usize,
            height: height as usize,
            bytes: rgba.as_raw().clone().into(),
        };

        clipboard.set_image(image_data).is_ok()
    }
}

#[cfg(target_os = "windows")]
fn set_clipboard_image_windows(png_data: &[u8]) -> bool {
    use std::mem::size_of;
    use windows::Win32::Foundation::HANDLE;

    let img = match image::load_from_memory(png_data) {
        Ok(i) => i,
        Err(_) => return false,
    };

    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();

    let row_size = (width * 4 + 3) & !3;
    let image_size = (row_size * height) as usize;
    let header_size = size_of::<BITMAPINFOHEADER>();
    let total_size = header_size + image_size;

    unsafe {
        let h_mem = match GlobalAlloc(GMEM_MOVEABLE, total_size) {
            Ok(h) => h,
            Err(_) => return false,
        };

        let ptr = GlobalLock(h_mem);
        if ptr.is_null() {
            return false;
        }

        let header = BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: height as i32,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            biSizeImage: image_size as u32,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        };

        std::ptr::copy_nonoverlapping(
            &header as *const BITMAPINFOHEADER as *const u8,
            ptr as *mut u8,
            header_size,
        );

        let pixels = (ptr as *mut u8).add(header_size);
        let rgba_bytes = rgba.as_raw();

        for y in 0..height as usize {
            let src_row_start = (height as usize - 1 - y) * (width as usize * 4);
            let dst_row_start = y * row_size as usize;

            for x in 0..width as usize {
                let src_idx = src_row_start + x * 4;
                let dst_idx = dst_row_start + x * 4;

                let r = rgba_bytes[src_idx];
                let g = rgba_bytes[src_idx + 1];
                let b = rgba_bytes[src_idx + 2];
                let a = rgba_bytes[src_idx + 3];

                *pixels.add(dst_idx) = b;
                *pixels.add(dst_idx + 1) = g;
                *pixels.add(dst_idx + 2) = r;
                *pixels.add(dst_idx + 3) = a;
            }
        }

        let _ = GlobalUnlock(h_mem);

        if OpenClipboard(HWND(0)).is_err() {
            return false;
        }

        let _ = EmptyClipboard();

        let handle = HANDLE(h_mem.0 as isize);
        let result = SetClipboardData(CF_DIB, handle);
        let _ = CloseClipboard();

        result.is_ok()
    }
}

#[cfg(target_os = "windows")]
fn get_clipboard_image_windows() -> Option<Vec<u8>> {
    use std::mem::size_of;

    unsafe {
        if IsClipboardFormatAvailable(CF_DIB).is_err() {
            return None;
        }

        if OpenClipboard(HWND(0)).is_err() {
            return None;
        }

        let handle = match GetClipboardData(CF_DIB) {
            Ok(h) => h,
            Err(_) => {
                let _ = CloseClipboard();
                return None;
            }
        };

        let ptr = handle.0 as *const u8;
        if ptr.is_null() {
            let _ = CloseClipboard();
            return None;
        }

        let header = &*(ptr as *const BITMAPINFOHEADER);
        let width = header.biWidth as u32;
        let height = if header.biHeight < 0 {
            (-header.biHeight) as u32
        } else {
            header.biHeight as u32
        };
        let bit_count = header.biBitCount as u32;

        if width == 0 || height == 0 || bit_count < 16 {
            let _ = CloseClipboard();
            return None;
        }

        let bytes_per_pixel = bit_count / 8;
        let row_size = ((width * bytes_per_pixel + 3) / 4) * 4;
        let image_size =
            if header.biSizeImage > 0 {
                header.biSizeImage as usize
            } else {
                (row_size * height) as usize
            };

        let header_size = if header.biCompression == BI_RGB.0 && bit_count == 32 {
            size_of::<BITMAPINFOHEADER>()
        } else {
            size_of::<BITMAPINFOHEADER>() + (header.biClrUsed as usize * size_of::<u32>())
        };

        let total_size = header_size + image_size;
        let data = std::slice::from_raw_parts(ptr, total_size).to_vec();

        let _ = CloseClipboard();

        let pixels = &data[header_size..];
        let mut rgba_data = Vec::with_capacity((width * height * 4) as usize);

        if bit_count == 32 {
            let row_len = (row_size / 4) as usize;
            for y in (0..height).rev() {
                let row_start = (y as usize) * row_len;
                for x in 0..width as usize {
                    let idx = row_start + x;
                    if idx * 4 + 3 < pixels.len() {
                        let b = pixels[idx * 4];
                        let g = pixels[idx * 4 + 1];
                        let r = pixels[idx * 4 + 2];
                        let a = pixels[idx * 4 + 3];
                        rgba_data.extend_from_slice(&[r, g, b, if a == 0 { 255 } else { a }]);
                    }
                }
            }
        } else if bit_count == 24 {
            let row_len = (row_size / 3) as usize;
            for y in (0..height).rev() {
                let row_start = (y as usize) * row_len;
                for x in 0..width as usize {
                    let idx = row_start + x;
                    if idx * 3 + 2 < pixels.len() {
                        let b = pixels[idx * 3];
                        let g = pixels[idx * 3 + 1];
                        let r = pixels[idx * 3 + 2];
                        rgba_data.extend_from_slice(&[r, g, b, 255]);
                    }
                }
            }
        } else {
            return None;
        }

        encode_rgba_to_png(&rgba_data, width, height)
    }
}

#[cfg(target_os = "windows")]
fn encode_rgba_to_png(rgba_data: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    use image::{ImageBuffer, Rgba};

    let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_raw(width, height, rgba_data.to_vec())?;

    let mut output = Vec::new();
    img.write_to(
        &mut std::io::Cursor::new(&mut output),
        image::ImageFormat::Png,
    )
    .ok()?;
    Some(output)
}

#[cfg(not(target_os = "windows"))]
fn get_clipboard_image_windows() -> Option<Vec<u8>> {
    None
}

fn get_clipboard_image() -> Option<Vec<u8>> {
    #[cfg(target_os = "windows")]
    {
        get_clipboard_image_windows()
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut clipboard = Clipboard::new().ok()?;
        let image = clipboard.get_image().ok()?;
        let rgba_data = image.bytes.to_vec();
        encode_rgba_to_png(&rgba_data, image.width as u32, image.height as u32)
    }
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
    use std::hash::{Hash, Hasher, DefaultHasher};
    let mut hasher = DefaultHasher::new();
    data.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

#[allow(dead_code)]
fn encode_image_to_base64(data: &[u8]) -> Option<String> {
    use base64::Engine;
    let engine = base64::engine::general_purpose::STANDARD;
    Some(format!("data:image/png;base64,{}", engine.encode(data)))
}

pub fn get_default_storage_path(app_handle: &AppHandle) -> PathBuf {
    if let Some(app_data_dir) = app_handle.path().app_data_dir().ok() {
        let _ = fs::create_dir_all(&app_data_dir);
        app_data_dir.join("clipboard_history")
    } else {
        std::env::temp_dir().join("air_icon_launcher_clipboard_history")
    }
}

#[allow(dead_code)]
fn get_default_storage_path_from_app(app: &tauri::AppHandle) -> PathBuf {
    if let Some(app_data_dir) = app.path().app_data_dir().ok() {
        let _ = fs::create_dir_all(&app_data_dir);
        app_data_dir.join("clipboard_history")
    } else {
        std::env::temp_dir().join("air_icon_launcher_clipboard_history")
    }
}

fn save_image_atomic(images_dir: &Path, id: &str, png_data: &[u8]) -> Result<String, String> {
    let date = Local::now().format("%Y-%m");
    let dir = images_dir.join(date.to_string());
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let target_path = dir.join(format!("{}.png", id));
    let temp_path = target_path.with_extension("tmp");

    fs::write(&temp_path, png_data).map_err(|e| e.to_string())?;
    fs::rename(&temp_path, &target_path).map_err(|e| e.to_string())?;

    Ok(target_path.to_string_lossy().to_string())
}

fn delete_image(image_path: &str) {
    let _ = fs::remove_file(image_path);
}

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

fn start_writer_thread(receiver: Receiver<ClipboardRecord>, state: Arc<ClipboardState>) {
    thread::spawn(move || {
        let mut buffer: Vec<ClipboardRecordDb> = Vec::new();
        let mut last_flush = Instant::now();
        let flush_interval = Duration::from_secs(1);
        let batch_size = 50;

        loop {
            match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(record) => {
                    buffer.push(ClipboardRecordDb::from(&record));

                    if buffer.len() >= batch_size || last_flush.elapsed() >= flush_interval {
                        if !buffer.is_empty() {
                            let records_to_flush = std::mem::take(&mut buffer);
                            if let Some(db) = state.database.lock().unwrap().as_ref() {
                                if db.insert_batch(&records_to_flush).is_err() {
                                    buffer.extend(records_to_flush);
                                }
                            }
                        }
                        last_flush = Instant::now();
                    }
                }
                Err(_) => {
                    if last_flush.elapsed() >= flush_interval && !buffer.is_empty() {
                        let records_to_flush = std::mem::take(&mut buffer);
                        if let Some(db) = state.database.lock().unwrap().as_ref() {
                            if db.insert_batch(&records_to_flush).is_err() {
                                buffer.extend(records_to_flush);
                            }
                        }
                        last_flush = Instant::now();
                    }
                }
            }

            if !buffer.is_empty() && last_flush.elapsed() >= flush_interval {
                let records_to_flush = std::mem::take(&mut buffer);
                if let Some(db) = state.database.lock().unwrap().as_ref() {
                    if db.insert_batch(&records_to_flush).is_err() {
                        buffer.extend(records_to_flush);
                    }
                }
                last_flush = Instant::now();
            }
        }
    });
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
                c.push(record.clone());
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
                c.push(record.clone());
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

pub fn start_clipboard_monitor(app_handle: AppHandle, state: Arc<ClipboardState>) {
    let is_monitoring = state.is_monitoring.clone();
    {
        let mut monitoring = is_monitoring.lock().unwrap();
        if *monitoring {
            return;
        }
        *monitoring = true;
    }

    if let Some(db) = state.database.lock().unwrap().as_ref() {
        if let Ok(records) = db.get_all() {
            let mut cache = state.cache.lock().unwrap();
            for record in records {
                let clipboard_record: ClipboardRecord = record.into();
                cache.push(clipboard_record);
            }
        }
    }

    let (sender, receiver) = bounded::<ClipboardRecord>(500);
    {
        let mut s = state.sender.lock().unwrap();
        *s = Some(sender.clone());
    }

    start_writer_thread(receiver.clone(), state.clone());

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

#[tauri::command]
pub fn get_clipboard_content() -> Result<String, String> {
    get_clipboard_text().ok_or_else(|| "Failed to get clipboard content".to_string())
}

#[tauri::command]
pub fn get_current_clipboard_hash(
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<String, String> {
    let last_hash = state.last_content_hash.lock().unwrap();
    Ok(last_hash.clone())
}

#[tauri::command]
pub fn set_clipboard_content(
    content: String,
    is_image: bool,
    state: tauri::State<'_, Arc<ClipboardState>>,
    app_handle: AppHandle,
) -> Result<(), String> {
    if is_image {
        if let Ok(png_data) = std::fs::read(&content) {
            if set_clipboard_image_from_png(&png_data) {
                let hash = simple_hash(&png_data);
                let mut last_hash = state.last_content_hash.lock().unwrap();
                *last_hash = hash;
                let _ = app_handle.emit("clipboard-set-from-history", ());
                return Ok(());
            }
        }
        Err("Failed to set image to clipboard".to_string())
    } else {
        let hash = simple_hash(content.as_bytes());
        if set_clipboard_text(&content) {
            let mut last_hash = state.last_content_hash.lock().unwrap();
            *last_hash = hash;
            let _ = app_handle.emit("clipboard-set-from-history", ());
            Ok(())
        } else {
            Err("Failed to set clipboard content".to_string())
        }
    }
}

#[tauri::command]
pub fn get_clipboard_history(
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<Vec<ClipboardRecord>, String> {
    let cache = state.cache.lock().unwrap();
    Ok(cache.get_all())
}

#[tauri::command]
pub fn clear_clipboard_history(
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<(), String> {
    {
        let mut cache = state.cache.lock().unwrap();
        cache.list.clear();
        cache.hash_index.clear();
        cache.content_index.clear();
        cache.buffer_hashes.clear();
    }

    if let Some(db) = state.database.lock().unwrap().as_ref() {
        let images = db.clear().map_err(|e| e.to_string())?;
        for image_path in images {
            delete_image(&image_path);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn delete_clipboard_record(
    id: String,
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<(), String> {
    let removed = {
        let mut cache = state.cache.lock().unwrap();
        cache.remove_by_id(&id)
    };

    if let Some(record) = removed {
        if let Some(db) = state.database.lock().unwrap().as_ref() {
            if let Ok(Some(image_path)) = db.delete(&id) {
                if !image_path.is_empty() {
                    delete_image(&image_path);
                }
            }
        }

        if let Some(ref image_path) = record.image_path {
            if !image_path.is_empty() {
                delete_image(image_path);
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn get_clipboard_config(
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<ClipboardConfig, String> {
    let config = state.config.lock().unwrap();
    Ok(config.clone())
}

#[derive(Debug, Clone, Serialize)]
pub struct ClipboardConfigDebug {
    pub config_path: String,
    pub runtime: ClipboardConfig,
    pub disk_max_records: usize,
    pub disk_max_image_size_mb: f64,
    pub disk_encrypted: bool,
    pub disk_storage_path: Option<String>,
}

#[tauri::command]
pub fn get_clipboard_config_debug(
    config_manager: tauri::State<'_, crate::config_manager::ConfigManager>,
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<ClipboardConfigDebug, String> {
    let runtime = state.config.lock().unwrap().clone();
    let disk = config_manager.load_config();
    Ok(ClipboardConfigDebug {
        config_path: config_manager.config_path().to_string_lossy().to_string(),
        runtime,
        disk_max_records: disk.clipboard_max_records,
        disk_max_image_size_mb: disk.clipboard_max_image_size_mb,
        disk_encrypted: disk.clipboard_encrypted,
        disk_storage_path: disk.clipboard_storage_path,
    })
}

#[tauri::command]
pub fn set_clipboard_config(
    patch: ClipboardConfigPatch,
    config_manager: tauri::State<'_, crate::config_manager::ConfigManager>,
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<ClipboardConfig, String> {
    {
        let mut config = state.config.lock().unwrap();

        if let Some(v) = patch.max_records {
            config.max_records = v;
        }
        if let Some(v) = patch.max_image_size_mb {
            config.max_image_size_mb = v;
        }
        if let Some(v) = patch.encrypted {
            config.encrypted = v;
        }
    }

    let mut app_config = config_manager.load_config();

    if let Some(v) = patch.max_records {
        app_config.clipboard_max_records = v;
    }
    if let Some(v) = patch.max_image_size_mb {
        app_config.clipboard_max_image_size_mb = v;
    }
    if let Some(v) = patch.encrypted {
        app_config.clipboard_encrypted = v;
    }

    config_manager.save_config(&app_config)?;

    let verify = config_manager.load_config();
    if let Some(v) = patch.max_records {
        if verify.clipboard_max_records != v {
            return Err(format!(
                "配置写入校验失败：clipboard_max_records 期望={} 实际={} 路径={}",
                v,
                verify.clipboard_max_records,
                config_manager.config_path().to_string_lossy()
            ));
        }
    }
    if let Some(v) = patch.max_image_size_mb {
        if (verify.clipboard_max_image_size_mb - v).abs() > 1e-9 {
            return Err(format!(
                "配置写入校验失败：clipboard_max_image_size_mb 期望={} 实际={} 路径={}",
                v,
                verify.clipboard_max_image_size_mb,
                config_manager.config_path().to_string_lossy()
            ));
        }
    }
    if let Some(v) = patch.encrypted {
        if verify.clipboard_encrypted != v {
            return Err(format!(
                "配置写入校验失败：clipboard_encrypted 期望={} 实际={} 路径={}",
                v,
                verify.clipboard_encrypted,
                config_manager.config_path().to_string_lossy()
            ));
        }
    }

    let latest = state.config.lock().unwrap().clone();
    Ok(latest)
}

#[tauri::command]
pub fn set_clipboard_storage_path(
    config_manager: tauri::State<'_, crate::config_manager::ConfigManager>,
    path: String,
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<(), String> {
    let new_path = PathBuf::from(&path);

    let old_path = state.storage_path.lock().unwrap().clone();

    {
        let mut storage_path = state.storage_path.lock().unwrap();
        *storage_path = new_path.clone();
    }

    if let Err(e) = state.rebuild_database(&new_path) {
        {
            let mut sp = state.storage_path.lock().unwrap();
            *sp = old_path.clone();
        }
        return Err(e);
    }

    {
        let mut config = state.config.lock().unwrap();
        config.storage_path = Some(path.clone());
    }

    let mut app_config = config_manager.load_config();
    app_config.clipboard_storage_path = Some(path);
    config_manager.save_config(&app_config)?;

    let verify = config_manager.load_config();
    if verify.clipboard_storage_path != app_config.clipboard_storage_path {
        return Err(format!(
            "配置写入校验失败：clipboard_storage_path 期望={:?} 实际={:?} 路径={}",
            app_config.clipboard_storage_path,
            verify.clipboard_storage_path,
            config_manager.config_path().to_string_lossy()
        ));
    }

    Ok(())
}

#[tauri::command]
pub fn get_clipboard_storage_path(
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<String, String> {
    let path = state.storage_path.lock().unwrap().clone();
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn reset_clipboard_storage_path(
    app: AppHandle,
    config_manager: tauri::State<'_, crate::config_manager::ConfigManager>,
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<String, String> {
    let default_path = get_default_storage_path(&app);

    let old_path = state.storage_path.lock().unwrap().clone();

    {
        let mut storage_path = state.storage_path.lock().unwrap();
        *storage_path = default_path.clone();
    }

    if let Err(e) = state.rebuild_database(&default_path) {
        {
            let mut sp = state.storage_path.lock().unwrap();
            *sp = old_path.clone();
        }
        return Err(e);
    }

    {
        let mut config = state.config.lock().unwrap();
        config.storage_path = None;
    }

    let mut app_config = config_manager.load_config();
    app_config.clipboard_storage_path = None;
    config_manager.save_config(&app_config)?;

    Ok(default_path.to_string_lossy().to_string())
}

#[allow(dead_code)]
fn write_atomically(path: &Path, data: &[u8]) -> Result<(), String> {
    let temp_path = path.with_extension("tmp");
    fs::write(&temp_path, data).map_err(|e| e.to_string())?;
    fs::rename(&temp_path, path).map_err(|e| e.to_string())
}
