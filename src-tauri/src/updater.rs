use serde::{Deserialize, Serialize};
use std::time::Duration;

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
    pub fn new(_version: &str) -> Self {
        Self {
            primary: UpdateSource {
                url: "https://github.com/Air9420/air-icon-launcher/releases/latest/download/latest.json"
                    .to_string(),
                timeout: Duration::from_secs(10),
                retries: 3,
            },
            fallback: UpdateSource {
                url: "https://gitee.com/api/v5/repos/air9420/air-icon-launcher/releases/latest"
                    .to_string(),
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
        self.primary_status.last_check = Some(chrono::Utc::now());
        match self.try_source(&self.config.primary).await {
            Ok(result) => {
                self.primary_status.success = true;
                self.primary_status.error_message = None;
                log::info!("主更新源(GitHub)检查成功");
                return Ok(result);
            }
            Err(e) => {
                self.primary_status.success = false;
                self.primary_status.error_message = Some(e.clone());
                log::warn!("主更新源检查失败: {}", e);
            }
        }

        self.fallback_status.last_check = Some(chrono::Utc::now());
        let fallback_url = match self.try_source(&self.config.fallback).await {
            Ok(api_result) => {
                let tag = api_result.get("tag_name").and_then(|v| v.as_str()).unwrap_or("");
                if tag.is_empty() {
                    return Err("无法获取最新版本标签".to_string());
                }
                format!("https://gitee.com/Air9420/air-icon-launcher/releases/download/{}/latest.json", tag)
            }
            Err(e) => {
                self.fallback_status.success = false;
                self.fallback_status.error_message = Some(e.clone());
                log::warn!("从更新源获取最新版本信息失败: {}", e);
                return Err(e);
            }
        };

        match self.try_source(&UpdateSource {
            url: fallback_url,
            timeout: self.config.fallback.timeout,
            retries: self.config.fallback.retries,
        }).await {
            Ok(result) => {
                self.fallback_status.success = true;
                self.fallback_status.error_message = None;
                log::info!("从更新源(Gitee)检查成功");
                Ok(result)
            }
            Err(e) => {
                self.fallback_status.success = false;
                self.fallback_status.error_message = Some(e.clone());
                log::warn!("从更新源下载更新信息失败: {}", e);
                Err(e)
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
            
            match client.get(&source.url).send().await {
                Ok(response) => {
                    let status = response.status();
                    if status.is_success() {
                        log::info!("[更新源] 请求成功: {} -> {}", source.url, status);
                        return response
                            .json()
                            .await
                            .map_err(|e| format!("解析响应失败: {}", e));
                    } else {
                        let body = response.text().await.unwrap_or_default();
                        last_error = format!("HTTP错误: {} - URL: {}", status, source.url);
                        log::warn!("[更新源] 请求失败: {} -> {} - 响应: {}", source.url, status, body);
                    }
                }
                Err(e) => {
                    last_error = format!("请求失败: {} - URL: {}", e, source.url);
                    log::warn!("[更新源] 请求异常: {} -> {}", source.url, e);
                }
            }

            if attempt < source.retries {
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }

        Err(last_error)
    }

    pub fn get_status(&self) -> (UpdateSourceStatus, UpdateSourceStatus) {
        (self.primary_status.clone(), self.fallback_status.clone())
    }
}
