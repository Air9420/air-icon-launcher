use std::sync::Arc;
#[cfg(target_os = "windows")]
use windows::core::PCWSTR;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
#[cfg(target_os = "windows")]
use windows::Win32::System::DataExchange::{
    AddClipboardFormatListener, RemoveClipboardFormatListener,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, GetWindowLongPtrW,
    RegisterClassW, SetWindowLongPtrW, GWLP_USERDATA, HWND_MESSAGE, MSG, WM_CLIPBOARDUPDATE,
    WNDCLASSW,
};

#[cfg(target_os = "windows")]
extern "system" {
    fn GetModuleHandleW(lpModuleName: PCWSTR) -> HINSTANCE;
}

pub fn listen_clipboard(callback: Arc<dyn Fn() + Send + Sync + 'static>) {
    #[cfg(target_os = "windows")]
    std::thread::spawn(move || unsafe {
        let instance = GetModuleHandleW(PCWSTR::null());

        let window_class = "AirIconClipboardListener";
        let window_class_w: Vec<u16> = window_class
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let wnd_class = WNDCLASSW {
            lpfnWndProc: Some(wnd_proc),
            hInstance: instance,
            lpszClassName: PCWSTR(window_class_w.as_ptr()),
            ..Default::default()
        };

        RegisterClassW(&wnd_class);

        let hwnd: HWND = CreateWindowExW(
            Default::default(),
            PCWSTR(window_class_w.as_ptr()),
            PCWSTR::null(),
            Default::default(),
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            None,
            instance,
            None,
        );

        if hwnd.0 as isize == 0 {
            eprintln!("[ERROR] Failed to create clipboard listener window");
            return;
        }

        let boxed_callback = Box::new(callback);
        let ptr = Box::into_raw(boxed_callback);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, ptr as isize);

        if AddClipboardFormatListener(hwnd).is_err() {
            eprintln!("[ERROR] Failed to add clipboard listener");
            let _ = Box::from_raw(ptr);
            return;
        }

        println!(">>> [CLIPBOARD] Windows event-driven listener started.");

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            DispatchMessageW(&msg);
        }

        let _ = RemoveClipboardFormatListener(hwnd);
        let _ = Box::from_raw(ptr);
    });

    #[cfg(not(target_os = "windows"))]
    {
        use std::thread;
        use std::time::Duration;
        let callback = callback;
        thread::spawn(move || {
            let mut last_hash = 0u64;
            let mut clipboard = arboard::Clipboard::new().unwrap();
            loop {
                if let Ok(text) = clipboard.get_text() {
                    use std::hash::{Hash, Hasher};
                    let mut hasher = std::collections::hash_map::DefaultHasher::new();
                    text.hash(&mut hasher);
                    let current_hash = hasher.finish();
                    if current_hash != last_hash {
                        last_hash = current_hash;
                        callback();
                    }
                }
                thread::sleep(Duration::from_millis(500));
            }
        });
    }
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_CLIPBOARDUPDATE => {
            let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA);
            if ptr != 0 {
                let callback = &*(ptr as *const Arc<dyn Fn() + Send + Sync + 'static>);
                callback();
            }
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}
