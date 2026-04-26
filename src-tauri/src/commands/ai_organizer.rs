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
    #[serde(default)]
    pub publisher: Option<String>,
    #[serde(default, rename = "exe_name")]
    pub exe_name: Option<String>,
    pub current_category_key: String,
    pub current_reason: String,
    #[serde(default)]
    pub current_confidence: Option<f64>,
    #[serde(default, rename = "rule_matched_layers")]
    pub rule_matched_layers: Option<Vec<String>>,
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
    pub publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exe_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_confidence: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule_matched_layers: Option<Vec<String>>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_description: Option<String>,
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
    #[serde(default)]
    pub category_name: Option<String>,
    #[serde(default)]
    pub category_description: Option<String>,
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
    let api_key_owned = manager.get_ai_organizer_api_key();
    let api_key = api_key_owned.trim();

    if base_url.is_empty() || model.is_empty() || api_key.is_empty() {
        return Err(AppError::invalid_input(
            "请先配置 AI 接口地址、模型和 API Key",
        ));
    }

    let category_keys: HashSet<String> = request
        .categories
        .iter()
        .map(|category| normalize_category_key(&category.key))
        .filter(|key| !key.is_empty())
        .collect();
    let item_ids: HashSet<&str> = request.items.iter().map(|item| item.id.as_str()).collect();

    let endpoint = build_chat_completions_endpoint(base_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|error| AppError::internal(format!("无法创建 AI 请求客户端: {error}")))?;

    let system_prompt = concat!(
        "你是 Windows 软件启动项分类助手。",
        "你会根据软件名称、路径、来源和当前规则分类结果，",
        "把项目分配到最合适的一类。",
        "当前分类只是参考，你可以改判到更合适的分类。",
        "优先使用已有分类 key；当现有分类明显不合适时可以创建新分类。",
        "创建新分类时，必须同时返回 category_name 和 category_description。",
        "必须原样返回输入的 id，禁止改写、截断、重排或替换。",
        "除非确实完全无法判断，否则不要轻易使用 other。",
        "如果应用名本身是知名软件，请直接使用你的常识知识判断，不要回答信息不足。",
        "必须为每个项目返回一个 assignment。",
        "返回 JSON 对象，格式为 {\"assignments\":[{\"id\":string,\"category_key\":string,\"reason\":string,\"category_name\"?:string,\"category_description\"?:string}]}。",
        "reason 用中文短句，8到18个字，避免空字符串。",
        "【重要分类边界】：语音开黑、语音沟通类工具（KOOK、Oopz、TeamSpeak、Mumble、YY 等）应归入 office，而非 gaming。",
        "【重要分类边界】：游戏加速器、网络优化器、帧率增强工具应归入 game_booster，不要归入 gaming。",
        "【重要分类边界】：SDK、运行库、redistributable、后台组件、无 GUI 工具应归入 component。"
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
            publisher: item.publisher.clone(),
            exe_name: item.exe_name.clone(),
            current_confidence: item.current_confidence,
            rule_matched_layers: item.rule_matched_layers.clone(),
            app_hint: lookup_app_hint(&item.name),
        })
        .collect();

    let user_payload = json!({
        "categories": request.categories,
        "items": prompt_items,
        "rules": [
            "id 必须和输入完全一致，绝对不能改写",
            "每个 item 都返回一条 assignment",
            "优先使用 categories 里的 key",
            "仅当 categories 都不合适时才创建新 key，且要同时返回 category_name 和 category_description",
            "新 key 尽量使用 snake_case（小写字母、数字、下划线）",
            "对所有 item 都重新判断，不要被 current_category_key 束缚",
            "优先依据应用名称和 app_hint，其次参考路径和来源",
            "微信开发者工具、数据库工具、终端、编程语言、IDE 应优先归到 development",
            "会议、聊天、文档工具归到 office",
            "播放器、音频处理归到 media",
            "游戏平台、游戏启动入口归到 gaming",
            "游戏加速器、帧率/网络优化工具归到 game_booster",
            "SDK、runtime、redistributable、后台组件优先归到 component",
            "下载器、BT、磁力、文件传输工具优先归到 cloud",
            "系统通知、toast、托盘辅助工具优先归到 system 或 development",
            "除非确实无法判断，否则不要使用 other",
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
            let normalized_key = normalize_category_key(&assignment.category_key);
            let normalized_name = sanitize_optional_text(assignment.category_name);
            let normalized_description = sanitize_optional_text(assignment.category_description);

            let (category_key, category_name, category_description) =
                if !normalized_key.is_empty() && category_keys.contains(&normalized_key) {
                    (normalized_key, None, None)
                } else if is_valid_custom_category_key(&normalized_key) {
                    if let Some(name) = normalized_name {
                        (normalized_key, Some(name), normalized_description)
                    } else {
                        ("other".to_string(), None, None)
                    }
                } else {
                    ("other".to_string(), None, None)
                };

            let reason = if assignment.reason.as_deref().unwrap_or_default().trim().is_empty() {
                "AI 未提供原因".to_string()
            } else {
                assignment.reason.unwrap_or_default().trim().to_string()
            };

            AIOrganizerAssignment {
                id: assignment.id,
                category_key,
                reason,
                category_name,
                category_description,
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
        return "返回了 HTML，而不是 JSON。通常是 Base URL 填错了，或接口地址被重复拼接。"
            .to_string();
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
    let parts: Vec<&str> = normalized
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
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
        (
            "oopz",
            "Oopz 是多人语音沟通和游戏开黑工具，应归入办公沟通/即时通讯类别",
        ),
        ("trae", "Trae 是 AI IDE / 编程开发工具，偏 development"),
        (
            "trae cn",
            "Trae CN 是 AI IDE / 编程开发工具，偏 development",
        ),
        (
            "snoretoast",
            "SnoreToast 是 Windows Toast 通知命令行工具，偏 development 或 system",
        ),
        (
            "qbittorrent",
            "qBittorrent 是 BT 下载和文件传输工具，偏 cloud",
        ),
    ];

    hints
        .iter()
        .find(|(keyword, _)| normalized.contains(keyword))
        .map(|(_, hint)| *hint)
}

fn normalize_name_for_hint(name: &str) -> String {
    name.to_lowercase()
        .replace(
            ['(', ')', '（', '）', '[', ']', '【', '】', '-', '_', '.'],
            " ",
        )
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn sanitize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn normalize_category_key(raw: &str) -> String {
    let mut normalized = String::with_capacity(raw.len());
    let mut prev_underscore = false;

    for ch in raw.trim().chars() {
        let mapped = if ch.is_whitespace() || ch == '-' {
            '_'
        } else {
            ch.to_ascii_lowercase()
        };

        if mapped == '_' {
            if prev_underscore {
                continue;
            }
            prev_underscore = true;
        } else {
            prev_underscore = false;
        }

        normalized.push(mapped);
    }

    normalized.trim_matches('_').to_string()
}

fn is_valid_custom_category_key(key: &str) -> bool {
    if key.is_empty() || key.len() > 40 {
        return false;
    }

    key.chars().all(|ch| {
        ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_' || is_cjk_char(ch)
    })
}

fn is_cjk_char(ch: char) -> bool {
    let code = ch as u32;
    (0x3400..=0x9fff).contains(&code)
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
