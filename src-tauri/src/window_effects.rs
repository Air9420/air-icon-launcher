use crate::error::{AppError, AppResult};
use std::time::Duration;
use tauri::window::{Color, Effect, EffectsBuilder};
use tauri::{AppHandle, Manager, PhysicalSize};

#[tauri::command]
pub async fn set_window_effects(app: AppHandle, enabled: bool) -> AppResult<()> {
    if let Some(window) = app.get_webview_window("main") {
        if enabled {
            let effects = EffectsBuilder::new()
                .effects(vec![Effect::Acrylic])
                .color(Color(0, 0, 0, 0))
                .build();
            window
                .set_effects(Some(effects))
                .map_err(|e| AppError::internal(e.to_string()))?;
        } else {
            window
                .set_effects(None)
                .map_err(|e| AppError::internal(e.to_string()))?;
        }
        force_window_refresh(&window);
    }
    Ok(())
}

#[tauri::command]
pub async fn set_window_effect_type(app: AppHandle, effect_type: String) -> AppResult<()> {
    if let Some(window) = app.get_webview_window("main") {
        let effect = match effect_type.as_str() {
            "blur" => Effect::Blur,
            "acrylic" => Effect::Acrylic,
            _ => Effect::Acrylic,
        };

        window
            .set_effects(None)
            .map_err(|e| AppError::internal(format!("clear effects error: {}", e)))?;
        tokio::time::sleep(Duration::from_millis(50)).await;
        let effects = EffectsBuilder::new()
            .effects(vec![effect])
            .color(Color(0, 0, 0, 0))
            .build();
        window
            .set_effects(Some(effects))
            .map_err(|e| AppError::internal(format!("set effects error: {}", e)))?;
        force_window_refresh(&window);
    }
    Ok(())
}

fn force_window_refresh(window: &tauri::WebviewWindow) {
    if let Ok(original_size) = window.outer_size() {
        let new_size = PhysicalSize::new(original_size.width + 1, original_size.height + 1);
        let _ = window.set_size(new_size);
        std::thread::sleep(Duration::from_millis(30));
        let _ = window.set_size(original_size);
    }
}

#[tauri::command]
pub fn restart_app(app: AppHandle) {
    if let Some(state) = app.try_state::<crate::TrayState>() {
        let _ = state.tray.set_visible(false);
    }
    app.restart();
}

#[tauri::command]
pub fn is_window_effects_supported() -> bool {
    #[cfg(target_os = "windows")]
    {
        true
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}
