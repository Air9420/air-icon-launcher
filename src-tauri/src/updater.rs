use serde::{Deserialize, Serialize};
use serde_json::Value;
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

#[derive(Debug, Clone)]
pub struct ResolvedUpdate {
    pub payload: Value,
    pub source: String,
    pub latest_json_url: String,
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

    pub async fn check_update(&mut self) -> Result<ResolvedUpdate, String> {
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

    async fn try_source(&self, source: &UpdateSource) -> Result<ResolvedUpdate, String> {
        let client = reqwest::Client::builder()
            .timeout(source.timeout)
            .build()
            .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

        let mut last_error = String::new();
        let source_name = if source.url == GITEE_LATEST_RELEASE_API_URL {
            "gitee"
        } else {
            "github"
        };

        for attempt in 1..=source.retries {
            log::info!("[更新源] 尝试请求: {} (第{}次)", source.url, attempt);
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
                    log::warn!("[更新源] 请求失败: {} -> {}", source.url, error);
                }
            }

            if attempt < source.retries {
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }

        Err(last_error)
    }

    async fn try_gitee_latest_json(&self, client: &reqwest::Client) -> Result<(Value, String), String> {
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
    let url = platform.get("url").and_then(|value| value.as_str()).unwrap_or_default();
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
            "platforms": {
                "windows-x86_64": {
                    "url": "https://example.com/0.5.9.zip"
                }
            }
        });

        assert!(validate_latest_json(&payload).is_err());
    }

    #[test]
    fn validate_latest_json_rejects_missing_url() {
        let payload = serde_json::json!({
            "version": "0.5.9",
            "platforms": {
                "windows-x86_64": {
                    "signature": "sig"
                }
            }
        });

        assert!(validate_latest_json(&payload).is_err());
    }
}
