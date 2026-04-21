use crate::drag;
use crate::error::AppError;
use crate::error::AppResult;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
#[cfg(windows)]
use winreg::RegKey;

const MAX_SCAN_RESULTS: usize = 180;
const START_MENU_OVERSCAN_FACTOR: usize = 3;

#[derive(Debug, Clone)]
struct ScanRoot {
    path: PathBuf,
    source: &'static str,
    source_rank: u8,
    recursive: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstalledAppEntry {
    pub name: String,
    pub path: String,
    pub icon_base64: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct IconUpdateEvent {
    pub path: String,
    pub launch_path: String,
    pub icon_base64: Option<String>,
}

#[derive(Debug, Clone)]
struct CandidateApp {
    display_name: String,
    launch_path: PathBuf,
    icon_path: PathBuf,
    source: &'static str,
    source_rank: u8,
}

#[tauri::command]
pub async fn scan_installed_apps(app: AppHandle) -> AppResult<Vec<InstalledAppEntry>> {
    #[cfg(windows)]
    {
        let app_handle = app.clone();
        return tauri::async_runtime::spawn_blocking(move || {
            scan_installed_apps_windows(app_handle)
        })
        .await
        .map_err(|error| {
            AppError::internal(format!("scan_installed_apps task failed: {error}"))
        })?;
    }

    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

#[cfg(windows)]
fn scan_installed_apps_windows(app: AppHandle) -> AppResult<Vec<InstalledAppEntry>> {
    let start_total = std::time::Instant::now();

    let start_registry = std::time::Instant::now();
    let mut candidates = collect_registry_candidates();
    eprintln!(
        "[scan_installed_apps] 注册表读取耗时: {:?}，候选数: {}",
        start_registry.elapsed(),
        candidates.len()
    );

    let start_desktop = std::time::Instant::now();
    let desktop_candidates =
        collect_candidates_from_roots(&collect_desktop_roots(), MAX_SCAN_RESULTS);
    eprintln!(
        "[scan_installed_apps] 桌面扫描耗时: {:?}，候选数: {}",
        start_desktop.elapsed(),
        desktop_candidates.len()
    );
    candidates.extend(desktop_candidates);

    let start_dedupe = std::time::Instant::now();
    let mut deduped = sort_and_dedupe_candidates(candidates, MAX_SCAN_RESULTS);
    eprintln!(
        "[scan_installed_apps] 首轮去重耗时: {:?}，保留数: {}",
        start_dedupe.elapsed(),
        deduped.len()
    );

    let remaining = MAX_SCAN_RESULTS.saturating_sub(deduped.len());
    if remaining > 0 {
        let start_menu_start = std::time::Instant::now();
        let start_menu_candidates = collect_candidates_from_roots(
            &collect_start_menu_roots(),
            remaining.saturating_mul(START_MENU_OVERSCAN_FACTOR),
        );
        eprintln!(
            "[scan_installed_apps] 开始菜单补扫耗时: {:?}，候选数: {}",
            start_menu_start.elapsed(),
            start_menu_candidates.len()
        );

        let mut merged = deduped;
        merged.extend(start_menu_candidates);

        let start_merge_dedupe = std::time::Instant::now();
        deduped = sort_and_dedupe_candidates(merged, MAX_SCAN_RESULTS);
        eprintln!(
            "[scan_installed_apps] 二轮去重耗时: {:?}，保留数: {}",
            start_merge_dedupe.elapsed(),
            deduped.len()
        );
    } else {
        eprintln!("[scan_installed_apps] 已满足候选数量，跳过开始菜单补扫");
    }

    let icon_paths: Vec<String> = deduped
        .iter()
        .map(|candidate| candidate.icon_path.to_string_lossy().to_string())
        .collect();

    let launch_paths: Vec<String> = deduped
        .iter()
        .map(|candidate| candidate.launch_path.to_string_lossy().to_string())
        .collect();

    let entries: Vec<InstalledAppEntry> = deduped
        .into_iter()
        .map(|candidate| InstalledAppEntry {
            name: candidate.display_name,
            path: candidate.launch_path.to_string_lossy().to_string(),
            icon_base64: None,
            source: candidate.source.to_string(),
        })
        .collect();

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let icon_start = std::time::Instant::now();
        let icon_base64s: Vec<Option<String>> = drag::extract_icons_from_paths(icon_paths.clone());
        eprintln!(
            "[scan_installed_apps] 图标提取耗时: {:?}",
            icon_start.elapsed()
        );

        for (idx, icon_base64) in icon_base64s.into_iter().enumerate() {
            if idx < launch_paths.len() {
                let _ = app_handle.emit(
                    "installed-app-icon-update",
                    IconUpdateEvent {
                        path: icon_paths[idx].clone(),
                        launch_path: launch_paths[idx].clone(),
                        icon_base64,
                    },
                );
            }
        }
    });

    eprintln!("[scan_installed_apps] 总耗时: {:?}", start_total.elapsed());
    Ok(entries)
}

#[cfg(windows)]
fn collect_start_menu_roots() -> Vec<ScanRoot> {
    let mut roots = Vec::new();

    if let Some(appdata) = std::env::var_os("APPDATA") {
        roots.push(ScanRoot {
            path: PathBuf::from(appdata).join(r"Microsoft\Windows\Start Menu\Programs"),
            source: "开始菜单",
            source_rank: 20,
            recursive: true,
        });
    }
    if let Some(programdata) = std::env::var_os("PROGRAMDATA") {
        roots.push(ScanRoot {
            path: PathBuf::from(programdata).join(r"Microsoft\Windows\Start Menu\Programs"),
            source: "开始菜单",
            source_rank: 21,
            recursive: true,
        });
    }

    roots
}

#[cfg(windows)]
fn collect_desktop_roots() -> Vec<ScanRoot> {
    let mut roots = Vec::new();

    if let Some(userprofile) = std::env::var_os("USERPROFILE") {
        roots.push(ScanRoot {
            path: PathBuf::from(userprofile).join("Desktop"),
            source: "桌面",
            source_rank: 10,
            recursive: false,
        });
    }
    if let Some(public) = std::env::var_os("PUBLIC") {
        roots.push(ScanRoot {
            path: PathBuf::from(public).join("Desktop"),
            source: "桌面",
            source_rank: 11,
            recursive: false,
        });
    }

    roots
}

#[cfg(windows)]
fn collect_candidates_from_roots(roots: &[ScanRoot], max_candidates: usize) -> Vec<CandidateApp> {
    if max_candidates == 0 {
        return Vec::new();
    }

    let mut output = Vec::new();
    let mut remaining = max_candidates;

    for root in roots {
        if !root.path.exists() || remaining == 0 {
            continue;
        }
        collect_candidates_in_dir(
            &root.path,
            root.source,
            root.source_rank,
            root.recursive,
            &mut output,
            &mut remaining,
        );
    }

    output
}

#[cfg(windows)]
fn collect_candidates_in_dir(
    root: &Path,
    source: &'static str,
    source_rank: u8,
    recursive: bool,
    output: &mut Vec<CandidateApp>,
    remaining: &mut usize,
) {
    if *remaining == 0 {
        return;
    }

    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        if *remaining == 0 {
            return;
        }

        let path = entry.path();

        if path.is_dir() {
            if !recursive {
                continue;
            }
            if should_skip_dir(&path) {
                continue;
            }
            collect_candidates_in_dir(&path, source, source_rank, recursive, output, remaining);
            continue;
        }

        if let Some(candidate) = build_candidate_from_path(&path, source, source_rank) {
            output.push(candidate);
            *remaining = remaining.saturating_sub(1);
        }
    }
}

#[cfg(windows)]
fn collect_registry_candidates() -> Vec<CandidateApp> {
    let mut output = Vec::new();
    let registry_roots = [
        (
            RegKey::predef(HKEY_LOCAL_MACHINE),
            r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            RegKey::predef(HKEY_LOCAL_MACHINE),
            r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            RegKey::predef(HKEY_CURRENT_USER),
            r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
    ];

    for (root, sub_path) in registry_roots {
        let uninstall_key = match root.open_subkey_with_flags(sub_path, KEY_READ) {
            Ok(key) => key,
            Err(_) => continue,
        };

        for child_name in uninstall_key.enum_keys().flatten() {
            let child = match uninstall_key.open_subkey_with_flags(&child_name, KEY_READ) {
                Ok(key) => key,
                Err(_) => continue,
            };

            if let Some(candidate) = build_candidate_from_registry(&child) {
                output.push(candidate);
            }
        }
    }

    output
}

#[cfg(windows)]
fn build_candidate_from_registry(key: &RegKey) -> Option<CandidateApp> {
    if is_registry_entry_hidden(key) {
        return None;
    }

    let raw_name = key.get_value::<String, _>("DisplayName").ok()?;
    let display_name = clean_display_name(raw_name.as_ref());
    if display_name.is_empty() || is_noise_name(&display_name) {
        return None;
    }

    let display_icon = key.get_value::<String, _>("DisplayIcon").ok();
    let install_location = key.get_value::<String, _>("InstallLocation").ok();

    let display_icon_path = display_icon
        .as_deref()
        .and_then(parse_registry_path)
        .filter(|path| path.exists());

    let launch_path = display_icon_path
        .as_ref()
        .filter(|path| is_supported_launch_path(path))
        .cloned()
        .or_else(|| {
            install_location
                .as_deref()
                .and_then(|location| resolve_install_location_executable(location, &display_name))
        })?;

    let icon_path = display_icon_path.unwrap_or_else(|| launch_path.clone());

    Some(CandidateApp {
        display_name,
        launch_path,
        icon_path,
        source: "注册表",
        source_rank: 0,
    })
}

#[cfg(windows)]
fn is_registry_entry_hidden(key: &RegKey) -> bool {
    if key.get_value::<u32, _>("SystemComponent").ok() == Some(1) {
        return true;
    }

    let release_type = key
        .get_value::<String, _>("ReleaseType")
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(
        release_type.as_str(),
        "update" | "hotfix" | "security update"
    ) {
        return true;
    }

    key.get_value::<String, _>("ParentKeyName").is_ok()
}

#[cfg(windows)]
fn parse_registry_path(raw: &str) -> Option<PathBuf> {
    let expanded = expand_windows_env_vars(raw.trim());
    let trimmed = expanded.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(stripped) = trimmed.strip_prefix('"') {
        let quoted = stripped.split('"').next()?.trim();
        let candidate = strip_icon_index_suffix(quoted);
        if !candidate.is_empty() {
            return Some(PathBuf::from(candidate));
        }
    }

    let lower = trimmed.to_ascii_lowercase();
    for extension in [
        ".exe", ".lnk", ".bat", ".cmd", ".ico", ".png", ".jpg", ".jpeg", ".svg",
    ] {
        if let Some(index) = lower.find(extension) {
            let end = index + extension.len();
            let candidate = strip_icon_index_suffix(trimmed[..end].trim());
            if !candidate.is_empty() {
                return Some(PathBuf::from(candidate));
            }
        }
    }

    let candidate = strip_icon_index_suffix(trimmed);
    if candidate.is_empty() {
        None
    } else {
        Some(PathBuf::from(candidate))
    }
}

#[cfg(windows)]
fn strip_icon_index_suffix(value: &str) -> &str {
    value
        .trim()
        .trim_end_matches(',')
        .split(',')
        .next()
        .unwrap_or(value)
        .trim()
        .trim_matches('"')
}

#[cfg(windows)]
fn expand_windows_env_vars(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let chars: Vec<char> = value.chars().collect();
    let mut index = 0;

    while index < chars.len() {
        if chars[index] == '%' {
            let mut end = index + 1;
            while end < chars.len() && chars[end] != '%' {
                end += 1;
            }

            if end < chars.len() {
                let key: String = chars[index + 1..end].iter().collect();
                if let Ok(env_value) = std::env::var(&key) {
                    result.push_str(&env_value);
                    index = end + 1;
                    continue;
                }
            }
        }

        result.push(chars[index]);
        index += 1;
    }

    result
}

#[cfg(windows)]
fn resolve_install_location_executable(location: &str, display_name: &str) -> Option<PathBuf> {
    let dir = PathBuf::from(expand_windows_env_vars(location.trim()));
    if !dir.is_dir() {
        return None;
    }

    let normalized_display = normalize_name_for_matching(display_name);
    let normalized_dir_name = dir
        .file_name()
        .and_then(|name| name.to_str())
        .map(normalize_name_for_matching)
        .unwrap_or_default();

    let mut best_path = None;
    let mut best_score = 0i32;
    let mut exe_count = 0usize;

    let entries = fs::read_dir(&dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file()
            || path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("exe"))
                != Some(true)
        {
            continue;
        }

        exe_count += 1;
        let stem = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or_default();
        if is_noise_name(stem) {
            continue;
        }

        let score = score_executable_name(stem, &normalized_display, &normalized_dir_name);
        if score > best_score {
            best_score = score;
            best_path = Some(path);
        }
    }

    if best_score > 0 {
        return best_path;
    }

    if exe_count == 1 {
        return best_path;
    }

    None
}

#[cfg(windows)]
fn score_executable_name(stem: &str, display_name: &str, dir_name: &str) -> i32 {
    let normalized_stem = normalize_name_for_matching(stem);
    if normalized_stem.is_empty() {
        return 0;
    }

    let compact_stem = normalized_stem.replace(' ', "");
    let compact_display = display_name.replace(' ', "");
    let compact_dir = dir_name.replace(' ', "");

    let mut score = 0;
    if compact_stem == compact_display {
        score += 300;
    }
    if !compact_display.is_empty()
        && (compact_stem.contains(&compact_display) || compact_display.contains(&compact_stem))
    {
        score += 180;
    }
    if !compact_dir.is_empty()
        && (compact_stem.contains(&compact_dir) || compact_dir.contains(&compact_stem))
    {
        score += 120;
    }

    for token in display_name
        .split_whitespace()
        .filter(|token| token.len() >= 3)
    {
        if normalized_stem.contains(token) {
            score += 35;
        }
    }

    if matches!(compact_stem.as_str(), "app" | "launcher" | "start" | "main") {
        score -= 50;
    }

    score
}

#[cfg(windows)]
fn sort_and_dedupe_candidates(
    mut candidates: Vec<CandidateApp>,
    max_results: usize,
) -> Vec<CandidateApp> {
    candidates.sort_by(|a, b| {
        a.source_rank.cmp(&b.source_rank).then_with(|| {
            a.display_name
                .to_lowercase()
                .cmp(&b.display_name.to_lowercase())
        })
    });

    let mut seen_paths = HashSet::<String>::new();
    let mut seen_aliases = HashSet::<String>::new();
    let mut deduped = Vec::new();

    for candidate in candidates {
        let path_key = normalize_path_key(&candidate.launch_path);
        let alias_key = normalize_alias_key(&candidate.launch_path, &candidate.display_name);
        if (!path_key.is_empty() && seen_paths.contains(&path_key))
            || (!alias_key.is_empty() && seen_aliases.contains(&alias_key))
        {
            continue;
        }

        if !path_key.is_empty() {
            seen_paths.insert(path_key);
        }
        if !alias_key.is_empty() {
            seen_aliases.insert(alias_key);
        }

        deduped.push(candidate);
        if deduped.len() >= max_results {
            break;
        }
    }

    deduped
}

#[cfg(windows)]
fn build_candidate_from_path(
    path: &Path,
    source: &'static str,
    source_rank: u8,
) -> Option<CandidateApp> {
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())?;

    if extension != "lnk" && extension != "exe" {
        return None;
    }

    let raw_name = path.file_stem()?.to_string_lossy();
    let display_name = clean_display_name(raw_name.as_ref());
    if display_name.is_empty() || is_noise_name(&display_name) {
        return None;
    }

    if extension == "exe" && source == "桌面" {
        return None;
    }

    let launch_path = if extension == "lnk" {
        let resolved = drag::resolve_windows_shortcut_target_pathbuf(&path.to_path_buf())?;
        if !resolved.exists() {
            return None;
        }
        resolved
    } else {
        if !path.exists() {
            return None;
        }
        path.to_path_buf()
    };

    if !is_supported_launch_path(&launch_path) {
        return None;
    }

    let icon_path = determine_candidate_icon_path(&extension, source, path, &launch_path);

    Some(CandidateApp {
        display_name,
        launch_path,
        icon_path,
        source,
        source_rank,
    })
}

#[cfg(windows)]
fn determine_candidate_icon_path(
    extension: &str,
    source: &str,
    shortcut_path: &Path,
    launch_path: &Path,
) -> PathBuf {
    if extension != "lnk" {
        return launch_path.to_path_buf();
    }

    // Desktop shortcuts are often user-created aliases with custom icons.
    // Installed-app scanning should keep the app's canonical icon stable instead of inheriting
    // whichever desktop shortcut happened to be discovered first.
    if source == "桌面" {
        return launch_path.to_path_buf();
    }

    shortcut_path.to_path_buf()
}

#[cfg(windows)]
fn should_skip_dir(path: &Path) -> bool {
    let lowered = path.to_string_lossy().to_ascii_lowercase();
    lowered.contains("\\startup")
        || lowered.contains("\\administrative tools")
        || lowered.contains("\\windows powershell")
        || lowered.contains("\\accessories")
}

#[cfg(windows)]
fn clean_display_name(raw: &str) -> String {
    raw.replace('_', " ")
        .replace('-', " ")
        .replace("()", " ")
        .replace("（）", " ")
        .replace("  ", " ")
        .trim()
        .trim_matches('.')
        .to_string()
}

#[cfg(windows)]
fn is_noise_name(name: &str) -> bool {
    let lowered = name.to_ascii_lowercase();
    let blocked_keywords = [
        "uninstall",
        "unins",
        "卸载",
        "删除",
        "update",
        "updater",
        "更新程序",
        "repair",
        "remove",
        "installer",
        "setup",
        "官网",
        "website",
        "stack builder",
        "about java",
        "readme",
        "license",
        "help",
        "manual",
        "manuals",
        "documentation",
        "release notes",
        "changelog",
        "crash",
        "debug",
        "safe mode",
        "error reporter",
        "telemetry",
        "遥测",
        "语言首选项",
        "用户词典",
        "检查新版本",
        "安装选项",
        "application verifier",
        "administrative tools",
        "services",
        "удалить",
    ];

    blocked_keywords
        .iter()
        .any(|keyword| lowered.contains(keyword))
}

#[cfg(windows)]
fn is_supported_launch_path(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());

    match extension.as_deref() {
        Some("exe") | Some("lnk") | Some("bat") | Some("cmd") => true,
        _ => false,
    }
}

#[cfg(windows)]
fn normalize_path_key(path: &Path) -> String {
    path.to_string_lossy().trim().to_ascii_lowercase()
}

#[cfg(windows)]
fn normalize_alias_key(path: &Path, display_name: &str) -> String {
    let normalized_name = display_name.trim().to_ascii_lowercase();
    let base = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();

    if normalized_name.is_empty() && base.is_empty() {
        return String::new();
    }

    format!("{normalized_name}::{base}")
}

#[cfg(windows)]
fn normalize_name_for_matching(value: &str) -> String {
    value
        .to_ascii_lowercase()
        .replace(
            ['_', '-', '.', '(', ')', '（', '）', '[', ']', '【', '】'],
            " ",
        )
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(all(test, windows))]
mod tests {
    use super::determine_candidate_icon_path;
    use std::path::Path;

    #[test]
    fn desktop_shortcuts_use_launch_path_icon() {
        let shortcut = Path::new(r"C:\Users\Air\Desktop\Chrome.lnk");
        let launch = Path::new(r"C:\Program Files\Google\Chrome\Application\chrome.exe");

        let icon_path = determine_candidate_icon_path("lnk", "桌面", shortcut, launch);

        assert_eq!(icon_path, launch.to_path_buf());
    }

    #[test]
    fn start_menu_shortcuts_keep_shortcut_icon() {
        let shortcut =
            Path::new(r"C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Chrome.lnk");
        let launch = Path::new(r"C:\Program Files\Google\Chrome\Application\chrome.exe");

        let icon_path = determine_candidate_icon_path("lnk", "开始菜单", shortcut, launch);

        assert_eq!(icon_path, shortcut.to_path_buf());
    }
}
