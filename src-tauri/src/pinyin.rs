use pinyin::ToPinyin;

pub struct PinyinIndex;

impl PinyinIndex {
    pub fn new() -> Self {
        Self
    }

    pub fn to_pinyin_full(&self, text: &str) -> String {
        text.to_pinyin()
            .flatten()
            .map(|py| py.plain())
            .collect::<Vec<_>>()
            .join("")
    }

    pub fn to_pinyin_initial(&self, text: &str) -> String {
        text.to_pinyin()
            .flatten()
            .map(|py| py.first_letter())
            .collect::<Vec<_>>()
            .join("")
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
        assert_eq!(index.to_pinyin_full("微信"), "weixin");
        assert_eq!(index.to_pinyin_initial("微信"), "wx");
    }

    #[test]
    fn test_pinyin_mixed_chinese_english() {
        let index = PinyinIndex::new();
        assert_eq!(index.to_pinyin_full("Chrome浏览器"), "liulanqi");
        assert_eq!(index.to_pinyin_initial("Chrome浏览器"), "llq");
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
        assert_eq!(index.to_pinyin_full("v2.0测试"), "ceshi");
        assert_eq!(index.to_pinyin_initial("v2.0测试"), "cs");
    }
}
