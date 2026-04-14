use std::collections::HashMap;

#[allow(dead_code)]
pub struct PinyinIndex {
    dict: HashMap<char, String>,
}

impl PinyinIndex {
    pub fn new() -> Self {
        let dict = HashMap::new();
        Self { dict }
    }

    pub fn to_pinyin_full(&self, text: &str) -> String {
        let args = pinyin::Args::new();
        let all_pinyin: Vec<String> = pinyin::pinyin(text, &args)
            .iter()
            .flatten()
            .map(|py| py.to_string())
            .collect();
        all_pinyin.join("")
    }

    pub fn to_pinyin_initial(&self, text: &str) -> String {
        let args = pinyin::Args::new();
        let all_pinyin: Vec<String> = pinyin::pinyin(text, &args)
            .iter()
            .flatten()
            .map(|py| {
                py.chars()
                    .next()
                    .map(|c| c.to_string())
                    .unwrap_or_default()
            })
            .collect();
        all_pinyin.join("")
    }
}

impl Default for PinyinIndex {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pinyin_conversion() {
        let index = PinyinIndex::new();
        let full = index.to_pinyin_full("微信");
        let initial = index.to_pinyin_initial("微信");
        assert!(!full.is_empty());
        assert!(!initial.is_empty());
    }

    #[test]
    fn test_pinyin_mixed_chinese_english() {
        let index = PinyinIndex::new();
        let full = index.to_pinyin_full("Chrome浏览器");
        let initial = index.to_pinyin_initial("Chrome浏览器");
        assert!(!full.is_empty());
        assert!(!initial.is_empty());
    }

    #[test]
    fn test_pinyin_empty_string() {
        let index = PinyinIndex::new();
        assert_eq!(index.to_pinyin_full(""), "");
        assert_eq!(index.to_pinyin_initial(""), "");
    }

    #[test]
    fn test_pinyin_english_only_returns_empty() {
        let index = PinyinIndex::new();
        assert_eq!(index.to_pinyin_full("Hello World"), "");
        assert_eq!(index.to_pinyin_initial("Hello World"), "");
    }

    #[test]
    fn test_pinyin_numbers_and_symbols() {
        let index = PinyinIndex::new();
        let full = index.to_pinyin_full("v2.0测试");
        let initial = index.to_pinyin_initial("v2.0测试");
        assert!(!full.is_empty());
        assert!(!initial.is_empty());
    }
}
