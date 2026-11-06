use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

pub const GITHUB_LATEST_JSON_URL: &str =
    "https://github.com/Air9420/air-icon-launcher/releases/latest/download/latest.json";
pub const GITEE_LATEST_RELEASE_API_URL: &str =
    "https://gitee.com/api/v5/repos/Air9420/air-icon-launcher/releases/latest";

/// 可选的更新源标识。
pub const SOURCE_GITHUB: &str = "github";
pub const SOURCE_GITEE: &str = "gitee";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSource {
    pub url: String,
    pub timeout: Duration,
    pub retries: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSourceStatus {
    pub source_type: String,
    pub last_check: Option<chrono::DateTime<chrono::Utc>>,
    pub success: bool,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ResolvedUpdate {
    pub payload: Value,
    pub source: String,
    pub latest_json_url: String,
}

// ---------------------------------------------------------------- 用户偏好

/// 用户可配置的更新偏好，持久化到 `%APPDATA%/com.air.icon-launcher/update-prefs.json`。
///
/// 只保留「首选源」：源由用户显式选择，失败就直接报错让用户自己换，
/// 不再做自动回退。断点续传是下载流程的内建行为，没有开关。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePrefs {
    /// 首选更新源：github | gitee
    #[serde(default = "default_source")]
    pub preferred_source: String,
}

fn default_source() -> String {
    SOURCE_GITHUB.to_string()
}

impl Default for UpdatePrefs {
    fn default() -> Self {
        Self {
            preferred_source: default_source(),
        }
    }
}

impl UpdatePrefs {
    pub fn load() -> Self {
        let path = prefs_path();
        match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                log::warn!("[更新] 偏好解析失败，用默认值: {}", e);
                Self::default()
            }),
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let path = prefs_path();
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {}", e))?;
        }
        let text = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        // 原子写入，避免读到半截内容
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, &text).map_err(|e| format!("写入失败: {}", e))?;
        if std::fs::rename(&tmp, &path).is_err() {
            let _ = std::fs::remove_file(&path);
            if std::fs::rename(&tmp, &path).is_err() {
                let _ = std::fs::remove_file(&tmp);
                std::fs::write(&path, &text).map_err(|e| format!("写入失败: {}", e))?;
            }
        }
        Ok(())
    }

    /// 按偏好构造候选源列表。
    ///
    /// 只有一个候选：用户选哪个就用哪个。失败时把错误原样返回给界面，
    /// 由用户自己切换更新源，不做静默回退。
    pub fn build_candidates(&self) -> Vec<UpdateSource> {
        match self.preferred_source.as_str() {
            SOURCE_GITEE => vec![UpdateSource {
                url: GITEE_LATEST_RELEASE_API_URL.to_string(),
                timeout: Duration::from_secs(15),
                retries: 3,
            }],
            _ => vec![UpdateSource {
                url: GITHUB_LATEST_JSON_URL.to_string(),
                timeout: Duration::from_secs(10),
                retries: 3,
            }],
        }
    }
}

pub fn prefs_path() -> std::path::PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(base)
        .join("com.air.icon-launcher")
        .join("update-prefs.json")
}

// ---------------------------------------------------------------- 源管理

pub struct UpdateSourceManager {
    candidates: Vec<UpdateSource>,
    primary_status: UpdateSourceStatus,
    fallback_status: UpdateSourceStatus,
    /// 每个候选源的探测结果，供 UI 展示
    probed: Vec<SourceProbe>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SourceProbe {
    pub url: String,
    pub kind: String,
    pub ok: bool,
    pub latency_ms: u64,
    pub error: Option<String>,
}

impl UpdateSourceManager {
    pub fn from_prefs(prefs: &UpdatePrefs) -> Self {
        Self {
            candidates: prefs.build_candidates(),
            primary_status: UpdateSourceStatus {
                source_type: "github".to_string(),
                last_check: None,
                success: true,
                error_message: None,
            },
            fallback_status: UpdateSourceStatus {
                source_type: "gitee".to_string(),
                last_check: None,
                success: true,
                error_message: None,
            },
            probed: Vec::new(),
        }
    }

    /// 只用用户选定的那个源检查更新。
    ///
    /// 失败就把错误原样抛给界面（附带探测结果），由用户自己换源重试。
    pub async fn check_update(&mut self) -> Result<ResolvedUpdate, String> {
        self.probed.clear();
        let mut errors: Vec<String> = Vec::new();

        for source in self.candidates.clone() {
            let kind = source_kind(&source.url);
            let started = std::time::Instant::now();
            log::info!("[更新源] 尝试: {} ({})", source.url, kind);

            match self.try_source(&source).await {
                Ok(resolved) => {
                    let ms = started.elapsed().as_millis() as u64;
                    self.probed.push(SourceProbe {
                        url: source.url.clone(),
                        kind: kind.clone(),
                        ok: true,
                        latency_ms: ms,
                        error: None,
                    });
                    log::info!("[更新源] 成功: {} ({}ms)", source.url, ms);
                    self.mark_status(&kind, true, None);
                    return Ok(resolved);
                }
                Err(e) => {
                    let ms = started.elapsed().as_millis() as u64;
                    self.probed.push(SourceProbe {
                        url: source.url.clone(),
                        kind: kind.clone(),
                        ok: false,
                        latency_ms: ms,
                        error: Some(e.clone()),
                    });
                    log::warn!("[更新源] 失败: {} -> {}", source.url, e);
                    self.mark_status(&kind, false, Some(e.clone()));
                    errors.push(format!("{}: {}", kind, e));
                }
            }
        }

        Err(if errors.is_empty() {
            "没有可用的更新源".to_string()
        } else {
            format!("{} 源不可用 -> {}", source_label(&self.candidates), errors.join(" | "))
        })
    }

    fn mark_status(&mut self, kind: &str, ok: bool, err: Option<String>) {
        let now = Some(chrono::Utc::now());
        if kind == "gitee" {
            self.fallback_status.last_check = now;
            self.fallback_status.success = ok;
            self.fallback_status.error_message = err;
        } else {
            self.primary_status.last_check = now;
            self.primary_status.success = ok;
            self.primary_status.error_message = err;
        }
    }

    pub fn probes(&self) -> &[SourceProbe] {
        &self.probed
    }

    async fn try_source(&self, source: &UpdateSource) -> Result<ResolvedUpdate, String> {
        let client = reqwest::Client::builder()
            .timeout(source.timeout)
            .build()
            .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

        let mut last_error = String::new();
        let source_name = source_kind(&source.url);

        for attempt in 1..=source.retries.max(1) {
            log::info!("[更新源] 请求 {}/{}: {}", attempt, source.retries, source.url);
            let result = if source.url == GITEE_LATEST_RELEASE_API_URL {
                self.try_gitee_latest_json(&client).await
            } else {
                let payload = Self::fetch_json(&client, &source.url).await?;
                validate_latest_json(&payload)?;
                Ok((payload, source.url.clone()))
            };

            match result {
                Ok((payload, latest_json_url)) => {
                    return Ok(ResolvedUpdate {
                        payload,
                        source: source_name.to_string(),
                        latest_json_url,
                    })
                }
                Err(error) => {
                    last_error = format!("{} - URL: {}", error, source.url);
                    log::warn!("[更新源] 第 {} 次失败: {}", attempt, error);
                }
            }

            if attempt < source.retries {
                tokio::time::sleep(Duration::from_millis(600)).await;
            }
        }

        Err(last_error)
    }

    async fn try_gitee_latest_json(
        &self,
        client: &reqwest::Client,
    ) -> Result<(Value, String), String> {
        let latest_release = Self::fetch_json(client, GITEE_LATEST_RELEASE_API_URL).await?;
        let latest_json_url = extract_gitee_latest_json_url(&latest_release)
            .ok_or_else(|| "Gitee 最新 release 缺少有效的 tag_name".to_string())?;
        let payload = Self::fetch_json(client, &latest_json_url).await?;
        validate_latest_json(&payload)?;

        Ok((payload, latest_json_url))
    }

    async fn fetch_json(client: &reqwest::Client, url: &str) -> Result<Value, String> {
        match client.get(url).send().await {
            Ok(response) => {
                let status = response.status();
                if status.is_success() {
                    log::info!("[更新源] HTTP {} <- {}", status, url);
                    response
                        .json()
                        .await
                        .map_err(|e| format!("解析响应失败: {}", e))
                } else {
                    let body = response.text().await.unwrap_or_default();
                    let brief: String = body.chars().take(200).collect();
                    Err(format!("HTTP {} - {}", status, brief))
                }
            }
            Err(error) => Err(format!("请求失败: {}", error)),
        }
    }

    #[allow(dead_code)]
    pub fn get_status(&self) -> (UpdateSourceStatus, UpdateSourceStatus) {
        (self.primary_status.clone(), self.fallback_status.clone())
    }
}

fn source_kind(url: &str) -> String {
    if url == GITEE_LATEST_RELEASE_API_URL || url.contains("gitee.com") {
        "gitee".to_string()
    } else {
        "github".to_string()
    }
}

/// 给错误提示用的源名称。
fn source_label(candidates: &[UpdateSource]) -> String {
    candidates
        .first()
        .map(|s| match source_kind(&s.url).as_str() {
            "gitee" => "Gitee",
            _ => "GitHub",
        })
        .unwrap_or("更新")
        .to_string()
}

pub fn extract_gitee_latest_json_url(result: &Value) -> Option<String> {
    result
        .get("tag_name")
        .and_then(|value| value.as_str())
        .filter(|tag| !tag.trim().is_empty())
        .map(build_gitee_latest_json_url)
}

pub fn build_gitee_latest_json_url(tag: &str) -> String {
    format!(
        "https://gitee.com/Air9420/air-icon-launcher/releases/download/{}/latest.json",
        tag.trim()
    )
}

/// 解析 Gitee latest release API，返回 latest.json 地址。
#[allow(dead_code)]
pub async fn resolve_gitee_latest_json_url(timeout: Duration) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let latest_release =
        UpdateSourceManager::fetch_json(&client, GITEE_LATEST_RELEASE_API_URL).await?;

    extract_gitee_latest_json_url(&latest_release)
        .ok_or_else(|| "Gitee 最新 release 缺少有效的 tag_name".to_string())
}

pub fn has_newer_version(current_version: &str, result: &Value) -> bool {
    extract_update_version(result)
        .and_then(parse_version)
        .zip(parse_version(current_version))
        .is_some_and(|(remote, current)| remote > current)
}

fn extract_update_version(result: &Value) -> Option<&str> {
    result.get("version").and_then(|value| value.as_str())
}

fn validate_latest_json(result: &Value) -> Result<(), String> {
    let platform = result
        .get("platforms")
        .and_then(|value| value.get("windows-x86_64"))
        .ok_or_else(|| "latest.json 缺少 windows-x86_64 平台信息".to_string())?;

    let version = extract_update_version(result).unwrap_or_default();
    let url = platform
        .get("url")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let signature = platform
        .get("signature")
        .and_then(|value| value.as_str())
        .unwrap_or_default();

    if version.is_empty() || parse_version(version).is_none() {
        return Err("latest.json 缺少有效版本号".to_string());
    }

    if url.is_empty() {
        return Err("latest.json 缺少下载地址".to_string());
    }

    if signature.is_empty() {
        return Err("latest.json 缺少签名".to_string());
    }

    Ok(())
}

pub fn parse_version(version: &str) -> Option<Vec<u64>> {
    let normalized = version.trim().trim_start_matches('v');
    if normalized.is_empty() {
        return None;
    }

    normalized
        .split('.')
        .map(|segment| segment.parse::<u64>().ok())
        .collect()
}

// ---------------------------------------------------------------- 更新日志

/// 内存 + 文件双写的更新日志。
///
/// 用户反馈「看不到日志」，所以这里把每条日志同时写进
/// `%APPDATA%/com.air.icon-launcher/update.log`，
/// 前端也能通过 `get_update_log` 一次性取回。
pub struct UpdateLogger {
    lines: std::sync::Mutex<Vec<String>>,
}

const LOG_MAX_LINES: usize = 500;

impl UpdateLogger {
    pub fn new() -> Self {
        Self {
            lines: std::sync::Mutex::new(Vec::new()),
        }
    }

    pub fn log(&self, level: &str, message: impl Into<String>) {
        let msg = message.into();
        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let line = format!("[{}] [{}] {}", ts, level, msg);

        // 内存环形缓冲
        if let Ok(mut g) = self.lines.lock() {
            g.push(line.clone());
            if g.len() > LOG_MAX_LINES {
                let overflow = g.len() - LOG_MAX_LINES;
                g.drain(0..overflow);
            }
        }

        // 文件追加
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path())
        {
            use std::io::Write;
            let _ = writeln!(f, "{}", line);
        }

        log::info!("[更新] {}", msg);
    }

    pub fn snapshot(&self) -> Vec<String> {
        self.lines.lock().map(|g| g.clone()).unwrap_or_default()
    }

    pub fn clear(&self) {
        if let Ok(mut g) = self.lines.lock() {
            g.clear();
        }
        let _ = std::fs::remove_file(log_path());
    }
}

impl Default for UpdateLogger {
    fn default() -> Self {
        Self::new()
    }
}

pub fn log_path() -> std::path::PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(base)
        .join("com.air.icon-launcher")
        .join("update.log")
}

// ---------------------------------------------------------------- 断点续传

/// 下载缓存目录：`%LOCALAPPDATA%/com.air.icon-launcher/update-cache/`
pub fn cache_dir() -> std::path::PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .or_else(|_| std::env::var("APPDATA"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(base)
        .join("com.air.icon-launcher")
        .join("update-cache")
}

/// 未完成下载的临时文件（带 .part 后缀）。
pub fn part_path(version: &str) -> std::path::PathBuf {
    cache_dir().join(format!("{}.part", version))
}

/// 已完整下载的安装包缓存。
pub fn cached_installer_path(version: &str) -> std::path::PathBuf {
    cache_dir().join(format!("{}-setup.exe", version))
}

/// 缓存元信息：记录 URL、总大小、已下载字节数，用于校验续传是否可用。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartialMeta {
    pub url: String,
    pub total: u64,
    pub downloaded: u64,
}

pub fn meta_path(version: &str) -> std::path::PathBuf {
    cache_dir().join(format!("{}.meta.json", version))
}

pub fn read_partial_meta(version: &str) -> Option<PartialMeta> {
    let text = std::fs::read_to_string(meta_path(version)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn write_partial_meta(version: &str, meta: &PartialMeta) {
    if let Some(dir) = meta_path(version).parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_string_pretty(meta) {
        let _ = std::fs::write(meta_path(version), text);
    }
}

/// 记录下载进度，供下次启动时校验能否续传。
///
/// 与 `resume_offset` 配对：前者写、后者读，实现跨会话断点续传。
pub fn record_progress(version: &str, url: &str, total: u64, downloaded: u64) {
    write_partial_meta(
        version,
        &PartialMeta {
            url: url.to_string(),
            total,
            downloaded,
        },
    );
}

/// 清理某版本的下载残留。
pub fn clear_partial(version: &str) {
    let _ = std::fs::remove_file(part_path(version));
    let _ = std::fs::remove_file(meta_path(version));
}

/// 已有多少字节可以续传（0 表示从头开始）。
pub fn resume_offset(version: &str, url: &str) -> u64 {
    let part = part_path(version);
    let size = match std::fs::metadata(&part) {
        Ok(m) => m.len(),
        Err(_) => return 0,
    };
    if size == 0 {
        return 0;
    }
    // URL 变了说明是另一个包，不能续传
    match read_partial_meta(version) {
        Some(meta) if meta.url == url => size,
        _ => {
            clear_partial(version);
            0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_gitee_latest_json_url_builds_release_asset_path_from_tag() {
        let release = serde_json::json!({ "tag_name": "v0.5.9" });
        assert_eq!(
            extract_gitee_latest_json_url(&release).as_deref(),
            Some("https://gitee.com/Air9420/air-icon-launcher/releases/download/v0.5.9/latest.json")
        );
    }

    #[test]
    fn validate_latest_json_accepts_complete_payload() {
        let payload = serde_json::json!({
            "version": "0.5.9",
            "platforms": {
                "windows-x86_64": {
                    "url": "https://example.com/0.5.9.zip",
                    "signature": "sig"
                }
            }
        });
        assert!(validate_latest_json(&payload).is_ok());
    }

    #[test]
    fn validate_latest_json_rejects_missing_signature() {
        let payload = serde_json::json!({
            "version": "0.5.9",
            "platforms": { "windows-x86_64": { "url": "https://example.com/x.zip" } }
        });
        assert!(validate_latest_json(&payload).is_err());
    }

    #[test]
    fn validate_latest_json_rejects_missing_url() {
        let payload = serde_json::json!({
            "version": "0.5.9",
            "platforms": { "windows-x86_64": { "signature": "sig" } }
        });
        assert!(validate_latest_json(&payload).is_err());
    }

    #[test]
    fn prefs_default_prefers_github() {
        let p = UpdatePrefs::default();
        let c = p.build_candidates();
        assert_eq!(c.len(), 1, "只应有一个候选源");
        assert_eq!(c[0].url, GITHUB_LATEST_JSON_URL);
    }

    #[test]
    fn prefs_gitee_first_when_selected() {
        let p = UpdatePrefs {
            preferred_source: SOURCE_GITEE.to_string(),
        };
        let c = p.build_candidates();
        assert_eq!(c.len(), 1, "只应有一个候选源");
        assert_eq!(c[0].url, GITEE_LATEST_RELEASE_API_URL);
    }

    #[test]
    fn prefs_never_falls_back_to_other_source() {
        // 源由用户显式选择，失败后由用户自己换，不做自动回退
        for (src, expected) in [
            (SOURCE_GITHUB, GITHUB_LATEST_JSON_URL),
            (SOURCE_GITEE, GITEE_LATEST_RELEASE_API_URL),
        ] {
            let p = UpdatePrefs {
                preferred_source: src.to_string(),
            };
            let c = p.build_candidates();
            assert_eq!(c.len(), 1, "不应出现第二个候选源（{}）", src);
            assert_eq!(c[0].url, expected);
        }
    }

    #[test]
    fn source_kind_detects_hosts() {
        assert_eq!(source_kind(GITHUB_LATEST_JSON_URL), "github");
        assert_eq!(source_kind(GITEE_LATEST_RELEASE_API_URL), "gitee");
        // 未知域名按 github 处理（只有两个源了）
        assert_eq!(source_kind("https://example.com/x.json"), "github");
    }
}
