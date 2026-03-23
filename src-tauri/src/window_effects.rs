use tauri::{AppHandle, Manager};
use tauri::window::{EffectsBuilder, Effect, Color};
use crate::error::{AppError, AppResult};

#[tauri::command]
pub async fn set_window_effects(app: AppHandle, enabled: bool) -> AppResult<()> {
    if let Some(window) = app.get_webview_window("main") {
        if enabled {
            let effects = EffectsBuilder::new()
                .effects(vec![Effect::Acrylic])
                .color(Color(0, 0, 0, 0))
                .build();
            window.set_effects(Some(effects)).map_err(|e| AppError::internal(e.to_string()))?;
        } else {
            window.set_effects(None).map_err(|e| AppError::internal(e.to_string()))?;
        }
    }
    Ok(())
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
