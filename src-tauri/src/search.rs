use crate::pinyin::PinyinIndex;
use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub category_id: String,
    pub usage_count: u32,
    pub last_used_at: i64,
    pub is_pinned: bool,
    pub search_tokens: Vec<String>,
    pub rank_score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub name: String,
    pub path: String,
    pub category_id: String,
    pub fuzzy_score: i64,
    pub matched_pinyin_initial: bool,
    pub matched_pinyin_full: bool,
    pub rank_score: f32,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum MatchLevel {
    Fuzzy = 0,
    PinyinInitial = 1,
    PinyinExact = 2,
    Substring = 3,
    Prefix = 4,
    Exact = 5,
}

#[derive(Debug, Clone)]
struct ScoredCandidate {
    item: SearchItem,
    match_level: MatchLevel,
    fuzzy_score: i64,
    matched_pinyin_initial: bool,
    matched_pinyin_full: bool,
}

#[derive(Debug, Clone)]
pub struct SearchContext {
    pub keyword: String,
    pub limit: usize,
    pub now: i64,
}

pub struct SearchIndex {
    items: Vec<SearchItem>,
    matcher: SkimMatcherV2,
    pinyin_index: PinyinIndex,
}

pub fn parse_search_input(input: &str) -> SearchContext {
    let input = input.trim();
    SearchContext {
        keyword: input.to_string(),
        limit: 20,
        now: chrono_now(),
    }
}

impl SearchIndex {
    pub fn new() -> Self {
        Self {
            items: Vec::new(),
            matcher: SkimMatcherV2::default(),
            pinyin_index: PinyinIndex::new(),
        }
    }

    pub fn build_index(&mut self, items: Vec<SearchItem>) {
        self.items = items;
    }

    pub fn search(&self, ctx: &SearchContext) -> Vec<SearchResult> {
        if ctx.keyword.is_empty() {
            return Vec::new();
        }

        let keyword_lower = ctx.keyword.to_lowercase();
        let mut candidates: Vec<ScoredCandidate> = Vec::new();

        for item in &self.items {
            let (match_level, fuzzy_score) = self.evaluate_match(item, &keyword_lower);
            let is_pinyin_initial = match_level == MatchLevel::PinyinInitial
                || self.check_pinyin_initial_match(&item.name, &keyword_lower);
            let is_pinyin_full = match_level == MatchLevel::PinyinExact
                || self.check_pinyin_full_match(&item.name, &keyword_lower);

            if fuzzy_score > 50 {
                candidates.push(ScoredCandidate {
                    item: item.clone(),
                    match_level,
                    fuzzy_score,
                    matched_pinyin_initial: is_pinyin_initial,
                    matched_pinyin_full: is_pinyin_full,
                });
            }
        }

        self.rank_results(candidates, ctx)
    }

    fn evaluate_match(&self, item: &SearchItem, keyword: &str) -> (MatchLevel, i64) {
        let name_lower = item.name.to_lowercase();
        let keyword_len = keyword.len() as i64;

        if name_lower == keyword {
            let score = 1000 + keyword_len * 100;
            return (MatchLevel::Exact, score);
        }

        if name_lower.starts_with(keyword) {
            let score = 900 + keyword_len * 100;
            return (MatchLevel::Prefix, score);
        }

        if name_lower.contains(keyword) {
            let position = name_lower.find(keyword).unwrap_or(0) as i64;
            let score = 800 + (keyword_len * 100) - position;
            return (MatchLevel::Substring, score);
        }

        if self.check_pinyin_full_match(&item.name, keyword) {
            let p_full = self.pinyin_index.to_pinyin_full(&item.name).to_lowercase();
            if p_full == keyword {
                let score = 700 + keyword_len * 50;
                return (MatchLevel::PinyinExact, score);
            }
            if p_full.starts_with(keyword) {
                let score = 600 + keyword_len * 50;
                return (MatchLevel::PinyinInitial, score);
            }
        }

        if self.check_pinyin_initial_match(&item.name, keyword) {
            let score = 500 + keyword_len * 30;
            return (MatchLevel::PinyinInitial, score);
        }

        let mut best_score = 0i64;
        if let Some(score) = self.match_field(&item.name, keyword) {
            best_score = best_score.max(score);
        }
        if let Some(score) = self.match_field(&item.path, keyword) {
            best_score = best_score.max(score);
        }
        for token in &item.search_tokens {
            if let Some(score) = self.match_field(token, keyword) {
                best_score = best_score.max(score);
            }
        }

        (MatchLevel::Fuzzy, best_score)
    }

    fn match_field(&self, field: &str, keyword: &str) -> Option<i64> {
        self.matcher.fuzzy_match(field, keyword)
    }

    fn check_pinyin_initial_match(&self, name: &str, keyword: &str) -> bool {
        let p_initial = self.pinyin_index.to_pinyin_initial(name).to_lowercase();
        p_initial.starts_with(keyword) || p_initial.contains(keyword)
    }

    fn check_pinyin_full_match(&self, name: &str, keyword: &str) -> bool {
        let p_full = self.pinyin_index.to_pinyin_full(name).to_lowercase();
        p_full.starts_with(keyword) || p_full.contains(keyword)
    }

    fn rank_results(
        &self,
        mut candidates: Vec<ScoredCandidate>,
        ctx: &SearchContext,
    ) -> Vec<SearchResult> {
        if candidates.is_empty() {
            return Vec::new();
        }

        let max_usage = self
            .items
            .iter()
            .map(|i| i.usage_count)
            .max()
            .unwrap_or(1)
            .max(1) as f32;

        for candidate in &mut candidates {
            let mut rank_score = 0.0;

            let normalized_fuzzy = (candidate.fuzzy_score as f32 / 1000.0).min(1.0);
            rank_score += normalized_fuzzy * 0.35;

            if candidate.matched_pinyin_initial {
                rank_score += 0.08;
            }

            if candidate.matched_pinyin_full {
                rank_score += 0.12;
            }

            let usage_weight = (candidate.item.usage_count as f32 / max_usage).min(1.0);
            rank_score += usage_weight * 0.20;

            let recency_score = calculate_recency_score(candidate.item.last_used_at, ctx.now);
            rank_score += recency_score * 0.15;

            if candidate.item.is_pinned {
                rank_score += 0.10;
            }

            let path_depth_score = calculate_path_depth_score(&candidate.item.path);
            rank_score += path_depth_score * 0.05;

            let level_bonus = match candidate.match_level {
                MatchLevel::Exact => 0.10,
                MatchLevel::Prefix => 0.08,
                MatchLevel::Substring => 0.06,
                MatchLevel::PinyinExact => 0.04,
                MatchLevel::PinyinInitial => 0.02,
                MatchLevel::Fuzzy => 0.0,
            };
            rank_score += level_bonus;

            candidate.item.rank_score = rank_score;
        }

        candidates.sort_by(|a, b| {
            let level_cmp = b.match_level.cmp(&a.match_level);
            if level_cmp != Ordering::Equal {
                return level_cmp;
            }
            b.item
                .rank_score
                .partial_cmp(&a.item.rank_score)
                .unwrap_or(Ordering::Equal)
        });

        candidates.truncate(ctx.limit);

        candidates
            .into_iter()
            .map(|c| SearchResult {
                id: c.item.id,
                name: c.item.name,
                path: c.item.path,
                category_id: c.item.category_id,
                fuzzy_score: c.fuzzy_score,
                matched_pinyin_initial: c.matched_pinyin_initial,
                matched_pinyin_full: c.matched_pinyin_full,
                rank_score: c.item.rank_score,
            })
            .collect()
    }
}

impl Default for SearchIndex {
    fn default() -> Self {
        Self::new()
    }
}

fn calculate_recency_score(last_used: i64, now: i64) -> f32 {
    if last_used == 0 {
        return 0.0;
    }
    let hours_ago = (now - last_used) as f32 / (1000.0 * 60.0 * 60.0);
    if hours_ago > 720.0 {
        return 0.0;
    }
    let days = hours_ago / 24.0;
    (-days / 7.0).exp().max(0.0)
}

fn calculate_path_depth_score(path: &str) -> f32 {
    let depth = path
        .replace('\\', "/")
        .split('/')
        .filter(|s| !s.is_empty())
        .count();
    if depth == 0 {
        return 0.0;
    }
    (1.0 / depth as f32).min(1.0)
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_item(id: &str, name: &str, path: &str, category_id: &str) -> SearchItem {
        SearchItem {
            id: id.to_string(),
            name: name.to_string(),
            path: path.to_string(),
            category_id: category_id.to_string(),
            usage_count: 0,
            last_used_at: 0,
            is_pinned: false,
            search_tokens: Vec::new(),
            rank_score: 0.0,
        }
    }

    fn build_index_with_items(items: Vec<SearchItem>) -> SearchIndex {
        let mut index = SearchIndex::new();
        index.build_index(items);
        index
    }

    #[test]
    fn test_parse_search_input_plain() {
        let ctx = parse_search_input("微信");
        assert_eq!(ctx.keyword, "微信");
    }

    #[test]
    fn test_parse_search_input_empty() {
        let ctx = parse_search_input("");
        assert_eq!(ctx.keyword, "");
    }

    #[test]
    fn test_parse_search_input_single_char() {
        let ctx = parse_search_input("a");
        assert_eq!(ctx.keyword, "a");
    }

    #[test]
    fn test_search_exact_match() {
        let items = vec![
            make_item("1", "Chrome", "C:\\Chrome\\chrome.exe", "cat-system"),
            make_item("2", "Firefox", "C:\\Firefox\\firefox.exe", "cat-work"),
        ];
        let index = build_index_with_items(items);
        let ctx = SearchContext {
            keyword: "Chrome".to_string(),
            limit: 20,
            now: 1000000,
        };
        let results = index.search(&ctx);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "1");
        assert_eq!(results[0].fuzzy_score > 1000, true);
    }

    #[test]
    fn test_search_prefix_match() {
        let items = vec![make_item(
            "1",
            "Chrome Browser",
            "C:\\Chrome\\chrome.exe",
            "cat-system",
        )];
        let index = build_index_with_items(items);
        let ctx = SearchContext {
            keyword: "Chro".to_string(),
            limit: 20,
            now: 1000000,
        };
        let results = index.search(&ctx);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_search_substring_match() {
        let items = vec![make_item(
            "1",
            "Google Chrome Browser",
            "C:\\Chrome\\chrome.exe",
            "cat-system",
        )];
        let index = build_index_with_items(items);
        let ctx = SearchContext {
            keyword: "rome".to_string(),
            limit: 20,
            now: 1000000,
        };
        let results = index.search(&ctx);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_search_empty_keyword_returns_nothing() {
        let items = vec![make_item("1", "Chrome", "C:\\chrome.exe", "cat-system")];
        let index = build_index_with_items(items);
        let ctx = SearchContext {
            keyword: "".to_string(),
            limit: 20,
            now: 1000000,
        };
        let results = index.search(&ctx);
        assert!(results.is_empty());
    }

    #[test]
    fn test_search_no_match_returns_empty() {
        let items = vec![make_item("1", "Chrome", "C:\\chrome.exe", "cat-system")];
        let index = build_index_with_items(items);
        let ctx = SearchContext {
            keyword: "zzzzzzzzz".to_string(),
            limit: 20,
            now: 1000000,
        };
        let results = index.search(&ctx);
        assert!(results.is_empty());
    }

    #[test]
    fn test_search_case_insensitive() {
        let items = vec![make_item("1", "Chrome", "C:\\chrome.exe", "cat-system")];
        let index = build_index_with_items(items);
        let ctx = SearchContext {
            keyword: "chrome".to_string(),
            limit: 20,
            now: 1000000,
        };
        let results = index.search(&ctx);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_search_pinyin_full_match() {
        let items = vec![make_item(
            "1",
            "微信",
            "C:\\WeChat\\WeChat.exe",
            "cat-system",
        )];
        let index = build_index_with_items(items);
        let ctx = SearchContext {
            keyword: "weixin".to_string(),
            limit: 20,
            now: 1000000,
        };
        let results = index.search(&ctx);
        assert!(!results.is_empty());
        assert!(results[0].matched_pinyin_full);
    }

    #[test]
    fn test_search_pinyin_initial_match() {
        let items = vec![make_item(
            "1",
            "微信",
            "C:\\WeChat\\WeChat.exe",
            "cat-system",
        )];
        let index = build_index_with_items(items);
        let ctx = SearchContext {
            keyword: "wx".to_string(),
            limit: 20,
            now: 1000000,
        };
        let results = index.search(&ctx);
        assert!(!results.is_empty());
        assert!(results[0].matched_pinyin_initial);
    }

    #[test]
    fn test_search_fuzzy_match_on_path() {
        let items = vec![make_item(
            "1",
            "MyApp",
            "C:\\Program Files\\MyApp\\app.exe",
            "cat-system",
        )];
        let index = build_index_with_items(items);
        let ctx = SearchContext {
            keyword: "program".to_string(),
            limit: 20,
            now: 1000000,
        };
        let results = index.search(&ctx);
        assert!(!results.is_empty());
    }

    #[test]
    fn test_search_limit_truncates_results() {
        let items: Vec<SearchItem> = (0..30)
            .map(|i| {
                make_item(
                    &format!("{}", i),
                    &format!("App{}", i),
                    &format!("C:\\app{}.exe", i),
                    "cat-system",
                )
            })
            .collect();
        let index = build_index_with_items(items);
        let ctx = SearchContext {
            keyword: "App".to_string(),
            limit: 5,
            now: 1000000,
        };
        let results = index.search(&ctx);
        assert!(results.len() <= 5);
    }

    #[test]
    fn test_search_ranking_exact_before_prefix() {
        let items = vec![
            make_item("1", "App", "C:\\app.exe", "cat-system"),
            make_item("2", "Apple Pie", "C:\\apple.exe", "cat-system"),
        ];
        let index = build_index_with_items(items);
        let ctx = SearchContext {
            keyword: "App".to_string(),
            limit: 20,
            now: 1000000,
        };
        let results = index.search(&ctx);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].id, "1");
    }

    #[test]
    fn test_search_pinned_item_bonus() {
        let mut item1 = make_item("1", "TestApp", "C:\\test.exe", "cat-system");
        item1.is_pinned = true;
        let mut item2 = make_item("2", "TestApp2", "C:\\test2.exe", "cat-system");
        item2.is_pinned = false;
        let index = build_index_with_items(vec![item1, item2]);
        let ctx = SearchContext {
            keyword: "Test".to_string(),
            limit: 20,
            now: 1000000,
        };
        let results = index.search(&ctx);
        assert_eq!(results[0].id, "1");
    }

    #[test]
    fn test_search_usage_count_affects_ranking() {
        let mut item1 = make_item("1", "ToolA", "C:\\a.exe", "cat-system");
        item1.usage_count = 100;
        let mut item2 = make_item("2", "ToolB", "C:\\b.exe", "cat-system");
        item2.usage_count = 1;
        let index = build_index_with_items(vec![item1, item2]);
        let ctx = SearchContext {
            keyword: "Tool".to_string(),
            limit: 20,
            now: 1000000,
        };
        let results = index.search(&ctx);
        assert_eq!(results[0].id, "1");
    }

    fn generate_items(count: usize) -> Vec<SearchItem> {
        let app_names = vec![
            "Chrome",
            "Firefox",
            "VSCode",
            "Slack",
            "Discord",
            "Telegram",
            "WeChat",
            "QQ",
            "DingTalk",
            "Feishu",
            "Notion",
            "Obsidian",
            "Figma",
            "Photoshop",
            "Premiere",
            "Blender",
            "VLC",
            "Spotify",
            "Steam",
            "Epic Games",
            "Unity",
            "Godot",
            "GitKraken",
            "Postman",
            "Insomnia",
            "Wireshark",
            "VMware",
            "VirtualBox",
            "Docker Desktop",
            "Windows Terminal",
            "PowerShell",
            "Node.js",
            "Python",
            "Rust",
            "Go",
            "Java",
            "IntelliJ",
            "WebStorm",
            "PyCharm",
            "CLion",
            "Rider",
            "DataGrip",
            "RubyMine",
            "AppCode",
            "Fleet",
            "微信",
            "支付宝",
            "钉钉",
            "飞书",
            "网易云音乐",
            "QQ音乐",
            "哔哩哔哩",
            "百度网盘",
            "WPS Office",
            "Foxmail",
            "Snipaste",
            "Everything",
            "Listary",
            "AutoHotkey",
            "PowerToys",
            "ShareX",
            "OBS Studio",
            "Streamlabs",
            "DaVinci Resolve",
            "Audacity",
            "GIMP",
            "Inkscape",
            "Krita",
            "Sublime Text",
            "Atom",
            "Brave Browser",
            "Edge",
            "Opera",
            "Vivaldi",
            "Tor Browser",
            "Waterfox",
            "7-Zip",
            "WinRAR",
            "PeaZip",
            "Honeyview",
            "IrfanView",
            "SumatraPDF",
            "Zotero",
            "Joplin",
            "Standard Notes",
            "Signal",
            "Thunderbird",
            "ProtonMail",
            "Bitwarden",
            "KeePassXC",
            "Authy",
            "Microsoft Teams",
            "Zoom",
            "Google Meet",
            "Skype",
            "Line",
            "WhatsApp",
            "Messenger",
            "Twitter/X",
            "Reddit",
            "LinkedIn",
        ];
        (0..count)
            .map(|i| {
                let name = app_names[i % app_names.len()];
                SearchItem {
                    id: format!("item-{}", i),
                    name: name.to_string(),
                    path: format!("C:\\Program Files\\{}\\{}.exe", name, name),
                    category_id: if i % 3 == 0 {
                        "cat-system".to_string()
                    } else if i % 3 == 1 {
                        "cat-work".to_string()
                    } else {
                        "cat-dev".to_string()
                    },
                    usage_count: (i % 50) as u32,
                    last_used_at: (i * 10000) as i64,
                    is_pinned: i % 10 == 0,
                    search_tokens: vec![name.to_lowercase()],
                    rank_score: 0.0,
                }
            })
            .collect()
    }

    #[test]
    fn bench_search_100_items_exact_match() {
        let items = generate_items(100);
        let index = build_index_with_items(items);
        let ctx = SearchContext {
            keyword: "Chrome".to_string(),
            limit: 20,
            now: chrono_now(),
        };

        let start = std::time::Instant::now();
        for _ in 0..1000 {
            std::hint::black_box(index.search(&ctx));
        }
        let elapsed = start.elapsed();
        let per_op = elapsed.as_micros() as f64 / 1000.0;
        println!(
            "[BENCH] search_100_exact: {:.2} µs/op (total {:?} for 1000 iterations)",
            per_op, elapsed
        );
        assert!(
            per_op < 5000.0,
            "search catastrophically slow: {:.2} µs",
            per_op
        );
    }

    #[test]
    fn bench_search_300_items_fuzzy_keyword() {
        let items = generate_items(300);
        let index = build_index_with_items(items);
        let ctx = SearchContext {
            keyword: "code".to_string(),
            limit: 20,
            now: chrono_now(),
        };

        let start = std::time::Instant::now();
        for _ in 0..1000 {
            std::hint::black_box(index.search(&ctx));
        }
        let elapsed = start.elapsed();
        let per_op = elapsed.as_micros() as f64 / 1000.0;
        println!(
            "[BENCH] search_300_fuzzy('code'): {:.2} µs/op (total {:?} for 1000 iterations)",
            per_op, elapsed
        );
        assert!(
            per_op < 10000.0,
            "search catastrophically slow: {:.2} µs",
            per_op
        );
    }

    #[test]
    fn bench_search_500_items_pinyin() {
        let items = generate_items(500);
        let index = build_index_with_items(items);
        let ctx = SearchContext {
            keyword: "wx".to_string(),
            limit: 20,
            now: chrono_now(),
        };

        let start = std::time::Instant::now();
        for _ in 0..500 {
            std::hint::black_box(index.search(&ctx));
        }
        let elapsed = start.elapsed();
        let per_op = elapsed.as_micros() as f64 / 500.0;
        println!(
            "[BENCH] search_500_pinyin('wx'): {:.2} µs/op (total {:?} for 500 iterations)",
            per_op, elapsed
        );
        assert!(
            per_op < 15000.0,
            "search catastrophically slow: {:.2} µs",
            per_op
        );
    }

    #[test]
    fn bench_build_index_500_items() {
        let items = generate_items(500);

        let start = std::time::Instant::now();
        for _ in 0..100 {
            let mut index = SearchIndex::new();
            index.build_index(items.clone());
            std::hint::black_box(&index);
        }
        let elapsed = start.elapsed();
        let per_op = elapsed.as_micros() as f64 / 100.0;
        println!(
            "[BENCH] build_index(500): {:.2} µs/op (total {:?} for 100 iterations)",
            per_op, elapsed
        );
    }

    #[test]
    fn bench_parse_search_input() {
        let inputs = vec!["chrome", "微信", "wx", "", "a"];

        let start = std::time::Instant::now();
        for _ in 0..10000 {
            for input in &inputs {
                std::hint::black_box(parse_search_input(input));
            }
        }
        let elapsed = start.elapsed();
        let total_ops = inputs.len() * 10000;
        let per_op = elapsed.as_nanos() as f64 / total_ops as f64;
        println!(
            "[BENCH] parse_search_input: {:.2} ns/op (total {:?} for {} ops)",
            per_op, elapsed, total_ops
        );
    }
}
