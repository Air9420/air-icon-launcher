use crate::config::ConfigManager;
use crate::error::{AppError, AppResult};
use reqwest::header::{ACCEPT, ACCEPT_ENCODING, CONNECTION, CONTENT_TYPE, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIOrganizerCategoryInput {
    pub key: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIOrganizerItemInput {
    pub id: String,
    pub name: String,
    pub path: String,
    pub source: String,
    pub current_category_key: String,
    pub current_reason: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize)]
struct AIOrganizerItemPromptInput {
    pub id: String,
    pub name: String,
    pub path: String,
    pub source: String,
    pub current_category_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_hint: Option<&'static str>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AIOrganizerRefineRequest {
    pub categories: Vec<AIOrganizerCategoryInput>,
    pub items: Vec<AIOrganizerItemInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIOrganizerAssignment {
    pub id: String,
    pub category_key: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIOrganizerRefineResponse {
    pub assignments: Vec<AIOrganizerAssignment>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawAIOrganizerAssignment {
    pub id: String,
    pub category_key: String,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawAIOrganizerRefineResponse {
    pub assignments: Vec<RawAIOrganizerAssignment>,
}

#[tauri::command]
pub async fn refine_installed_apps_with_ai(
    manager: tauri::State<'_, ConfigManager>,
    request: AIOrganizerRefineRequest,
) -> AppResult<AIOrganizerRefineResponse> {
    if request.items.is_empty() {
        return Ok(AIOrganizerRefineResponse {
            assignments: Vec::new(),
        });
    }

    let config = manager.load_config();
    let base_url = config.ai_organizer_base_url.trim().trim_end_matches('/');
    let model = config.ai_organizer_model.trim();
    let api_key = config.ai_organizer_api_key.trim();

    if base_url.is_empty() || model.is_empty() || api_key.is_empty() {
        return Err(AppError::invalid_input(
            "请先配置 AI 接口地址、模型和 API Key",
        ));
    }

    let category_keys: HashSet<&str> = request.categories.iter().map(|category| category.key.as_str()).collect();
    let item_ids: HashSet<&str> = request.items.iter().map(|item| item.id.as_str()).collect();

    let endpoint = build_chat_completions_endpoint(base_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|error| AppError::internal(format!("无法创建 AI 请求客户端: {error}")))?;

    let system_prompt = concat!(
        "你是 Windows 软件启动项分类助手。",
        "你会根据软件名称、路径、来源和当前规则分类结果，",
        "把项目分配到给定分类 key 中最合适的一类。",
        "当前分类只是参考，你可以改判到更合适的分类。",
        "不要发明新的分类 key。",
        "除非确实完全无法判断，否则不要轻易使用 other。",
        "如果应用名本身是知名软件，请直接使用你的常识知识判断，不要回答信息不足。",
        "必须为每个项目选择一个最接近的现有分类。",
        "返回 JSON 对象，格式为 {\"assignments\":[{\"id\":string,\"category_key\":string,\"reason\":string}]}。",
        "reason 用中文短句，8到18个字，避免空字符串。",
        "【重要分类边界】：语音开黑、语音沟通类工具（KOOK、Oopz、TeamSpeak、Mumble、YY 等）应归入 office，而非 gaming。只有明确的游戏启动器、游戏平台、游戏辅助工具才归入 gaming。"
    );

    let prompt_items: Vec<AIOrganizerItemPromptInput> = request
        .items
        .iter()
        .map(|item| AIOrganizerItemPromptInput {
            id: item.id.clone(),
            name: item.name.clone(),
            path: shorten_path_for_prompt(&item.path),
            source: item.source.clone(),
            current_category_key: item.current_category_key.clone(),
            app_hint: lookup_app_hint(&item.name),
        })
        .collect();

    let user_payload = json!({
        "categories": request.categories,
        "items": prompt_items,
        "rules": [
            "category_key 必须严格来自 categories.key",
            "每个 item 都返回一条 assignment",
            "对所有 item 都重新判断，不要被 current_category_key 束缚",
            "优先依据应用名称和 app_hint，其次参考路径和来源",
            "微信开发者工具、数据库工具、终端、编程语言、IDE 应优先归到 development",
            "会议、聊天、文档工具归到 office",
            "播放器、音频处理归到 media",
            "游戏平台、加速器、游戏入口归到 gaming",
            "下载器、BT、磁力、文件传输工具优先归到 cloud",
            "系统通知、toast、托盘辅助工具优先归到 system 或 development",
            "只输出 JSON，不要输出 markdown 代码块，不要额外解释"
        ]
    });

    let request_body = json!({
        "model": model,
        "temperature": 0.0,
        "stream": false,
        "max_tokens": 1600,
        "response_format": { "type": "json_object" },
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_payload.to_string() }
        ]
    });

    let (status, response_text) =
        send_ai_request_with_retry(&client, &endpoint, api_key, &request_body).await?;

    if !status.is_success() {
        let message = summarize_error_response(&response_text);
        return Err(AppError::new(
            "AI_REQUEST_ERROR",
            format!("AI 服务返回错误 {}: {message}", status.as_u16()),
        ));
    }

    let raw_json: Value = serde_json::from_str(&response_text).map_err(|error| {
        AppError::new(
            "AI_RESPONSE_ERROR",
            format!(
                "AI 响应不是有效 JSON: {error}。接口返回内容片段：{}",
                summarize_non_json_response(&response_text)
            ),
        )
    })?;

    let content = extract_message_content(&raw_json).ok_or_else(|| {
        AppError::new(
            "AI_RESPONSE_ERROR",
            "AI 响应中缺少 choices[0].message.content",
        )
    })?;

    let parsed: RawAIOrganizerRefineResponse = serde_json::from_str(&strip_code_fences(&content))
        .map_err(|error| {
            AppError::new(
                "AI_RESPONSE_ERROR",
                format!("AI 返回内容无法解析为分类结果: {error}"),
            )
        })?;

    let assignments = parsed
        .assignments
        .into_iter()
        .filter(|assignment| item_ids.contains(assignment.id.as_str()))
        .map(|assignment| {
            let category_key = if category_keys.contains(assignment.category_key.as_str()) {
                assignment.category_key
            } else {
                "other".to_string()
            };

            AIOrganizerAssignment {
                id: assignment.id,
                category_key,
                reason: if assignment
                    .reason
                    .as_deref()
                    .unwrap_or_default()
                    .trim()
                    .is_empty()
                {
                    "AI 未提供原因".to_string()
                } else {
                    assignment.reason.unwrap_or_default().trim().to_string()
                },
            }
        })
        .collect();

    Ok(AIOrganizerRefineResponse { assignments })
}

fn extract_message_content(response: &Value) -> Option<String> {
    let content = response
        .get("choices")?
        .as_array()?
        .first()?
        .get("message")?
        .get("content")?;

    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }

    let parts = content.as_array()?;
    let text = parts
        .iter()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n");

    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

fn strip_code_fences(content: &str) -> String {
    let trimmed = content.trim();
    if !trimmed.starts_with("```") {
        return trimmed.to_string();
    }

    trimmed
        .trim_start_matches("```")
        .trim_start_matches("json")
        .trim()
        .trim_end_matches("```")
        .trim()
        .to_string()
}

fn summarize_error_response(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return "空响应".to_string();
    }

    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        if let Some(message) = value
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
        {
            return message.to_string();
        }
    }

    trimmed.chars().take(200).collect()
}

fn build_chat_completions_endpoint(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        return trimmed.to_string();
    }
    format!("{trimmed}/chat/completions")
}

fn summarize_non_json_response(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return "空响应".to_string();
    }

    if trimmed.starts_with('<') {
        return "返回了 HTML，而不是 JSON。通常是 Base URL 填错了，或接口地址被重复拼接。".to_string();
    }

    let snippet: String = trimmed.chars().take(160).collect();
    if trimmed.len() > snippet.len() {
        format!("{snippet}...")
    } else {
        snippet
    }
}

fn shorten_path_for_prompt(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let parts: Vec<&str> = normalized.split('/').filter(|part| !part.is_empty()).collect();
    if parts.len() <= 4 {
        return normalized;
    }
    format!(
        ".../{}/{}/{}",
        parts[parts.len() - 3],
        parts[parts.len() - 2],
        parts[parts.len() - 1]
    )
}

fn lookup_app_hint(name: &str) -> Option<&'static str> {
    let normalized = normalize_name_for_hint(name);
    let hints = [
        ("oopz", "Oopz 是多人语音沟通和游戏开黑工具，应归入办公沟通/即时通讯类别"),
        ("trae", "Trae 是 AI IDE / 编程开发工具，偏 development"),
        ("trae cn", "Trae CN 是 AI IDE / 编程开发工具，偏 development"),
        ("snoretoast", "SnoreToast 是 Windows Toast 通知命令行工具，偏 development 或 system"),
        ("qbittorrent", "qBittorrent 是 BT 下载和文件传输工具，偏 cloud"),
    ];

    hints
        .iter()
        .find(|(keyword, _)| normalized.contains(keyword))
        .map(|(_, hint)| *hint)
}

fn normalize_name_for_hint(name: &str) -> String {
    name.to_lowercase()
        .replace(['(', ')', '（', '）', '[', ']', '【', '】', '-', '_', '.'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

async fn send_ai_request_with_retry(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    body: &Value,
) -> AppResult<(reqwest::StatusCode, String)> {
    let mut last_error = None;

    for attempt in 1..=3 {
        let response = client
            .post(endpoint)
            .bearer_auth(api_key)
            .header(ACCEPT, "application/json")
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT_ENCODING, "identity")
            .header(CONNECTION, "close")
            .header(USER_AGENT, "air-icon-launcher/ai-organizer")
            .json(body)
            .send()
            .await;

        let response = match response {
            Ok(response) => response,
            Err(error) => {
                last_error = Some(format!("AI 请求失败: {error}"));
                if attempt < 3 {
                    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                    continue;
                }
                return Err(AppError::new(
                    "AI_REQUEST_ERROR",
                    last_error.unwrap_or_else(|| "AI 请求失败".to_string()),
                ));
            }
        };

        let status = response.status();
        match response.bytes().await {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes).to_string();
                return Ok((status, text));
            }
            Err(error) => {
                last_error = Some(format!("读取 AI 响应失败: {error}"));
                if attempt < 3 {
                    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                    continue;
                }
                return Err(AppError::new(
                    "AI_RESPONSE_ERROR",
                    last_error.unwrap_or_else(|| "读取 AI 响应失败".to_string()),
                ));
            }
        }
    }

    Err(AppError::new(
        "AI_RESPONSE_ERROR",
        last_error.unwrap_or_else(|| "AI 请求失败".to_string()),
    ))
}
