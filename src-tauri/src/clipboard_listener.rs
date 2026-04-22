use std::sync::Arc;
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicIsize, Ordering};
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
    PostMessageW, PostQuitMessage, RegisterClassW, SetWindowLongPtrW, GWLP_USERDATA, HWND_MESSAGE,
    MSG, WM_CLIPBOARDUPDATE, WM_CLOSE, WM_DESTROY, WNDCLASSW,
};

#[cfg(target_os = "windows")]
static CLIPBOARD_HWND: AtomicIsize = AtomicIsize::new(0);

struct ClipboardListenerState {
    callback: Arc<dyn Fn() + Send + Sync + 'static>,
    #[cfg(target_os = "windows")]
    active: std::sync::atomic::AtomicBool,
}

impl ClipboardListenerState {
    fn new(callback: Arc<dyn Fn() + Send + Sync + 'static>) -> Self {
        Self {
            callback,
            #[cfg(target_os = "windows")]
            active: std::sync::atomic::AtomicBool::new(true),
        }
    }

    #[cfg(target_os = "windows")]
    fn deactivate(&self) {
        self.active
            .store(false, std::sync::atomic::Ordering::Release);
    }

    #[cfg(target_os = "windows")]
    fn is_active(&self) -> bool {
        self.active.load(std::sync::atomic::Ordering::Acquire)
    }
}

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

        let state = Box::new(ClipboardListenerState::new(callback));
        let ptr = Box::into_raw(state);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, ptr as isize);

        if AddClipboardFormatListener(hwnd).is_err() {
            eprintln!("[ERROR] Failed to add clipboard listener");
            let _ = Box::from_raw(ptr);
            return;
        }

        CLIPBOARD_HWND.store(hwnd.0 as isize, Ordering::Release);

        println!(">>> [CLIPBOARD] Windows event-driven listener started.");

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            DispatchMessageW(&msg);
        }
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
pub fn stop_clipboard_listener() {
    let hwnd_value = CLIPBOARD_HWND.load(Ordering::Acquire);
    if hwnd_value != 0 {
        unsafe {
            let hwnd = HWND(hwnd_value);
            let _ = PostMessageW(hwnd, WM_CLOSE, WPARAM(0), LPARAM(0));
        }
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
                let state = &*(ptr as *const ClipboardListenerState);
                if state.is_active() {
                    (state.callback)();
                }
            }
            LRESULT(0)
        }
        WM_DESTROY => {
            let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA);
            if ptr != 0 {
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
                let state = Box::from_raw(ptr as *mut ClipboardListenerState);
                state.deactivate();
                let _ = RemoveClipboardFormatListener(hwnd);
                drop(state);
            }
            CLIPBOARD_HWND.store(0, Ordering::Release);
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};

    #[test]
    fn listener_state_starts_active_and_runs_callback() {
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_clone = calls.clone();
        let state = ClipboardListenerState::new(Arc::new(move || {
            calls_clone.fetch_add(1, AtomicOrdering::SeqCst);
        }));

        #[cfg(target_os = "windows")]
        assert!(state.is_active());

        (state.callback)();
        assert_eq!(calls.load(AtomicOrdering::SeqCst), 1);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn listener_state_can_be_deactivated() {
        let state = ClipboardListenerState::new(Arc::new(|| {}));
        assert!(state.is_active());
        state.deactivate();
        assert!(!state.is_active());
    }
}
