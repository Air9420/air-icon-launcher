use crate::error::AppResult;
use crate::search::{parse_search_input, SearchContext, SearchIndex, SearchItem, SearchResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQuery {
    pub keyword: String,
    pub limit: Option<usize>,
    #[serde(default)]
    pub category_id: Option<String>,
}

pub struct SearchState {
    pub index: Mutex<SearchIndex>,
    pub items: Mutex<Vec<SearchItem>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchItemIdentity {
    pub id: String,
    pub category_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SearchIndexChanges {
    #[serde(default)]
    pub added: Vec<SearchItem>,
    #[serde(default)]
    pub updated: Vec<SearchItem>,
    #[serde(default)]
    pub deleted: Vec<SearchItemIdentity>,
}

impl SearchState {
    pub fn new() -> Self {
        Self {
            index: Mutex::new(SearchIndex::new()),
            items: Mutex::new(Vec::new()),
        }
    }

    fn build_index_from_items(&self, items: &[SearchItem]) {
        let mut index = self.index.lock().unwrap();
        let pinyin_index = crate::pinyin::PinyinIndex::new();

        let search_items: Vec<SearchItem> = items
            .iter()
            .map(|item| {
                let p_full = pinyin_index.to_pinyin_full(&item.name);
                let p_initial = pinyin_index.to_pinyin_initial(&item.name);
                SearchItem {
                    id: item.id.clone(),
                    name: item.name.clone(),
                    path: item.path.clone(),
                    category_id: item.category_id.clone(),
                    usage_count: item.usage_count,
                    last_used_at: item.last_used_at,
                    is_pinned: item.is_pinned,
                    search_tokens: vec![item.name.clone(), p_full, p_initial],
                    rank_score: 0.0,
                }
            })
            .collect();

        index.build_index(search_items);
    }

    pub fn build_index(&self) {
        let items = self.items.lock().unwrap();
        self.build_index_from_items(&items);
    }
}

impl Default for SearchState {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
pub fn update_search_items(state: State<'_, SearchState>, items: Vec<SearchItem>) -> AppResult<()> {
    {
        let mut stored = state.items.lock().unwrap();
        *stored = items;
    }
    state.build_index();
    Ok(())
}

fn search_item_key(category_id: &str, id: &str) -> String {
    format!("{category_id}:{id}")
}

#[tauri::command]
pub fn update_search_items_incremental(
    state: State<'_, SearchState>,
    changes: SearchIndexChanges,
) -> AppResult<()> {
    let mut stored = state.items.lock().unwrap();
    let mut key_to_index = HashMap::with_capacity(stored.len());

    for (index, item) in stored.iter().enumerate() {
        key_to_index.insert(search_item_key(&item.category_id, &item.id), index);
    }

    for deleted in changes.deleted {
        let key = search_item_key(&deleted.category_id, &deleted.id);
        if let Some(index) = key_to_index.remove(&key) {
            stored.swap_remove(index);
            if index < stored.len() {
                let moved = &stored[index];
                key_to_index.insert(search_item_key(&moved.category_id, &moved.id), index);
            }
        }
    }

    let mut upsert = |item: SearchItem| {
        let key = search_item_key(&item.category_id, &item.id);
        if let Some(index) = key_to_index.get(&key).copied() {
            stored[index] = item;
            return;
        }
        let index = stored.len();
        stored.push(item);
        key_to_index.insert(key, index);
    };

    for item in changes.updated {
        upsert(item);
    }

    for item in changes.added {
        upsert(item);
    }

    state.build_index_from_items(&stored);
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
        category_id: query.category_id,
    };
    Ok(index.search(&ctx))
}
