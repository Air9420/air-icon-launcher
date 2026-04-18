use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::time::Duration;
use tauri::window::{Color, Effect, EffectsBuilder};
use tauri::{AppHandle, Manager, PhysicalSize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowEffectSupportInfo {
    pub supported: bool,
    pub blur_supported: bool,
    pub acrylic_supported: bool,
    pub fallback_effect_type: Option<String>,
    pub message: Option<String>,
    pub product_name: Option<String>,
    pub display_version: Option<String>,
    pub build_number: Option<u32>,
}

#[tauri::command]
pub async fn set_window_effects(app: AppHandle, enabled: bool) -> AppResult<()> {
    if let Some(window) = app.get_webview_window("main") {
        if enabled {
            let support = detect_window_effect_support();
            let fallback = support.fallback_effect_type.as_deref().ok_or_else(|| {
                unsupported_effect_error(&support, "当前系统版本不建议启用窗口特效")
            })?;
            let effect = parse_effect_type(fallback, &support)?;
            apply_window_effect(&window, effect).await?;
        } else {
            window
                .set_effects(None)
                .map_err(|e| AppError::internal(e.to_string()))?;
            force_window_refresh(&window);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn set_window_effect_type(app: AppHandle, effect_type: String) -> AppResult<()> {
    if let Some(window) = app.get_webview_window("main") {
        let support = detect_window_effect_support();
        let effect = parse_effect_type(effect_type.as_str(), &support)?;
        apply_window_effect(&window, effect).await?;
    }
    Ok(())
}

async fn apply_window_effect(window: &tauri::WebviewWindow, effect: Effect) -> AppResult<()> {
    if apply_window_effect_direct(window, effect).is_ok() {
        tokio::time::sleep(Duration::from_millis(1)).await;
        force_window_refresh(window);
        return Ok(());
    }

    window
        .set_effects(None)
        .map_err(|e| AppError::internal(format!("clear effects error: {}", e)))?;
    tokio::time::sleep(Duration::from_millis(16)).await;
    apply_window_effect_direct(window, effect)
        .map_err(|e| AppError::internal(format!("set effects error: {}", e)))?;
    tokio::time::sleep(Duration::from_millis(8)).await;
    force_window_refresh(window);
    Ok(())
}

fn apply_window_effect_direct(window: &tauri::WebviewWindow, effect: Effect) -> tauri::Result<()> {
    let effects = EffectsBuilder::new()
        .effects(vec![effect])
        .color(Color(0, 0, 0, 25))
        .build();
    window.set_effects(Some(effects))
}

fn parse_effect_type(effect_type: &str, support: &WindowEffectSupportInfo) -> AppResult<Effect> {
    match effect_type {
        "blur" if support.blur_supported => Ok(Effect::Blur),
        "acrylic" if support.acrylic_supported => Ok(Effect::Acrylic),
        "blur" => Err(unsupported_effect_error(
            support,
            "当前系统版本不建议启用 Blur 窗口效果",
        )),
        "acrylic" => Err(unsupported_effect_error(
            support,
            "当前系统版本不建议启用 Acrylic 窗口效果",
        )),
        _ => Err(AppError::invalid_input("Unsupported window effect type")),
    }
}

fn unsupported_effect_error(support: &WindowEffectSupportInfo, fallback_message: &str) -> AppError {
    AppError::new(
        "WINDOW_EFFECT_UNSUPPORTED",
        support
            .message
            .clone()
            .unwrap_or_else(|| fallback_message.to_string()),
    )
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
    detect_window_effect_support().supported
}

#[tauri::command]
pub fn get_window_effect_support_info() -> WindowEffectSupportInfo {
    detect_window_effect_support()
}

fn detect_window_effect_support() -> WindowEffectSupportInfo {
    #[cfg(target_os = "windows")]
    {
        detect_windows_window_effect_support()
    }
    #[cfg(not(target_os = "windows"))]
    {
        WindowEffectSupportInfo {
            supported: false,
            blur_supported: false,
            acrylic_supported: false,
            fallback_effect_type: None,
            message: Some("当前系统不支持该应用的窗口特效，建议启用性能模式".to_string()),
            product_name: None,
            display_version: None,
            build_number: None,
        }
    }
}

#[cfg(target_os = "windows")]
fn detect_windows_window_effect_support() -> WindowEffectSupportInfo {
    let version = read_windows_version_info();

    let Some(build_number) = version.build_number else {
        return WindowEffectSupportInfo {
            supported: true,
            blur_supported: true,
            acrylic_supported: true,
            fallback_effect_type: Some("blur".to_string()),
            message: None,
            product_name: version.product_name,
            display_version: version.display_version,
            build_number: None,
        };
    };

    if build_number >= 17763 {
        return WindowEffectSupportInfo {
            supported: true,
            blur_supported: true,
            acrylic_supported: true,
            fallback_effect_type: Some("blur".to_string()),
            message: None,
            product_name: version.product_name,
            display_version: version.display_version,
            build_number: Some(build_number),
        };
    }

    let os_label = format_windows_version_label(
        version.product_name.as_deref(),
        version.display_version.as_deref(),
        Some(build_number),
    );

    WindowEffectSupportInfo {
        supported: false,
        blur_supported: false,
        acrylic_supported: false,
        fallback_effect_type: None,
        message: Some(format!(
            "{} 对 Blur / Acrylic 的兼容性较差，已建议切换到性能模式。建议升级到较新的 Windows 10 或 Windows 11。",
            os_label
        )),
        product_name: version.product_name,
        display_version: version.display_version,
        build_number: Some(build_number),
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, Default)]
struct WindowsVersionInfo {
    product_name: Option<String>,
    display_version: Option<String>,
    build_number: Option<u32>,
}

#[cfg(target_os = "windows")]
fn read_windows_version_info() -> WindowsVersionInfo {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let Ok(key) = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion")
    else {
        return WindowsVersionInfo::default();
    };

    let product_name = key.get_value::<String, _>("ProductName").ok();
    let display_version = key
        .get_value::<String, _>("DisplayVersion")
        .ok()
        .or_else(|| key.get_value::<String, _>("ReleaseId").ok());
    let build_number = key
        .get_value::<String, _>("CurrentBuildNumber")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .or_else(|| {
            key.get_value::<String, _>("CurrentBuild")
                .ok()
                .and_then(|value| value.parse::<u32>().ok())
        });

    WindowsVersionInfo {
        product_name,
        display_version,
        build_number,
    }
}

#[cfg(target_os = "windows")]
fn format_windows_version_label(
    product_name: Option<&str>,
    display_version: Option<&str>,
    build_number: Option<u32>,
) -> String {
    let mut label = product_name.unwrap_or("当前 Windows").to_string();
    if let Some(version) = display_version.filter(|value| !value.trim().is_empty()) {
        label.push(' ');
        label.push_str(version.trim());
    }
    if let Some(build) = build_number {
        label.push_str(&format!("（build {}）", build));
    }
    label
}
