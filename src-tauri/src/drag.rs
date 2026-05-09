use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, State, WindowEvent};

const DEFAULT_ICON_MAX_EDGE: u32 = 128;
const MIN_ICON_MAX_EDGE: u32 = 32;
const MAX_ICON_MAX_EDGE: u32 = 256;

#[derive(Default)]
pub struct DragDropState {
    last_drop: Mutex<Option<DropRecord>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DropPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DropTargetInfo {
    pub tag_name: String,
    pub id: Option<String>,
    pub class_list: Vec<String>,
    pub dataset: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DropRecord {
    pub drop_id: String,
    pub paths: Vec<String>,
    pub directories: Vec<String>,
    pub icon_base64s: Vec<Option<String>>,
    pub position: DropPosition,
    pub target: Option<DropTargetInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DropIconsEvent {
    pub drop_id: String,
    pub icon_base64s: Vec<Option<String>>,
}

fn normalize_icon_max_edge(max_edge: Option<u32>) -> u32 {
    max_edge
        .unwrap_or(DEFAULT_ICON_MAX_EDGE)
        .clamp(MIN_ICON_MAX_EDGE, MAX_ICON_MAX_EDGE)
}

/// 为主窗口注册“拖拽文件/图标进入并释放”的监听，并把结果发送到前端事件中。
pub fn setup_drag_drop(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let app_handle = app.clone();
    let window_for_cb = window.clone();

    window.on_window_event(move |event| {
        let WindowEvent::DragDrop(drag_event) = event else {
            return;
        };

        let DragDropEvent::Drop { paths, position } = drag_event else {
            return;
        };

        let paths = dedupe_windows_shortcut_target_paths(paths.clone());
        let drop_id = new_drop_id();
        let (paths, directories) = extract_paths_and_directories(paths);
        let position = physical_to_logical_position(&window_for_cb, *position);

        let record = DropRecord {
            drop_id: drop_id.clone(),
            paths: paths.clone(),
            directories: directories.clone(),
            icon_base64s: vec![None; paths.len()],
            position,
            target: None,
        };

        if let Ok(mut guard) = app_handle.state::<DragDropState>().last_drop.lock() {
            *guard = Some(record.clone());
        }

        let _ = window_for_cb.emit("drag-drop", record);

        let app_handle_bg = app_handle.clone();
        let window_bg = window_for_cb.clone();
        let drop_id_bg = drop_id.clone();
        let paths_bg = paths.clone();
        std::thread::spawn(move || {
            let path_bufs: Vec<PathBuf> = paths_bg.iter().map(PathBuf::from).collect();
            let icon_base64s = extract_icon_base64s(&path_bufs, None);

            if let Ok(mut guard) = app_handle_bg.state::<DragDropState>().last_drop.lock() {
                if let Some(last) = guard.as_mut() {
                    if last.drop_id == drop_id_bg {
                        last.icon_base64s = icon_base64s.clone();
                    }
                }
            }

            let _ = window_bg.emit(
                "drag-drop-icons",
                DropIconsEvent {
                    drop_id: drop_id_bg,
                    icon_base64s,
                },
            );
        });
    });
}

/// 在 Windows 上拖入快捷方式时，系统可能同时给出 `.lnk` 与其目标路径；这里会去掉目标路径，避免前端创建重复启动项。
fn dedupe_windows_shortcut_target_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let mut keys = std::collections::HashSet::<String>::new();
        for p in &paths {
            keys.insert(p.to_string_lossy().to_ascii_lowercase());
        }

        let mut remove_keys = std::collections::HashSet::<String>::new();
        for p in &paths {
            let ext = p
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_ascii_lowercase());
            if ext.as_deref() != Some("lnk") {
                continue;
            }
            if let Some(target) = resolve_windows_shortcut_target_pathbuf(p) {
                let target_key = target.to_string_lossy().to_ascii_lowercase();
                if keys.contains(&target_key) {
                    remove_keys.insert(target_key);
                }
            }
        }

        if remove_keys.is_empty() {
            return paths;
        }

        return paths
            .into_iter()
            .filter(|p| !remove_keys.contains(&p.to_string_lossy().to_ascii_lowercase()))
            .collect();
    }
    #[cfg(not(windows))]
    {
        paths
    }
}

/// 前端在 drop 结束后计算落点元素，并将元素信息回传给 Rust 侧保存。
#[tauri::command]
pub fn report_drop_target(
    state: State<'_, DragDropState>,
    drop_id: String,
    target: Option<DropTargetInfo>,
) -> Result<(), String> {
    let mut guard = state
        .last_drop
        .lock()
        .map_err(|_| "DragDropState 被其他线程破坏，无法获取锁".to_string())?;

    let Some(last) = guard.as_mut() else {
        return Err("当前没有可更新的拖拽记录".to_string());
    };

    if last.drop_id != drop_id {
        return Err("drop_id 不匹配，可能是过期事件".to_string());
    }

    last.target = target;
    Ok(())
}

/// 获取最近一次拖拽释放事件的完整信息（包含路径、目录、坐标以及前端回传的元素信息）。
#[tauri::command]
pub fn get_last_drop(state: State<'_, DragDropState>) -> Option<DropRecord> {
    state.last_drop.lock().ok().and_then(|g| g.clone())
}

/// 从给定的路径列表中提取图标 base64 数据（用于手动添加项目）。
#[tauri::command]
pub fn extract_icons_from_paths(paths: Vec<String>, max_edge: Option<u32>) -> Vec<Option<String>> {
    let path_bufs: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    extract_icon_base64s(&path_bufs, max_edge)
}

/// 将操作系统回调提供的物理坐标转换为前端可用于 elementFromPoint 的逻辑坐标。
fn physical_to_logical_position(
    window: &tauri::WebviewWindow,
    position: tauri::PhysicalPosition<f64>,
) -> DropPosition {
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let logical: tauri::LogicalPosition<f64> = position.to_logical(scale_factor);
    DropPosition {
        x: logical.x,
        y: logical.y,
    }
}

/// 把拖入的路径列表转换为字符串，同时计算每个条目的“目录”路径。
fn extract_paths_and_directories(paths: Vec<PathBuf>) -> (Vec<String>, Vec<String>) {
    let mut path_strings = Vec::with_capacity(paths.len());
    let mut dir_strings = Vec::with_capacity(paths.len());

    for p in paths {
        let path_string = p.to_string_lossy().to_string();
        let dir = if p.is_dir() {
            p.clone()
        } else {
            p.parent().map(|x| x.to_path_buf()).unwrap_or(p.clone())
        };

        path_strings.push(path_string);
        dir_strings.push(dir.to_string_lossy().to_string());
    }

    (path_strings, dir_strings)
}

/// 从拖入的路径中提取可作为图标缓存的 base64 数据。
fn extract_icon_base64s(paths: &[PathBuf], max_edge: Option<u32>) -> Vec<Option<String>> {
    use rayon::prelude::*;
    let max_edge = normalize_icon_max_edge(max_edge);

    paths
        .par_iter()
        .map(|path| {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_ascii_lowercase());

            let is_image = matches!(
                ext.as_deref(),
                Some("png") | Some("jpg") | Some("jpeg") | Some("ico") | Some("svg")
            );

            if !is_image {
                #[cfg(windows)]
                {
                    if ext.as_deref() == Some("lnk") {
                        if let Some(target) = resolve_windows_shortcut_target_pathbuf(path) {
                            extract_windows_icon_base64(&target)
                        } else {
                            extract_windows_icon_base64(path)
                        }
                    } else {
                        extract_windows_icon_base64(path)
                    }
                }
                #[cfg(not(windows))]
                {
                    None
                }
            } else if ext.as_deref() == Some("svg") {
                std::fs::read(path)
                    .ok()
                    .map(|bytes| format!("data:image/svg+xml;base64,{}", STANDARD.encode(bytes)))
            } else if let Ok(bytes) = std::fs::read(path) {
                encode_raster_icon_bytes(&bytes, max_edge)
            } else {
                None
            }
        })
        .collect()
}

fn encode_raster_icon_bytes(bytes: &[u8], max_edge: u32) -> Option<String> {
    use image::{codecs::png::PngEncoder, imageops::FilterType, ColorType, GenericImageView, ImageEncoder};

    let image = image::load_from_memory(bytes).ok()?;
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return None;
    }

    let max_dimension = width.max(height);
    let resized = if max_dimension > max_edge {
        image.resize(max_edge, max_edge, FilterType::Lanczos3)
    } else {
        image
    };

    let rgba = resized.to_rgba8();
    let (next_width, next_height) = rgba.dimensions();
    let mut png_bytes = Vec::new();
    PngEncoder::new(&mut png_bytes)
        .write_image(rgba.as_raw(), next_width, next_height, ColorType::Rgba8.into())
        .ok()?;
    Some(STANDARD.encode(png_bytes))
}

/// 在 Windows 上解析 .lnk 快捷方式指向的真实路径，用于获取不带叠加层的目标图标。
#[cfg(windows)]
pub(crate) fn resolve_windows_shortcut_target_pathbuf(path: &PathBuf) -> Option<PathBuf> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::Storage::FileSystem::WIN32_FIND_DATAW;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, STGM_READ,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink, SLGP_RAWPATH};

    struct ComInitGuard;
    impl Drop for ComInitGuard {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }

    if unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_err() {
        return None;
    }
    let _guard = ComInitGuard;

    let shell_link: IShellLinkW =
        unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) }.ok()?;
    let persist: IPersistFile = shell_link.cast().ok()?;

    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    wide.push(0);
    unsafe { persist.Load(PCWSTR(wide.as_ptr()), STGM_READ) }.ok()?;

    let mut buf = vec![0u16; 260];
    let mut fd = WIN32_FIND_DATAW::default();
    unsafe {
        shell_link
            .GetPath(&mut buf, &mut fd as *mut _, SLGP_RAWPATH.0 as u32)
            .ok()?;
    }

    let end = buf.iter().position(|&x| x == 0).unwrap_or(buf.len());
    let s = String::from_utf16_lossy(&buf[..end]).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(PathBuf::from(s))
    }
}

/// 在 Windows 上从文件/文件夹提取 shell 图标并转换为 PNG base64。
#[cfg(windows)]
fn extract_windows_icon_base64(path: &PathBuf) -> Option<String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL};
    use windows::Win32::UI::Shell::{
        SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_USEFILEATTRIBUTES,
    };
    use windows::Win32::UI::WindowsAndMessaging::DestroyIcon;

    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    wide.push(0);

    let mut info = SHFILEINFOW::default();
    let attrs = if path.is_dir() {
        FILE_ATTRIBUTE_DIRECTORY
    } else {
        FILE_ATTRIBUTE_NORMAL
    };
    let flags = if path.exists() {
        SHGFI_ICON | SHGFI_LARGEICON
    } else {
        SHGFI_ICON | SHGFI_LARGEICON | SHGFI_USEFILEATTRIBUTES
    };

    let ok = unsafe {
        SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            attrs,
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            flags,
        )
    };
    if ok == 0 {
        return None;
    }

    let icon = info.hIcon;
    let base64 = hicon_to_png_base64(icon);
    let _ = unsafe { DestroyIcon(icon) };
    base64
}

/// 将 HICON 转换为 PNG base64 字符串。
#[cfg(windows)]
fn hicon_to_png_base64(icon: windows::Win32::UI::WindowsAndMessaging::HICON) -> Option<String> {
    use image::{codecs::png::PngEncoder, ColorType, ImageEncoder};
    use std::ffi::c_void;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, ReleaseDC, SelectObject,
        BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetIconInfo, ICONINFO};

    let mut icon_info = ICONINFO::default();
    let ok = unsafe { GetIconInfo(icon, &mut icon_info) }.is_ok();
    if !ok || icon_info.hbmColor.is_invalid() {
        return None;
    }

    let mut bmp = BITMAP::default();
    let bmp_ok = unsafe {
        GetObjectW(
            icon_info.hbmColor,
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bmp as *mut _ as *mut c_void),
        )
    };
    if bmp_ok == 0 {
        unsafe {
            if !icon_info.hbmColor.is_invalid() {
                DeleteObject(icon_info.hbmColor);
            }
            if !icon_info.hbmMask.is_invalid() {
                DeleteObject(icon_info.hbmMask);
            }
        }
        return None;
    }

    let width = bmp.bmWidth;
    let height = bmp.bmHeight;
    if width <= 0 || height <= 0 {
        unsafe {
            DeleteObject(icon_info.hbmColor);
            if !icon_info.hbmMask.is_invalid() {
                DeleteObject(icon_info.hbmMask);
            }
        }
        return None;
    }

    let mut buffer = vec![0u8; (width * height * 4) as usize];
    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0 as u32,
            ..Default::default()
        },
        bmiColors: [Default::default(); 1],
    };

    let hdc = unsafe { windows::Win32::Graphics::Gdi::GetDC(HWND(0)) };
    let memdc = unsafe { CreateCompatibleDC(hdc) };
    let old = unsafe { SelectObject(memdc, icon_info.hbmColor) };
    let lines = unsafe {
        GetDIBits(
            memdc,
            icon_info.hbmColor,
            0,
            height as u32,
            Some(buffer.as_mut_ptr() as *mut c_void),
            &mut bmi,
            DIB_RGB_COLORS,
        )
    };
    unsafe {
        SelectObject(memdc, old);
        DeleteDC(memdc);
        ReleaseDC(HWND(0), hdc);
        DeleteObject(icon_info.hbmColor);
        if !icon_info.hbmMask.is_invalid() {
            DeleteObject(icon_info.hbmMask);
        }
    }
    if lines == 0 {
        return None;
    }

    for chunk in buffer.chunks_exact_mut(4) {
        let b = chunk[0];
        chunk[0] = chunk[2];
        chunk[2] = b;
    }

    let mut png_bytes = Vec::new();
    if PngEncoder::new(&mut png_bytes)
        .write_image(
            &buffer,
            width as u32,
            height as u32,
            ColorType::Rgba8.into(),
        )
        .is_ok()
    {
        return Some(STANDARD.encode(png_bytes));
    }
    None
}

/// 生成用于关联一次 drop 与前端落点元素回传的 ID。
fn new_drop_id() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use image::{codecs::png::PngEncoder, ColorType, ImageEncoder, Rgba, RgbaImage};

    fn write_test_png(width: u32, height: u32) -> Vec<u8> {
        let mut image = RgbaImage::new(width, height);
        for (x, y, pixel) in image.enumerate_pixels_mut() {
            let red = (x % 255) as u8;
            let green = (y % 255) as u8;
            *pixel = Rgba([red, green, 180, 255]);
        }

        let mut png_bytes = Vec::new();
        PngEncoder::new(&mut png_bytes)
            .write_image(image.as_raw(), width, height, ColorType::Rgba8.into())
            .expect("test png encoding should succeed");
        png_bytes
    }

    fn write_temp_png_file(width: u32, height: u32) -> PathBuf {
        let mut path = std::env::temp_dir();
        let unique = format!(
            "air-icon-launcher-icon-test-{}-{}.png",
            width,
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default()
        );
        path.push(unique);
        std::fs::write(&path, write_test_png(width, height))
            .expect("test png file should be writable");
        path
    }

    #[test]
    fn extract_icons_from_paths_should_shrink_large_raster_images() {
        let path = write_temp_png_file(384, 256);
        let result = extract_icons_from_paths(vec![path.to_string_lossy().to_string()], None);

        let icon = result
            .into_iter()
            .next()
            .flatten()
            .expect("icon should be extracted");

        let bytes = STANDARD
            .decode(icon.strip_prefix("data:image/png;base64,").unwrap_or(&icon))
            .expect("icon should be decodable");
        let decoded = image::load_from_memory(&bytes).expect("decoded icon should be valid image");
        assert!(
            decoded.width() <= 128 && decoded.height() <= 128,
            "expected icon to be scaled down, got {}x{}",
            decoded.width(),
            decoded.height()
        );

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn extract_icons_from_paths_should_preserve_svg_data_uri_prefix() {
        let mut path = std::env::temp_dir();
        let unique = format!(
            "air-icon-launcher-icon-test-{}.svg",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default()
        );
        path.push(unique);
        std::fs::write(
            &path,
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#00a2ff"/></svg>"##,
        )
        .expect("test svg file should be writable");

        let result = extract_icons_from_paths(vec![path.to_string_lossy().to_string()], None);
        let icon = result
            .into_iter()
            .next()
            .flatten()
            .expect("svg icon should be extracted");

        assert!(
            icon.starts_with("data:image/svg+xml;base64,"),
            "expected svg icon to keep a svg data uri prefix, got {icon}"
        );

        let _ = std::fs::remove_file(path);
    }
}
