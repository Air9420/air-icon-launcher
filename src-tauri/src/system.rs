use crate::error::{AppError, AppResult};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use once_cell::sync::Lazy;
use regex::Regex;
use reqwest::{header::CONTENT_TYPE, redirect::Policy, Client, Url};
use std::collections::HashSet;
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
#[cfg(target_os = "windows")]
use rusqlite::{Connection, OpenFlags};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows::Win32::UI::Shell::ShellExecuteW;
#[cfg(target_os = "windows")]
use winreg::enums::{HKEY_CLASSES_ROOT, HKEY_CURRENT_USER};
#[cfg(target_os = "windows")]
use winreg::RegKey;

static FAVICON_CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(4))
        .redirect(Policy::limited(5))
        .user_agent("air-icon-launcher/0.1")
        .build()
        .expect("failed to create favicon HTTP client")
});

static LINK_TAG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)<link\b[^>]*>").expect("invalid link tag regex"));

static ATTR_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?is)([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))"#)
        .expect("invalid attribute regex")
});

#[cfg(target_os = "windows")]
static SEARCH_TEMPLATE_PLACEHOLDER_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\{[^{}]+\}").expect("invalid search template regex"));

#[derive(Debug, Clone, serde::Serialize)]
pub struct MonitorFingerprintInfo {
    pub fingerprint: String,
    pub name: Option<String>,
    pub position_x: i32,
    pub position_y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFileEntry {
    pub name: String,
    pub path: String,
    pub used_at: u64,
    pub icon_base64: Option<String>,
}

#[tauri::command]
pub fn open_url(url: String) -> AppResult<()> {
    let url = url.trim();
    if url.is_empty() {
        return Err(AppError::invalid_input("URL cannot be empty"));
    }

    #[cfg(target_os = "windows")]
    {
        open_url_with_shell_execute(url)?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to open URL on macOS: {}", e)))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to open URL on Linux: {}", e)))?;
    }

    Ok(())
}

#[tauri::command]
pub fn open_path(path: String) -> AppResult<()> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_input("Path cannot be empty"));
    }

    let target = PathBuf::from(trimmed);
    if !target.exists() {
        return Err(AppError::not_found(format!("Path: {:?}", target)));
    }

    #[cfg(target_os = "windows")]
    {
        open_path_with_shell_execute(&target)?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&target)
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to open path on macOS: {}", e)))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to open path on Linux: {}", e)))?;
    }

    Ok(())
}

#[tauri::command]
pub fn reveal_in_explorer(path: String) -> AppResult<()> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_input("Path cannot be empty"));
    }

    let target = PathBuf::from(trimmed);
    if !target.exists() {
        return Err(AppError::not_found(format!("Path: {:?}", target)));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe")
            .arg(format!("/select,{}", target.to_string_lossy()))
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to reveal in explorer: {}", e)))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&target)
            .spawn()
            .map_err(|e| AppError::internal(format!("Failed to reveal path on macOS: {}", e)))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = target.parent() {
            Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| AppError::internal(format!("Failed to reveal path on Linux: {}", e)))?;
            return Ok(());
        }
        return open_path(trimmed.to_string());
    }
}

#[cfg(target_os = "windows")]
fn open_url_with_shell_execute(url: &str) -> AppResult<()> {
    let operation = widestring("open");
    let target = widestring(url);

    let result = unsafe {
        ShellExecuteW(
            HWND::default(),
            windows::core::PCWSTR(operation.as_ptr()),
            windows::core::PCWSTR(target.as_ptr()),
            windows::core::PCWSTR::null(),
            windows::core::PCWSTR::null(),
            windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL,
        )
    };

    let code = result.0 as isize;
    if code > 32 {
        return Ok(());
    }

    Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Start-Process -FilePath $args[0]",
            "--",
            url,
        ])
        .spawn()
        .map_err(|e| {
            AppError::internal(format!(
                "Failed to open URL via ShellExecuteW ({}) and PowerShell fallback: {}",
                code, e
            ))
        })?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn open_path_with_shell_execute(path: &Path) -> AppResult<()> {
    let operation = widestring("open");
    let path_str = path.to_string_lossy().to_string();
    let target = widestring(&path_str);

    let result = unsafe {
        ShellExecuteW(
            HWND::default(),
            windows::core::PCWSTR(operation.as_ptr()),
            windows::core::PCWSTR(target.as_ptr()),
            windows::core::PCWSTR::null(),
            windows::core::PCWSTR::null(),
            windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL,
        )
    };

    let code = result.0 as isize;
    if code > 32 {
        return Ok(());
    }

    Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Start-Process -LiteralPath $args[0]",
            "--",
            path_str.as_str(),
        ])
        .spawn()
        .map_err(|e| {
            AppError::internal(format!(
                "Failed to open path via ShellExecuteW ({}) and PowerShell fallback: {}",
                code, e
            ))
        })?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn widestring(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn guess_image_mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        _ => "image/png",
    }
}

#[tauri::command]
pub fn read_local_image_as_data_url(path: String) -> AppResult<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_input("Image path cannot be empty"));
    }

    let file_path = PathBuf::from(trimmed);
    if !file_path.exists() {
        return Err(AppError::not_found(format!("Image path: {:?}", file_path)));
    }

    let bytes = fs::read(&file_path)
        .map_err(|e| AppError::io_error(format!("Failed to read image file: {}", e)))?;
    let encoded = BASE64_STANDARD.encode(bytes);
    let mime = guess_image_mime_type(&file_path);
    Ok(format!("data:{};base64,{}", mime, encoded))
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> AppResult<()> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_input("File path cannot be empty"));
    }

    let file_path = PathBuf::from(trimmed);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| AppError::io_error(format!("Failed to create directory: {}", e)))?;
    }

    fs::write(&file_path, content)
        .map_err(|e| AppError::io_error(format!("Failed to write file: {}", e)))?;
    Ok(())
}

fn build_monitor_fingerprint(
    name: Option<&str>,
    position_x: i32,
    position_y: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
) -> String {
    format!(
        "{}::{}:{}::{}x{}::{:.3}",
        name.unwrap_or("unknown"),
        position_x,
        position_y,
        width,
        height,
        scale_factor
    )
}

fn monitor_to_fingerprint_info(monitor: &tauri::Monitor) -> MonitorFingerprintInfo {
    let name = monitor.name().map(|value| value.to_string());
    let position = monitor.position();
    let size = monitor.size();
    let scale_factor = monitor.scale_factor();

    MonitorFingerprintInfo {
        fingerprint: build_monitor_fingerprint(
            name.as_deref(),
            position.x,
            position.y,
            size.width,
            size.height,
            scale_factor,
        ),
        name,
        position_x: position.x,
        position_y: position.y,
        width: size.width,
        height: size.height,
        scale_factor,
    }
}

#[tauri::command]
pub fn get_current_monitor_fingerprint(
    window: tauri::WebviewWindow,
) -> AppResult<Option<MonitorFingerprintInfo>> {
    let monitor = window
        .current_monitor()
        .map_err(|e| AppError::internal(format!("Failed to read current monitor: {}", e)))?;
    Ok(monitor.as_ref().map(monitor_to_fingerprint_info))
}

#[tauri::command]
pub fn get_recent_files(limit: Option<u32>, include_icons: Option<bool>) -> AppResult<Vec<RecentFileEntry>> {
    let target_limit = limit.unwrap_or(40).clamp(1, 120) as usize;
    let should_include_icons = include_icons.unwrap_or(false);

    #[cfg(target_os = "windows")]
    {
        return get_recent_files_windows(target_limit, should_include_icons);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = target_limit;
        let _ = should_include_icons;
        Ok(Vec::new())
    }
}

#[cfg(target_os = "windows")]
fn get_recent_files_windows(limit: usize, include_icons: bool) -> AppResult<Vec<RecentFileEntry>> {
    let Some(app_data) = std::env::var_os("APPDATA").map(PathBuf::from) else {
        return Ok(Vec::new());
    };
    let recent_dir = app_data.join("Microsoft\\Windows\\Recent");
    if !recent_dir.exists() {
        return Ok(Vec::new());
    }

    let mut candidates: Vec<(PathBuf, u64)> = Vec::new();
    let read_dir = fs::read_dir(&recent_dir)
        .map_err(|e| AppError::io_error(format!("Failed to read Recent directory: {}", e)))?;

    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.eq_ignore_ascii_case("lnk")) != Some(true) {
            continue;
        }

        let used_at = entry
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);

        candidates.push((path, used_at));
    }

    candidates.sort_by(|a, b| b.1.cmp(&a.1));

    let mut dedupe = HashSet::<String>::new();
    let mut entries: Vec<RecentFileEntry> = Vec::new();

    for (lnk_path, used_at) in candidates {
        let Some(target_path) = crate::drag::resolve_windows_shortcut_target_pathbuf(&lnk_path) else {
            continue;
        };

        let target_path_str = target_path.to_string_lossy().to_string();
        let normalized_key = target_path_str
            .replace('/', "\\")
            .to_ascii_lowercase();
        if normalized_key.is_empty() || !dedupe.insert(normalized_key) {
            continue;
        }

        if !target_path.exists() {
            continue;
        }

        let icon_base64 = if include_icons {
            crate::drag::extract_icons_from_paths(vec![target_path_str.clone()])
                .into_iter()
                .next()
                .flatten()
        } else {
            None
        };

        entries.push(RecentFileEntry {
            name: derive_display_name_from_path(&target_path),
            path: target_path_str,
            used_at,
            icon_base64,
        });

        if entries.len() >= limit {
            break;
        }
    }

    Ok(entries)
}

fn derive_display_name_from_path(path: &Path) -> String {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .trim();
    if file_name.is_empty() {
        return path.to_string_lossy().to_string();
    }

    let lower = file_name.to_ascii_lowercase();
    if lower.ends_with(".exe") || lower.ends_with(".lnk") {
        return file_name[..file_name.len().saturating_sub(4)].to_string();
    }
    file_name.to_string()
}

#[cfg(target_os = "windows")]
fn launch_browser_target(browser: &DefaultBrowserInfo, target: &str) -> AppResult<()> {
    Command::new(&browser.program)
        .arg(target)
        .spawn()
        .map_err(|e| {
            AppError::internal(format!(
                "Failed to launch browser '{}' with target '{}': {}",
                browser.program, target, e
            ))
        })?;

    Ok(())
}

#[tauri::command]
pub fn open_browser_search(query: String) -> AppResult<()> {
    let query = query.trim();
    if query.is_empty() {
        return Err(AppError::invalid_input("Search query cannot be empty"));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(browser) = resolve_default_browser_info() {
            if browser.kind == BrowserKind::Firefox {
                Command::new(&browser.program)
                    .arg("-search")
                    .arg(query)
                    .spawn()
                    .map_err(|e| {
                        AppError::internal(format!(
                            "Failed to launch Firefox search via '{}': {}",
                            browser.program, e
                        ))
                    })?;
                return Ok(());
            }

            if let Some(search_url) = build_browser_search_url(&browser, query) {
                return launch_browser_target(&browser, &search_url)
                    .or_else(|_| open_url(search_url));
            }
        }

        let fallback_url = format!(
            "https://www.bing.com/search?q={}",
            percent_encode_query(query)
        );
        return open_url(fallback_url);
    }

    open_url(query.to_string())
}

#[tauri::command]
pub async fn fetch_favicon_from_url(url: String) -> AppResult<Option<String>> {
    let url = url.trim();
    if url.is_empty() {
        return Ok(None);
    }

    let page_url = match normalize_page_url(url) {
        Some(url) => url,
        None => return Ok(None),
    };

    let candidates = collect_favicon_candidates(&page_url).await;

    for candidate in candidates {
        match candidate {
            FaviconCandidate::Data(data_url) => return Ok(Some(data_url)),
            FaviconCandidate::Remote(icon_url) => {
                if let Some(data_url) = fetch_icon_as_data_url(&icon_url).await {
                    return Ok(Some(data_url));
                }
            }
        }
    }

    Ok(None)
}

enum FaviconCandidate {
    Remote(Url),
    Data(String),
}

impl FaviconCandidate {
    fn dedupe_key(&self) -> String {
        match self {
            Self::Remote(url) => url.as_str().to_string(),
            Self::Data(data_url) => data_url.clone(),
        }
    }
}

fn normalize_page_url(url: &str) -> Option<Url> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return None;
    }

    let parsed = Url::parse(trimmed)
        .or_else(|_| Url::parse(&format!("https://{}", trimmed)))
        .ok()?;

    match parsed.scheme() {
        "http" | "https" => Some(parsed),
        _ => None,
    }
}

async fn collect_favicon_candidates(page_url: &Url) -> Vec<FaviconCandidate> {
    let mut candidates = Vec::new();
    let mut dedupe = HashSet::new();
    let mut fallback_base = page_url.clone();

    if let Ok(response) = FAVICON_CLIENT.get(page_url.clone()).send().await {
        fallback_base = response.url().clone();

        if response.status().is_success() {
            let content_type = response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);

            if is_html_response(content_type.as_deref()) {
                if let Ok(html) = response.text().await {
                    for href in extract_icon_hrefs(&html) {
                        if let Some(candidate) = resolve_icon_href(&fallback_base, &href) {
                            push_candidate(&mut candidates, &mut dedupe, candidate);
                        }
                    }
                }
            }
        }
    }

    if let Some(fallback_icon_url) = build_fallback_favicon_url(&fallback_base) {
        push_candidate(
            &mut candidates,
            &mut dedupe,
            FaviconCandidate::Remote(fallback_icon_url),
        );
    }

    candidates
}

fn push_candidate(
    candidates: &mut Vec<FaviconCandidate>,
    dedupe: &mut HashSet<String>,
    candidate: FaviconCandidate,
) {
    let key = candidate.dedupe_key();
    if dedupe.insert(key) {
        candidates.push(candidate);
    }
}

fn extract_icon_hrefs(html: &str) -> Vec<String> {
    let mut hrefs = Vec::new();

    for link_tag in LINK_TAG_RE.find_iter(html).map(|m| m.as_str()) {
        let mut rel = None;
        let mut href = None;

        for capture in ATTR_RE.captures_iter(link_tag) {
            let name = capture
                .get(1)
                .map(|m| m.as_str().to_ascii_lowercase())
                .unwrap_or_default();
            let value = capture
                .get(3)
                .or_else(|| capture.get(4))
                .or_else(|| capture.get(5))
                .map(|m| m.as_str().trim())
                .unwrap_or_default();

            match name.as_str() {
                "rel" => rel = Some(value.to_ascii_lowercase()),
                "href" => href = Some(value.to_string()),
                _ => {}
            }
        }

        if rel.as_deref().is_some_and(|value| value.contains("icon")) {
            if let Some(href) = href.filter(|value| !value.is_empty()) {
                hrefs.push(href);
            }
        }
    }

    hrefs
}

fn resolve_icon_href(base_url: &Url, href: &str) -> Option<FaviconCandidate> {
    let trimmed = href.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lower_trimmed = trimmed.to_ascii_lowercase();

    if lower_trimmed.starts_with("data:image/") {
        return Some(FaviconCandidate::Data(trimmed.to_string()));
    }

    if lower_trimmed.starts_with("javascript:") {
        return None;
    }

    base_url.join(trimmed).ok().map(FaviconCandidate::Remote)
}

fn build_fallback_favicon_url(base_url: &Url) -> Option<Url> {
    base_url.host_str()?;
    let mut root_url = base_url.clone();
    root_url.set_path("/favicon.ico");
    root_url.set_query(None);
    root_url.set_fragment(None);
    Some(root_url)
}

async fn fetch_icon_as_data_url(icon_url: &Url) -> Option<String> {
    let response = FAVICON_CLIENT.get(icon_url.clone()).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let bytes = response.bytes().await.ok()?;

    let mime = detect_image_mime(content_type.as_deref(), &bytes)?;
    let base64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    Some(format!("data:{};base64,{}", mime, base64))
}

fn is_html_response(content_type: Option<&str>) -> bool {
    matches!(
        normalize_content_type(content_type).as_deref(),
        Some("text/html") | Some("application/xhtml+xml")
    )
}

fn detect_image_mime(content_type: Option<&str>, bytes: &[u8]) -> Option<String> {
    let header_mime = normalize_content_type(content_type);

    if let Some(mime) = header_mime.as_deref().and_then(normalize_image_mime) {
        let mime_is_valid = match mime {
            "image/svg+xml" => looks_like_svg(bytes),
            "image/x-icon" => bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]),
            "image/png" => bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
            "image/jpeg" => bytes.starts_with(&[0xFF, 0xD8, 0xFF]),
            "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
            "image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
            "image/bmp" => bytes.starts_with(b"BM"),
            _ => sniff_image_mime(bytes).is_some(),
        };

        if mime_is_valid {
            return Some(mime.to_string());
        }
    }

    sniff_image_mime(bytes).map(str::to_string)
}

fn normalize_content_type(content_type: Option<&str>) -> Option<String> {
    Some(content_type?.split(';').next()?.trim().to_ascii_lowercase())
}

fn normalize_image_mime(mime: &str) -> Option<&'static str> {
    match mime {
        "image/png" => Some("image/png"),
        "image/jpeg" | "image/jpg" => Some("image/jpeg"),
        "image/gif" => Some("image/gif"),
        "image/webp" => Some("image/webp"),
        "image/x-icon" | "image/vnd.microsoft.icon" => Some("image/x-icon"),
        "image/svg+xml" | "image/svg" => Some("image/svg+xml"),
        "image/bmp" => Some("image/bmp"),
        _ => None,
    }
}

fn sniff_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        return Some("image/webp");
    }
    if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        return Some("image/x-icon");
    }
    if bytes.starts_with(b"BM") {
        return Some("image/bmp");
    }
    if looks_like_svg(bytes) {
        return Some("image/svg+xml");
    }

    None
}

fn looks_like_svg(bytes: &[u8]) -> bool {
    let sample = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]).to_ascii_lowercase();
    sample.contains("<svg")
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BrowserKind {
    Chrome,
    Edge,
    Brave,
    Vivaldi,
    Chromium,
    Firefox,
    Unknown,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone)]
struct DefaultBrowserInfo {
    program: String,
    kind: BrowserKind,
}

#[cfg(target_os = "windows")]
fn resolve_default_browser_info() -> Option<DefaultBrowserInfo> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let user_choice = hkcu
        .open_subkey(
            "Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice",
        )
        .ok()?;
    let prog_id: String = user_choice.get_value("ProgId").ok()?;

    let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);
    let command_key = hkcr
        .open_subkey(format!(r"{}\shell\open\command", prog_id))
        .ok()?;
    let template: String = command_key.get_value("").ok()?;
    let program = tokenize_windows_command(&template).into_iter().next()?;

    Some(DefaultBrowserInfo {
        kind: detect_browser_kind(&prog_id, &program),
        program,
    })
}

#[cfg(target_os = "windows")]
fn detect_browser_kind(prog_id: &str, program: &str) -> BrowserKind {
    let name = format!(
        "{} {}",
        prog_id.to_ascii_lowercase(),
        program.to_ascii_lowercase()
    );

    if name.contains("firefox") {
        BrowserKind::Firefox
    } else if name.contains("msedge") || name.contains("microsoftedge") {
        BrowserKind::Edge
    } else if name.contains("brave") {
        BrowserKind::Brave
    } else if name.contains("vivaldi") {
        BrowserKind::Vivaldi
    } else if name.contains("chromium") {
        BrowserKind::Chromium
    } else if name.contains("chrome") {
        BrowserKind::Chrome
    } else {
        BrowserKind::Unknown
    }
}

#[cfg(target_os = "windows")]
fn build_browser_search_url(browser: &DefaultBrowserInfo, query: &str) -> Option<String> {
    let template = browser_user_data_dir(browser.kind)
        .and_then(|user_data_dir| read_browser_search_template(browser.kind, &user_data_dir))
        .or_else(|| fallback_browser_search_template(browser.kind).map(str::to_string))?;
    Some(fill_search_template(&template, query))
}

#[cfg(target_os = "windows")]
fn browser_user_data_dir(kind: BrowserKind) -> Option<PathBuf> {
    let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;

    match kind {
        BrowserKind::Chrome => Some(local_app_data.join("Google\\Chrome\\User Data")),
        BrowserKind::Edge => Some(local_app_data.join("Microsoft\\Edge\\User Data")),
        BrowserKind::Brave => Some(local_app_data.join("BraveSoftware\\Brave-Browser\\User Data")),
        BrowserKind::Vivaldi => Some(local_app_data.join("Vivaldi\\User Data")),
        BrowserKind::Chromium => Some(local_app_data.join("Chromium\\User Data")),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn read_browser_profile_json(
    user_data_dir: &PathBuf,
    file_name: &str,
) -> Option<serde_json::Value> {
    let mut candidates = Vec::new();

    if let Some(profile) = read_last_used_profile(user_data_dir) {
        candidates.push(user_data_dir.join(&profile).join(file_name));
    }

    candidates.push(user_data_dir.join("Default").join(file_name));
    candidates.push(user_data_dir.join("Profile 1").join(file_name));

    for candidate in candidates {
        if let Ok(content) = fs::read_to_string(&candidate) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) {
                return Some(value);
            }
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn read_browser_search_template(kind: BrowserKind, user_data_dir: &PathBuf) -> Option<String> {
    if let Some(preferences) = read_browser_profile_json(user_data_dir, "Preferences") {
        if let Some(template) = extract_browser_search_template(&preferences) {
            if is_usable_search_template(template) {
                return Some(template.to_string());
            }
        }
    }

    if let Some(preferences) = read_browser_profile_json(user_data_dir, "Secure Preferences") {
        if let Some(template) = extract_browser_search_template(&preferences) {
            if is_usable_search_template(template) {
                return Some(template.to_string());
            }
        }
    }

    read_browser_search_template_from_web_data(kind, user_data_dir)
        .filter(|template| is_usable_search_template(template))
}

#[cfg(target_os = "windows")]
fn read_last_used_profile(user_data_dir: &PathBuf) -> Option<String> {
    let content = fs::read_to_string(user_data_dir.join("Local State")).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&content).ok()?;
    value
        .pointer("/profile/last_used")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

#[cfg(target_os = "windows")]
fn extract_browser_search_template(preferences: &serde_json::Value) -> Option<&str> {
    preferences
        .pointer("/default_search_provider_data/mirrored_template_url_data/url")
        .and_then(|v| v.as_str())
        .or_else(|| {
            preferences
                .pointer("/default_search_provider_data/template_url_data/url")
                .and_then(|v| v.as_str())
        })
        .or_else(|| {
            preferences
                .pointer("/account_values/default_search_provider_data/mirrored_template_url_data/url")
                .and_then(|v| v.as_str())
        })
        .or_else(|| {
            preferences
                .pointer("/account_values/default_search_provider_data/template_url_data/url")
                .and_then(|v| v.as_str())
        })
        .or_else(|| {
            preferences
                .pointer("/default_search_provider/search_url")
                .and_then(|v| v.as_str())
        })
        .or_else(|| {
            preferences
                .pointer("/default_search_provider_data/url")
                .and_then(|v| v.as_str())
        })
}

#[cfg(target_os = "windows")]
fn read_browser_search_template_from_web_data(
    kind: BrowserKind,
    user_data_dir: &PathBuf,
) -> Option<String> {
    for profile in preferred_browser_profiles(user_data_dir) {
        let web_data_path = user_data_dir.join(&profile).join("Web Data");
        if let Some(template) = read_search_template_from_web_data_file(kind, &web_data_path) {
            return Some(template);
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn preferred_browser_profiles(user_data_dir: &PathBuf) -> Vec<String> {
    let mut profiles = Vec::new();

    if let Some(profile) = read_last_used_profile(user_data_dir) {
        profiles.push(profile);
    }

    for fallback in ["Default", "Profile 1", "Profile 2"] {
        if !profiles.iter().any(|profile| profile == fallback) {
            profiles.push(fallback.to_string());
        }
    }

    profiles
}

#[cfg(target_os = "windows")]
fn read_search_template_from_web_data_file(
    kind: BrowserKind,
    web_data_path: &PathBuf,
) -> Option<String> {
    if !web_data_path.exists() {
        return None;
    }

    let temp_copy = std::env::temp_dir().join(format!(
        "air-icon-launcher-web-data-{}-{}.db",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_nanos()
    ));

    fs::copy(web_data_path, &temp_copy).ok()?;

    let result = (|| {
        let conn = Connection::open_with_flags(&temp_copy, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
        read_search_template_by_meta(&conn)
            .or_else(|| read_search_template_by_candidate(&conn, kind))
    })();

    let _ = fs::remove_file(&temp_copy);
    result
}

#[cfg(target_os = "windows")]
fn read_search_template_by_meta(conn: &Connection) -> Option<String> {
    for key in [
        "Default Search Provider ID",
        "Default Search Provider ID Backup",
    ] {
        if let Ok(id_text) = conn.query_row(
            "SELECT value FROM meta WHERE key = ?1",
            [key],
            |row| row.get::<_, String>(0),
        ) {
            if let Ok(default_id) = id_text.parse::<i64>() {
                if let Ok(url) = conn.query_row(
                    "SELECT url FROM keywords WHERE id = ?1",
                    [default_id],
                    |row| row.get::<_, String>(0),
                ) {
                    return Some(url);
                }
            }
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn read_search_template_by_candidate(conn: &Connection, kind: BrowserKind) -> Option<String> {
    let browser_hint = match kind {
        BrowserKind::Edge => "%bing%",
        BrowserKind::Chrome | BrowserKind::Chromium | BrowserKind::Brave | BrowserKind::Vivaldi => {
            "%google%"
        }
        _ => "%",
    };

    conn.query_row(
        "SELECT url
         FROM keywords
         WHERE (url LIKE '%{searchTerms}%' OR url LIKE '%25s%' OR url LIKE '%?q=%' OR url LIKE '%&q=%' OR url LIKE '%wd=%')
           AND url LIKE ?1
         ORDER BY
           CASE WHEN prepopulate_id > 0 THEN 0 ELSE 1 END,
           usage_count DESC,
           last_modified DESC,
           id ASC
         LIMIT 1",
        [browser_hint],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .or_else(|| {
        conn.query_row(
            "SELECT url
             FROM keywords
             WHERE url LIKE '%{searchTerms}%'
                OR url LIKE '%?q=%'
                OR url LIKE '%&q=%'
                OR url LIKE '%wd=%'
             ORDER BY usage_count DESC, last_modified DESC, id ASC
             LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
    })
}

#[cfg(target_os = "windows")]
fn fallback_browser_search_template(kind: BrowserKind) -> Option<&'static str> {
    match kind {
        BrowserKind::Edge => Some("https://www.bing.com/search?q={searchTerms}"),
        BrowserKind::Chrome
        | BrowserKind::Chromium
        | BrowserKind::Brave
        | BrowserKind::Vivaldi => Some("https://www.google.com/search?q={searchTerms}"),
        _ => None,
    }
}

fn is_usable_search_template(template: &str) -> bool {
    let preview_url = fill_search_template(template, "air-icon-launcher");
    let parsed = match Url::parse(&preview_url) {
        Ok(url) => url,
        Err(_) => return false,
    };

    if !matches!(parsed.scheme(), "http" | "https") {
        return false;
    }

    let Some(host) = parsed.host_str() else {
        return false;
    };

    if host.eq_ignore_ascii_case("search") {
        return false;
    }

    true
}

fn fill_search_template(template: &str, query: &str) -> String {
    let encoded_query = percent_encode_query(query);
    let mut url = template
        .replace("{searchTerms}", &encoded_query)
        .replace("{inputEncoding}", "UTF-8")
        .replace("{outputEncoding}", "UTF-8")
        .replace("{language}", "zh-CN")
        .replace("{google:baseURL}", "https://www.google.com/")
        .replace("{google:RLZ}", "")
        .replace("{google:acceptedSuggestion}", "")
        .replace("{google:originalQueryForSuggestion}", "")
        .replace("{google:assistedQueryStats}", "")
        .replace("{google:searchClient}", "")
        .replace("{google:searchFieldtrialParameter}", "");

    #[cfg(target_os = "windows")]
    {
        url = SEARCH_TEMPLATE_PLACEHOLDER_RE
            .replace_all(&url, "")
            .into_owned();
    }

    url
}

fn percent_encode_query(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());

    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            b' ' => encoded.push_str("%20"),
            _ => {
                let _ = write!(encoded, "%{byte:02X}");
            }
        }
    }

    encoded
}

#[cfg(target_os = "windows")]
fn tokenize_windows_command(command: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;

    for ch in command.chars() {
        match ch {
            '"' => in_quotes = !in_quotes,
            ' ' | '\t' if !in_quotes => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_icon_hrefs_from_link_tags() {
        let html = r#"
            <html>
                <head>
                    <link rel="shortcut icon" href="/favicon.ico">
                    <link rel="apple-touch-icon" href="https://cdn.example.com/icon.png">
                    <link rel="stylesheet" href="/site.css">
                </head>
            </html>
        "#;

        let hrefs = extract_icon_hrefs(html);
        assert_eq!(
            hrefs,
            vec![
                "/favicon.ico".to_string(),
                "https://cdn.example.com/icon.png".to_string()
            ]
        );
    }

    #[test]
    fn rejects_html_payloads_when_detecting_images() {
        let html = br#"<html><body>not an icon</body></html>"#;
        assert_eq!(detect_image_mime(Some("text/html"), html), None);
    }

    #[test]
    fn accepts_data_image_hrefs() {
        let base_url = Url::parse("https://example.com/app").unwrap();
        let candidate = resolve_icon_href(&base_url, "data:image/svg+xml;base64,PHN2Zz4=");

        match candidate {
            Some(FaviconCandidate::Data(data_url)) => {
                assert!(data_url.starts_with("data:image/svg+xml;base64,"));
            }
            _ => panic!("expected data URL favicon candidate"),
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn extracts_search_template_from_chromium_preferences() {
        let preferences = serde_json::json!({
            "default_search_provider_data": {
                "mirrored_template_url_data": {
                    "url": "https://www.baidu.com/s?wd={searchTerms}&ie={inputEncoding}"
                }
            }
        });

        assert_eq!(
            extract_browser_search_template(&preferences),
            Some("https://www.baidu.com/s?wd={searchTerms}&ie={inputEncoding}")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn tokenizes_windows_browser_command_template() {
        let tokens = tokenize_windows_command(
            r#""C:\Program Files\Google\Chrome\Application\chrome.exe" --single-argument "%1""#,
        );

        assert_eq!(
            tokens,
            vec![
                r#"C:\Program Files\Google\Chrome\Application\chrome.exe"#.to_string(),
                "--single-argument".to_string(),
                "%1".to_string()
            ]
        );
    }

    #[test]
    fn fills_search_template_with_encoded_query() {
        let url = fill_search_template(
            "https://www.google.com/search?q={searchTerms}&ie={inputEncoding}",
            "air icon 123",
        );

        assert_eq!(
            url,
            "https://www.google.com/search?q=air%20icon%20123&ie=UTF-8"
        );
    }

    #[test]
    fn percent_encodes_numeric_and_non_ascii_queries() {
        assert_eq!(percent_encode_query("12345678"), "12345678");
        assert_eq!(percent_encode_query("你好 world"), "%E4%BD%A0%E5%A5%BD%20world");
    }

    #[test]
    fn fills_baidu_fragment_search_template() {
        let url = fill_search_template(
            "https://www.baidu.com/#ie={inputEncoding}&wd={searchTerms}",
            "qweqweqwe",
        );

        assert_eq!(url, "https://www.baidu.com/#ie=UTF-8&wd=qweqweqwe");
    }

    #[test]
    fn rejects_internal_browser_search_template() {
        assert!(!is_usable_search_template("http://search/?q={searchTerms}&"));
        assert!(is_usable_search_template(
            "https://www.bing.com/search?q={searchTerms}"
        ));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn removes_unknown_placeholders_from_search_template() {
        let url = fill_search_template(
            "https://www.google.com/search?q={searchTerms}&source={unknownPlaceholder}",
            "qweqweqwe",
        );

        assert_eq!(
            url,
            "https://www.google.com/search?q=qweqweqwe&source="
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn detects_browser_kind_from_registry_metadata() {
        assert_eq!(
            detect_browser_kind("MSEdgeHTM", r#"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"#),
            BrowserKind::Edge
        );
        assert_eq!(
            detect_browser_kind("FirefoxURL-308046B0AF4A39CB", r#"C:\Program Files\Mozilla Firefox\firefox.exe"#),
            BrowserKind::Firefox
        );
    }
}
