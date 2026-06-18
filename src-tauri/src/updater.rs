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

impl Default for UpdateSourceConfig {
    fn default() -> Self {
        Self {
            primary: UpdateSource {
                url: "https://github.com/Air/air-icon-launcher/releases/latest/download/latest.json"
                    .to_string(),
                timeout: Duration::from_secs(10),
                retries: 3,
            },
            fallback: UpdateSource {
                url: "https://gitee.com/Air/air-icon-launcher/releases/latest/download/latest.json"
                    .to_string(),
                timeout: Duration::from_secs(15),
                retries: 2,
            },
        }
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
        match self.try_source(&self.config.primary).await {
            Ok(update_info) => {
                self.primary_status.last_check = Some(chrono::Utc::now());
                self.primary_status.success = true;
                self.primary_status.error_message = None;
                return Ok(update_info);
            }
            Err(e) => {
                self.primary_status.last_check = Some(chrono::Utc::now());
                self.primary_status.success = false;
                self.primary_status.error_message = Some(e.clone());
                log::warn!("主更新源检查失败: {}", e);
            }
        }

        match self.try_source(&self.config.fallback).await {
            Ok(update_info) => {
                self.fallback_status.last_check = Some(chrono::Utc::now());
                self.fallback_status.success = true;
                self.fallback_status.error_message = None;
                return Ok(update_info);
            }
            Err(e) => {
                self.fallback_status.last_check = Some(chrono::Utc::now());
                self.fallback_status.success = false;
                self.fallback_status.error_message = Some(e.clone());
                log::error!("从更新源检查失败: {}", e);
                return Err(format!("所有更新源都不可用: {}", e));
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
            match client.get(&source.url).send().await {
                Ok(response) => {
                    if response.status().is_success() {
                        return response
                            .json()
                            .await
                            .map_err(|e| format!("解析响应失败: {}", e));
                    } else {
                        last_error = format!("HTTP错误: {}", response.status());
                    }
                }
                Err(e) => {
                    last_error = format!("请求失败: {}", e);
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
