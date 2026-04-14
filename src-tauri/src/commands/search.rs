use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;
use crate::error::AppResult;
use crate::search::{SearchIndex, SearchItem, SearchResult, SearchContext, parse_search_input};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQuery {
    pub keyword: String,
    pub limit: Option<usize>,
}

pub struct SearchState {
    pub index: Mutex<SearchIndex>,
    pub items: Mutex<Vec<SearchItem>>,
}

impl SearchState {
    pub fn new() -> Self {
        Self {
            index: Mutex::new(SearchIndex::new()),
            items: Mutex::new(Vec::new()),
        }
    }

    pub fn build_index(&self) {
        let items = self.items.lock().unwrap();
        let mut index = self.index.lock().unwrap();

        let search_items: Vec<SearchItem> = items.iter().map(|item| {
            let p_full = crate::pinyin::PinyinIndex::new().to_pinyin_full(&item.name);
            let p_initial = crate::pinyin::PinyinIndex::new().to_pinyin_initial(&item.name);
            SearchItem {
                id: item.id.clone(),
                name: item.name.clone(),
                path: item.path.clone(),
                category_id: item.category_id.clone(),
                usage_count: item.usage_count,
                last_used_at: item.last_used_at,
                is_pinned: item.is_pinned,
                search_tokens: vec![
                    item.name.clone(),
                    p_full,
                    p_initial,
                ],
                rank_score: 0.0,
            }
        }).collect();

        index.build_index(search_items);
    }
}

impl Default for SearchState {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
pub fn update_search_items(
    state: State<'_, SearchState>,
    items: Vec<SearchItem>,
) -> AppResult<()> {
    {
        let mut stored = state.items.lock().unwrap();
        *stored = items;
    }
    state.build_index();
    Ok(())
}

#[tauri::command]
pub fn search_apps(
    state: State<'_, SearchState>,
    query: SearchQuery,
) -> AppResult<Vec<SearchResult>> {
    let index = state.index.lock().unwrap();
    let ctx = parse_search_input(&query.keyword);
    let ctx = SearchContext {
        keyword: ctx.keyword,
        limit: query.limit.unwrap_or(20),
        now: ctx.now,
    };
    Ok(index.search(&ctx))
}
