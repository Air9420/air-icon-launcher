// src-tauri/src/display_monitor.rs
use std::sync::OnceLock;
use std::thread;
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW,
    TranslateMessage, MSG, WM_DISPLAYCHANGE, WNDCLASSW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    WS_POPUP,
};
use windows::core::PCWSTR;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

/// 启动显示器变化监听
pub fn start_display_monitor(app_handle: AppHandle) {
    let _ = APP_HANDLE.set(app_handle);
    
    thread::spawn(|| {
        unsafe {
            create_message_window();
        }
    });
}

/// 创建隐藏的消息窗口
unsafe fn create_message_window() {
    let class_name: Vec<u16> = "AirIconLauncherDisplayMonitor\0"
        .encode_utf16()
        .collect();

    let h_instance = GetModuleHandleW(None).unwrap_or_default();

    let wnd_class = WNDCLASSW {
        style: Default::default(),
        lpfnWndProc: Some(wnd_proc),
        cbClsExtra: 0,
        cbWndExtra: 0,
        hInstance: h_instance.into(),
        hIcon: Default::default(),
        hCursor: Default::default(),
        hbrBackground: Default::default(),
        lpszMenuName: PCWSTR::null(),
        lpszClassName: PCWSTR(class_name.as_ptr()),
    };

    let atom = RegisterClassW(&wnd_class);
    if atom == 0 {
        return;
    }

    let hwnd = CreateWindowExW(
        // 消息窗口必须完全不可见：不参与合成、不进任务栏、不接受输入
        WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
        PCWSTR(class_name.as_ptr()),
        PCWSTR(class_name.as_ptr()),
        // WS_POPUP + 0 尺寸：不显示任何内容
        WS_POPUP,
        0,
        0,
        0,
        0,
        None,
        None,
        h_instance,
        None,
    );

    if hwnd.0 == 0 {
        return;
    }

    let mut msg: MSG = std::mem::zeroed();
    while GetMessageW(&mut msg, hwnd, 0, 0).into() {
        let _ = TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
}

/// 窗口消息处理函数
unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if msg == WM_DISPLAYCHANGE {
        if let Some(app_handle) = APP_HANDLE.get() {
            let _ = app_handle.emit("display-changed", ());
        }
    }
    
    DefWindowProcW(hwnd, msg, wparam, lparam)
}
