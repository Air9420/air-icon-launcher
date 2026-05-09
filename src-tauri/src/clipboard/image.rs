use chrono::Local;
use std::path::Path;

use crate::clipboard::platform::{get_clipboard_image_windows, set_clipboard_image_windows};
#[cfg(not(target_os = "windows"))]
use crate::clipboard::platform::encode_rgba_to_png;

pub fn set_clipboard_image_from_png(png_data: &[u8]) -> bool {
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

pub fn get_clipboard_image() -> Option<Vec<u8>> {
    #[cfg(target_os = "windows")]
    {
        get_clipboard_image_windows()
    }
    #[cfg(not(target_os = "windows"))]
    {
        use arboard::Clipboard;
        let mut clipboard = Clipboard::new().ok()?;
        let image = clipboard.get_image().ok()?;
        let rgba_data = image.bytes.to_vec();
        encode_rgba_to_png(&rgba_data, image.width as u32, image.height as u32)
    }
}

#[allow(dead_code)]
pub fn decode_base64_image(content: &str) -> Option<Vec<u8>> {
    let base64_start = content.find(',')? + 1;
    let base64_data = &content[base64_start..];
    use base64::Engine;
    let engine = base64::engine::general_purpose::STANDARD;
    engine.decode(base64_data).ok()
}

#[allow(dead_code)]
pub fn encode_image_to_base64(data: &[u8]) -> Option<String> {
    use base64::Engine;
    let engine = base64::engine::general_purpose::STANDARD;
    Some(format!("data:image/png;base64,{}", engine.encode(data)))
}

pub fn save_image_atomic(images_dir: &Path, id: &str, png_data: &[u8]) -> Result<String, String> {
    let date = Local::now().format("%Y-%m");
    let dir = images_dir.join(date.to_string());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let target_path = dir.join(format!("{}.png", id));
    let temp_path = target_path.with_extension("tmp");

    std::fs::write(&temp_path, png_data).map_err(|e| e.to_string())?;
    std::fs::rename(&temp_path, &target_path).map_err(|e| e.to_string())?;

    Ok(target_path.to_string_lossy().to_string())
}
