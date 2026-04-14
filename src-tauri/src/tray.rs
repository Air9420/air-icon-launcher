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
                    app_settings::show_main_window(
                        app,
                        false,
                        app_settings::FollowMouseYAnchor::Center,
                    );
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
                    let app = tray.app_handle();
                    app_settings::show_main_window(
                        app,
                        false,
                        app_settings::FollowMouseYAnchor::Center,
                    );
                }
                _ => {}
            }
        })
        .build(app)
        .unwrap()
}
