use arboard::Clipboard;

pub fn get_clipboard_text() -> Option<String> {
    let mut clipboard = Clipboard::new().ok()?;
    clipboard.get_text().ok()
}

pub fn set_clipboard_text(text: &str) -> bool {
    let mut clipboard = match Clipboard::new() {
        Ok(c) => c,
        Err(_) => return false,
    };
    clipboard.set_text(text).is_ok()
}

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Gdi::{BITMAPINFOHEADER, BI_RGB};
#[cfg(target_os = "windows")]
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    SetClipboardData,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

#[cfg(target_os = "windows")]
const CF_DIB: u32 = 8;

#[cfg(target_os = "windows")]
pub fn set_clipboard_image_windows(png_data: &[u8]) -> bool {
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
pub fn get_clipboard_image_windows() -> Option<Vec<u8>> {
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
pub fn encode_rgba_to_png(rgba_data: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
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
