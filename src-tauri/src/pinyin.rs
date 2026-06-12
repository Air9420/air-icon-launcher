use log::warn;
use pinyin::ToPinyin;
use std::collections::HashMap;
use std::sync::Mutex;

const PINYIN_CACHE_LIMIT: usize = 512;

fn cache_insert_bounded(cache: &mut HashMap<String, String>, key: &str, value: &str) {
    if cache.len() >= PINYIN_CACHE_LIMIT {
        // Simplification: clear all instead of LRU eviction. Acceptable because
        // pinyin computation is cheap and the cache refills naturally on demand.
        cache.clear();
    }
    cache.insert(key.to_string(), value.to_string());
}

pub struct PinyinIndex {
    full_cache: Mutex<HashMap<String, String>>,
    initial_cache: Mutex<HashMap<String, String>>,
}

impl PinyinIndex {
    pub fn new() -> Self {
        Self {
            full_cache: Mutex::new(HashMap::with_capacity(PINYIN_CACHE_LIMIT)),
            initial_cache: Mutex::new(HashMap::with_capacity(PINYIN_CACHE_LIMIT)),
        }
    }

    pub fn to_pinyin_full(&self, text: &str) -> String {
        {
            let cache = match self.full_cache.lock() {
                Ok(guard) => guard,
                Err(poisoned) => {
                    warn!("[to_pinyin_full] full_cache mutex poisoned, recovering");
                    poisoned.into_inner()
                }
            };
            if let Some(value) = cache.get(text) {
                return value.clone();
            }
        }

        let computed: String = text
            .to_pinyin()
            .flatten()
            .map(|py| py.plain())
            .collect::<Vec<_>>()
            .join("");

        let mut cache = match self.full_cache.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                warn!("[to_pinyin_full] full_cache mutex poisoned, recovering");
                poisoned.into_inner()
            }
        };
        cache_insert_bounded(&mut cache, text, &computed);

        computed
    }

    pub fn to_pinyin_initial(&self, text: &str) -> String {
        {
            let cache = match self.initial_cache.lock() {
                Ok(guard) => guard,
                Err(poisoned) => {
                    warn!("[to_pinyin_initial] initial_cache mutex poisoned, recovering");
                    poisoned.into_inner()
                }
            };
            if let Some(value) = cache.get(text) {
                return value.clone();
            }
        }

        let computed: String = text
            .to_pinyin()
            .flatten()
            .map(|py| py.first_letter())
            .collect::<Vec<_>>()
            .join("");

        let mut cache = match self.initial_cache.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                warn!("[to_pinyin_initial] initial_cache mutex poisoned, recovering");
                poisoned.into_inner()
            }
        };
        cache_insert_bounded(&mut cache, text, &computed);

        computed
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

    #[test]
    fn pinyin_cache_returns_stable_results() {
        let index = PinyinIndex::new();

        let first_full = index.to_pinyin_full("微信");
        let second_full = index.to_pinyin_full("微信");
        assert_eq!(first_full, second_full);

        let first_initial = index.to_pinyin_initial("微信");
        let second_initial = index.to_pinyin_initial("微信");
        assert_eq!(first_initial, second_initial);
    }
}
