use arboard::Clipboard;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Gdi::{BITMAPINFOHEADER, BI_RGB};
#[cfg(target_os = "windows")]
use windows::Win32::System::DataExchange::{
    OpenClipboard, CloseClipboard, GetClipboardData, SetClipboardData,
    IsClipboardFormatAvailable, EmptyClipboard,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
#[cfg(target_os = "windows")]
const CF_DIB: u32 = 8;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardRecord {
    pub id: String,
    pub content: String,
    #[serde(rename = "type")]
    pub record_type: String,
    pub timestamp: u64,
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
            max_records: 100,
            max_image_size_mb: 1.0,
            encrypted: false,
            storage_path: None,
        }
    }
}

pub struct ClipboardState {
    pub history: Arc<Mutex<Vec<ClipboardRecord>>>,
    pub last_content_hash: Arc<Mutex<String>>,
    pub is_monitoring: Arc<Mutex<bool>>,
    pub config: Arc<Mutex<ClipboardConfig>>,
    pub storage_path: Arc<Mutex<PathBuf>>,
}

impl Default for ClipboardState {
    fn default() -> Self {
        Self {
            history: Arc::new(Mutex::new(Vec::new())),
            last_content_hash: Arc::new(Mutex::new(String::new())),
            is_monitoring: Arc::new(Mutex::new(false)),
            config: Arc::new(Mutex::new(ClipboardConfig::default())),
            storage_path: Arc::new(Mutex::new(PathBuf::new())),
        }
    }
}

impl ClipboardState {
    pub fn from_config(app_config: &crate::config_manager::AppConfig, app_handle: &AppHandle) -> Self {
        let storage_path = if let Some(path) = &app_config.clipboard_storage_path {
            PathBuf::from(path)
        } else {
            get_default_storage_path(app_handle)
        };
        
        Self {
            history: Arc::new(Mutex::new(Vec::new())),
            last_content_hash: Arc::new(Mutex::new(String::new())),
            is_monitoring: Arc::new(Mutex::new(false)),
            config: Arc::new(Mutex::new(ClipboardConfig {
                max_records: app_config.clipboard_max_records,
                max_image_size_mb: app_config.clipboard_max_image_size_mb,
                encrypted: app_config.clipboard_encrypted,
                storage_path: app_config.clipboard_storage_path.clone(),
            })),
            storage_path: Arc::new(Mutex::new(storage_path)),
        }
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

fn is_base64_image(content: &str) -> bool {
    content.starts_with("data:image/")
}

fn decode_base64_image(content: &str) -> Option<Vec<u8>> {
    let base64_start = content.find(",")? + 1;
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
        let image_size = if header.biSizeImage > 0 {
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
    
    let img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_raw(width, height, rgba_data.to_vec())?;
    
    let mut output = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut output), image::ImageFormat::Png).ok()?;
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
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let state = RandomState::new();
    let mut hasher = state.build_hasher();
    hasher.write(data);
    format!("{:x}", hasher.finish())
}

fn encode_image_to_base64(data: &[u8]) -> Option<String> {
    use base64::Engine;
    let engine = base64::engine::general_purpose::STANDARD;
    Some(format!("data:image/png;base64,{}", engine.encode(data)))
}

pub fn get_default_storage_path(app_handle: &AppHandle) -> PathBuf {
    if let Some(app_data_dir) = app_handle.path().app_data_dir().ok() {
        let _ = fs::create_dir_all(&app_data_dir);
        app_data_dir.join("clipboard_history.json")
    } else {
        std::env::temp_dir().join("air_icon_launcher_clipboard_history.json")
    }
}

fn get_default_storage_path_from_app(app: &tauri::AppHandle) -> PathBuf {
    if let Some(app_data_dir) = app.path().app_data_dir().ok() {
        let _ = fs::create_dir_all(&app_data_dir);
        app_data_dir.join("clipboard_history.json")
    } else {
        std::env::temp_dir().join("air_icon_launcher_clipboard_history.json")
    }
}

fn save_history_to_file(
    history: &[ClipboardRecord],
    path: &PathBuf,
    encrypted: bool,
) -> Result<(), String> {
    let json = serde_json::to_string(history).map_err(|e| e.to_string())?;
    
    let data = if encrypted {
        simple_encrypt(&json)
    } else {
        json.as_bytes().to_vec()
    };
    
    fs::write(path, data).map_err(|e| e.to_string())
}

fn load_history_from_file(
    path: &PathBuf,
    encrypted: bool,
) -> Result<Vec<ClipboardRecord>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut data = Vec::new();
    file.read_to_end(&mut data).map_err(|e| e.to_string())?;
    
    let json = if encrypted {
        simple_decrypt(&data)?
    } else {
        String::from_utf8(data).map_err(|e| e.to_string())?
    };
    
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

fn simple_encrypt(data: &str) -> Vec<u8> {
    let key = b"air_icon_launcher_clipboard_key";
    let bytes = data.as_bytes();
    bytes
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ key[i % key.len()])
        .collect()
}

fn simple_decrypt(data: &[u8]) -> Result<String, String> {
    let key = b"air_icon_launcher_clipboard_key";
    let decrypted: Vec<u8> = data
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ key[i % key.len()])
        .collect();
    String::from_utf8(decrypted).map_err(|e| e.to_string())
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

    let history = state.history.clone();
    let last_content_hash = state.last_content_hash.clone();
    let is_monitoring_clone = is_monitoring.clone();
    let config = state.config.clone();
    let storage_path = state.storage_path.clone();

    let (path, encrypted) = {
        let p = storage_path.lock().unwrap().clone();
        let e = config.lock().unwrap().encrypted;
        (p, e)
    };

    if let Ok(loaded) = load_history_from_file(&path, encrypted) {
        let mut hist = history.lock().unwrap();
        *hist = loaded;
    }

    thread::spawn(move || {
        loop {
            {
                let monitoring = is_monitoring_clone.lock().unwrap();
                if !*monitoring {
                    break;
                }
            }

            let max_image_size = {
                let cfg = config.lock().unwrap();
                (cfg.max_image_size_mb * 1024.0 * 1024.0) as usize
            };

            if let Some(image_data) = get_clipboard_image() {
                if image_data.len() <= max_image_size {
                    let hash = simple_hash(&image_data);
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
                        let is_large_image = image_data.len() > 1024 * 1024; // > 1MB
                        
                        if is_large_image {
                            let image_data_clone = image_data.clone();
                            let history_clone = history.clone();
                            let config_clone = config.clone();
                            let storage_path_clone = storage_path.clone();
                            let app_handle_clone = app_handle.clone();
                            
                            thread::spawn(move || {
                                if let Some(base64) = encode_image_to_base64(&image_data_clone) {
                                    let record = ClipboardRecord {
                                        id: generate_id(),
                                        content: base64,
                                        record_type: "image".to_string(),
                                        timestamp: get_timestamp(),
                                    };

                                    let max_records = {
                                        let cfg = config_clone.lock().unwrap();
                                        cfg.max_records
                                    };

                                    let path = storage_path_clone.lock().unwrap().clone();
                                    let encrypted = {
                                        let cfg = config_clone.lock().unwrap();
                                        cfg.encrypted
                                    };

                                    {
                                        let mut hist = history_clone.lock().unwrap();
                                        let exists = hist.iter().any(|r| r.content == record.content);
                                        if !exists {
                                            hist.insert(0, record.clone());
                                            if max_records > 0 && hist.len() > max_records {
                                                hist.truncate(max_records);
                                            }
                                        }
                                    }

                                    let hist = history_clone.lock().unwrap().clone();
                                    let _ = save_history_to_file(&hist, &path, encrypted);
                                    let _ = app_handle_clone.emit("clipboard-changed", &record);
                                }
                            });
                        } else {
                            if let Some(base64) = encode_image_to_base64(&image_data) {
                                let record = ClipboardRecord {
                                    id: generate_id(),
                                    content: base64,
                                    record_type: "image".to_string(),
                                    timestamp: get_timestamp(),
                                };

                                let max_records = {
                                    let cfg = config.lock().unwrap();
                                    cfg.max_records
                                };

                                let path = storage_path.lock().unwrap().clone();
                                let encrypted = {
                                    let cfg = config.lock().unwrap();
                                    cfg.encrypted
                                };

                                {
                                    let mut hist = history.lock().unwrap();
                                    let exists = hist.iter().any(|r| r.content == record.content);
                                    if !exists {
                                        hist.insert(0, record.clone());
                                        if max_records > 0 && hist.len() > max_records {
                                            hist.truncate(max_records);
                                        }
                                    }
                                }

                                let hist = history.lock().unwrap().clone();
                                let _ = save_history_to_file(&hist, &path, encrypted);
                                let _ = app_handle.emit("clipboard-changed", &record);
                            }
                        }
                    }
                }
            } else if let Some(text) = get_clipboard_text() {
                if !text.is_empty() {
                    let hash = simple_hash(text.as_bytes());
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
                            content: text.clone(),
                            record_type: "text".to_string(),
                            timestamp: get_timestamp(),
                        };

                        let max_records = {
                            let cfg = config.lock().unwrap();
                            cfg.max_records
                        };

                        let path = storage_path.lock().unwrap().clone();
                        let encrypted = {
                            let cfg = config.lock().unwrap();
                            cfg.encrypted
                        };

                        {
                            let mut hist = history.lock().unwrap();
                            let exists = hist.iter().any(|r| r.content == text);
                            if !exists {
                                hist.insert(0, record.clone());
                                if max_records > 0 && hist.len() > max_records {
                                    hist.truncate(max_records);
                                }
                            }
                        }

                        let hist = history.lock().unwrap().clone();
                        let _ = save_history_to_file(&hist, &path, encrypted);
                        let _ = app_handle.emit("clipboard-changed", &record);
                    }
                }
            }

            thread::sleep(Duration::from_millis(1000));
        }
    });
}

#[tauri::command]
pub fn get_clipboard_content() -> Result<String, String> {
    get_clipboard_text().ok_or_else(|| "Failed to get clipboard content".to_string())
}

#[tauri::command]
pub fn set_clipboard_content(
    content: String,
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<(), String> {
    if is_base64_image(&content) {
        if let Some(png_data) = decode_base64_image(&content) {
            if set_clipboard_image_from_png(&png_data) {
                let hash = simple_hash(&png_data);
                let mut last_hash = state.last_content_hash.lock().unwrap();
                *last_hash = hash;
                return Ok(());
            }
        }
        Err("Failed to set image to clipboard".to_string())
    } else {
        let hash = simple_hash(content.as_bytes());
        if set_clipboard_text(&content) {
            let mut last_hash = state.last_content_hash.lock().unwrap();
            *last_hash = hash;
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
    let history = state.history.lock().unwrap();
    Ok(history.clone())
}

#[tauri::command]
pub fn clear_clipboard_history(
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<(), String> {
    let mut history = state.history.lock().unwrap();
    history.clear();
    
    let path = state.storage_path.lock().unwrap().clone();
    let encrypted = state.config.lock().unwrap().encrypted;
    let _ = save_history_to_file(&history, &path, encrypted);
    
    Ok(())
}

#[tauri::command]
pub fn delete_clipboard_record(
    id: String,
    state: tauri::State<'_, Arc<ClipboardState>>,
) -> Result<(), String> {
    {
        let mut history = state.history.lock().unwrap();
        if let Some(pos) = history.iter().position(|r| r.id == id) {
            history.remove(pos);
        }
    }
    
    let path = state.storage_path.lock().unwrap().clone();
    let encrypted = state.config.lock().unwrap().encrypted;
    let history = state.history.lock().unwrap().clone();
    let _ = save_history_to_file(&history, &path, encrypted);
    
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

/// 获取剪贴板配置的运行态与落盘态信息（用于诊断）。
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
    
    if let Some(parent) = new_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    
    let old_path = state.storage_path.lock().unwrap().clone();
    let config = state.config.lock().unwrap();
    let encrypted = config.encrypted;
    drop(config);
    
    if old_path.exists() && old_path != new_path {
        if let Ok(data) = fs::read(&old_path) {
            fs::write(&new_path, data).map_err(|e| e.to_string())?;
        }
    }
    
    {
        let mut storage_path = state.storage_path.lock().unwrap();
        *storage_path = new_path.clone();
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
    if old_path.exists() && old_path != default_path {
        if let Ok(data) = fs::read(&old_path) {
            fs::write(&default_path, data).map_err(|e| e.to_string())?;
        }
        let _ = fs::remove_file(&old_path);
    }
    
    {
        let mut storage_path = state.storage_path.lock().unwrap();
        *storage_path = default_path.clone();
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
