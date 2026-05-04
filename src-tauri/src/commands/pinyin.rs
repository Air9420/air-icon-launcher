use serde::{Deserialize, Serialize};

use crate::pinyin::PinyinIndex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinyinResult {
    pub full: String,
    pub initial: String,
}

#[tauri::command]
pub fn to_pinyin(text: &str) -> Option<PinyinResult> {
    if text.is_empty() {
        return None;
    }

    let pinyin_index = PinyinIndex::new();
    let full = pinyin_index.to_pinyin_full(text);
    let initial = pinyin_index.to_pinyin_initial(text);

    Some(PinyinResult { full, initial })
}

#[tauri::command]
pub fn to_pinyin_initial(text: &str) -> Option<String> {
    if text.is_empty() {
        return None;
    }

    Some(PinyinIndex::new().to_pinyin_initial(text))
}
