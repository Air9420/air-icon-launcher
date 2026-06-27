use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Ordering;
use std::time::Duration;

pub const GITHUB_LATEST_JSON_URL: &str =
    "https://github.com/Air9420/air-icon-launcher/releases/latest/download/latest.json";
pub const GITEE_LATEST_RELEASE_API_URL: &str =
    "https://gitee.com/api/v5/repos/Air9420/air-icon-launcher/releases/latest";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSource {
    pub url: String,
    pub timeout: Duration,
    pub retries: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSourceConfig {
    pub primary: UpdateSource,
    pub fallback: UpdateSource,
}

impl UpdateSourceConfig {
    pub fn new(version: &str) -> Self {
        let _ = version;
        Self {
            primary: UpdateSource {
                url: GITHUB_LATEST_JSON_URL.to_string(),
                timeout: Duration::from_secs(10),
                retries: 3,
            },
            fallback: UpdateSource {
                url: GITEE_LATEST_RELEASE_API_URL.to_string(),
                timeout: Duration::from_secs(15),
                retries: 2,
            },
        }
    }
}

impl Default for UpdateSourceConfig {
    fn default() -> Self {
        Self::new(env!("CARGO_PKG_VERSION"))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSourceStatus {
    pub source_type: String,
    pub last_check: Option<chrono::DateTime<chrono::Utc>>,
    pub success: bool,
    pub error_message: Option<String>,
}

pub struct UpdateSourceManager {
    config: UpdateSourceConfig,
    primary_status: UpdateSourceStatus,
    fallback_status: UpdateSourceStatus,
}

impl UpdateSourceManager {
    pub fn new(config: UpdateSourceConfig) -> Self {
        Self {
            config,
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
        }
    }

    pub async fn check_update(&mut self) -> Result<serde_json::Value, String> {
        let primary_fut = self.try_source(&self.config.primary);
        let fallback_fut = self.try_source(&self.config.fallback);

        tokio::select! {
            result = primary_fut => {
                self.primary_status.last_check = Some(chrono::Utc::now());
                match &result {
                    Ok(_) => {
                        self.primary_status.success = true;
                        self.primary_status.error_message = None;
                        log::info!("主更新源(GitHub)响应最快");
                    }
                    Err(e) => {
                        self.primary_status.success = false;
                        self.primary_status.error_message = Some(e.clone());
                        log::warn!("主更新源检查失败: {}", e);
                    }
                }
                result
            }
            result = fallback_fut => {
                self.fallback_status.last_check = Some(chrono::Utc::now());
                match &result {
                    Ok(_) => {
                        self.fallback_status.success = true;
                        self.fallback_status.error_message = None;
                        log::info!("从更新源(Gitee)响应最快");
                    }
                    Err(e) => {
                        self.fallback_status.success = false;
                        self.fallback_status.error_message = Some(e.clone());
                        log::warn!("从更新源检查失败: {}", e);
                    }
                }
                result
            }
        }
    }

    async fn try_source(&self, source: &UpdateSource) -> Result<serde_json::Value, String> {
        let client = reqwest::Client::builder()
            .timeout(source.timeout)
            .build()
            .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

        let mut last_error = String::new();

        for attempt in 1..=source.retries {
            log::info!("[更新源] 尝试请求: {} (第{}次)", source.url, attempt);
            let result = if source.url == GITEE_LATEST_RELEASE_API_URL {
                self.try_gitee_latest_json(&client).await
            } else {
                Self::fetch_json(&client, &source.url).await
            };

            match result {
                Ok(payload) => return Ok(payload),
                Err(error) => {
                    last_error = format!("{} - URL: {}", error, source.url);
                    log::warn!("[更新源] 请求失败: {} -> {}", source.url, error);
                }
            }

            if attempt < source.retries {
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }

        Err(last_error)
    }

    async fn try_gitee_latest_json(&self, client: &reqwest::Client) -> Result<Value, String> {
        let latest_release = Self::fetch_json(client, GITEE_LATEST_RELEASE_API_URL).await?;
        let latest_json_url = extract_gitee_latest_json_url(&latest_release)
            .ok_or_else(|| "Gitee 最新 release 缺少有效的 tag_name".to_string())?;

        Self::fetch_json(client, &latest_json_url).await
    }

    async fn fetch_json(client: &reqwest::Client, url: &str) -> Result<Value, String> {
        match client.get(url).send().await {
            Ok(response) => {
                let status = response.status();
                if status.is_success() {
                    log::info!("[更新源] 请求成功: {} -> {}", url, status);
                    response
                        .json()
                        .await
                        .map_err(|e| format!("解析响应失败: {}", e))
                } else {
                    let body = response.text().await.unwrap_or_default();
                    Err(format!("HTTP错误: {} - 响应: {}", status, body))
                }
            }
            Err(error) => Err(format!("请求失败: {}", error)),
        }
    }

    pub fn get_status(&self) -> (UpdateSourceStatus, UpdateSourceStatus) {
        (self.primary_status.clone(), self.fallback_status.clone())
    }
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

pub async fn resolve_gitee_latest_json_url(timeout: Duration) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let latest_release = UpdateSourceManager::fetch_json(&client, GITEE_LATEST_RELEASE_API_URL).await?;

    extract_gitee_latest_json_url(&latest_release)
        .ok_or_else(|| "Gitee 最新 release 缺少有效的 tag_name".to_string())
}

pub fn select_best_update_result(current_version: &str, results: Vec<Value>) -> Option<Value> {
    results
        .into_iter()
        .filter(|result| has_newer_version(current_version, result))
        .max_by(|left, right| compare_result_versions(left, right))
}

pub fn has_newer_version(current_version: &str, result: &Value) -> bool {
    extract_update_version(result)
        .and_then(parse_version)
        .zip(parse_version(current_version))
        .is_some_and(|(remote, current)| remote > current)
}

fn select_higher_version_result(left: Value, right: Value) -> Value {
    match compare_result_versions(&left, &right) {
        Ordering::Less => right,
        Ordering::Equal | Ordering::Greater => left,
    }
}

fn compare_result_versions(left: &Value, right: &Value) -> Ordering {
    match (
        extract_update_version(left).and_then(parse_version),
        extract_update_version(right).and_then(parse_version),
    ) {
        (Some(left_version), Some(right_version)) => left_version.cmp(&right_version),
        (Some(_), None) => Ordering::Greater,
        (None, Some(_)) => Ordering::Less,
        (None, None) => Ordering::Equal,
    }
}

fn extract_update_version(result: &Value) -> Option<&str> {
    result.get("version").and_then(|value| value.as_str())
}

fn parse_version(version: &str) -> Option<Vec<u64>> {
    let normalized = version.trim().trim_start_matches('v');
    if normalized.is_empty() {
        return None;
    }

    normalized
        .split('.')
        .map(|segment| segment.parse::<u64>().ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_source_config_uses_gitee_latest_api_for_fallback() {
        let config = UpdateSourceConfig::new("0.5.8");

        assert_eq!(config.fallback.url, GITEE_LATEST_RELEASE_API_URL);
    }

    #[test]
    fn extract_gitee_latest_json_url_builds_release_asset_path_from_tag() {
        let release = serde_json::json!({
            "tag_name": "v0.5.9"
        });

        let url = extract_gitee_latest_json_url(&release);

        assert_eq!(
            url.as_deref(),
            Some("https://gitee.com/Air9420/air-icon-launcher/releases/download/v0.5.9/latest.json")
        );
    }

    #[test]
    fn select_best_update_prefers_higher_version() {
        let current_version = "0.5.8";
        let primary = serde_json::json!({
            "version": "0.5.9",
            "platforms": {
                "windows-x86_64": {
                    "url": "https://example.com/0.5.9.zip"
                }
            }
        });
        let fallback = serde_json::json!({
            "version": "0.5.8",
            "platforms": {
                "windows-x86_64": {
                    "url": "https://example.com/0.5.8.zip"
                }
            }
        });

        let selected = select_best_update_result(current_version, vec![primary.clone(), fallback])
            .expect("should select newer version");

        assert_eq!(selected, primary);
    }

    #[test]
    fn select_best_update_rejects_older_versions() {
        let current_version = "0.5.8";
        let older = serde_json::json!({
            "version": "0.5.1",
            "platforms": {
                "windows-x86_64": {
                    "url": "https://example.com/0.5.1.zip"
                }
            }
        });

        let selected = select_best_update_result(current_version, vec![older]);

        assert!(selected.is_none());
    }
}
