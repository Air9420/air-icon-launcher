use crate::app_settings;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

pub fn create_tray(app: &AppHandle) -> tauri::tray::TrayIcon {
    #[cfg(debug_assertions)]
    let icon = {
        let bytes = include_bytes!("../icons/icon-dev.png");
        let img = image::load_from_memory(bytes).unwrap();
        let rgba = img.to_rgba8();
        let (width, height) = rgba.dimensions();
        Image::new_owned(rgba.into_raw(), width, height)
    };

    #[cfg(not(debug_assertions))]
    let icon = app.default_window_icon().cloned().unwrap();
    let settings_i = MenuItem::with_id(app, "settings", "设置", true, None::<&str>).unwrap();
    let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>).unwrap();
    let menu = Menu::with_items(app, &[&settings_i, &quit_i]).unwrap();
    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => {
                if let Some(state) = app.try_state::<crate::TrayState>() {
                    let _ = state.tray.set_visible(false);
                }
                app.exit(0);
            }
            "settings" => {
                if let Some(window) = app.get_webview_window("main") {
                    let was_visible = window.is_visible().unwrap_or(false);
                    app_settings::show_main_window(
                        app,
                        false,
                        app_settings::FollowMouseYAnchor::Center,
                    );
                    if !was_visible {
                        // 与快捷键 / 热角唤起保持一致：隐藏 -> 可见时通知前端重置一次性 UI 状态。
                        let _ = app.emit("window-shown", ());
                    }
                    let _ = window.emit("tray-open-settings", ());
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
            match event {
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    println!("[tray] left click detected");
                    let app = tray.app_handle();
                    // 只在窗口由隐藏变为可见时补发 window-shown：
                    // 快捷键 / 热角唤起都会发这个事件，前端据此重置号标等一次性状态；
                    // 托盘唤起此前缺失该事件，导致 Ctrl+右键隐藏时残留的号标一直显示。
                    let was_visible = app
                        .get_webview_window("main")
                        .map(|w| w.is_visible().unwrap_or(false))
                        .unwrap_or(false);
                    app_settings::show_main_window(
                        app,
                        false,
                        app_settings::FollowMouseYAnchor::Center,
                    );
                    if !was_visible {
                        let _ = app.emit("window-shown", ());
                    }
                }
                _ => {}
            }
        })
        .build(app)
        .unwrap()
}
