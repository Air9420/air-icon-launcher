use crate::error::AppResult;
use crate::search::{parse_search_input, SearchContext, SearchIndex, SearchItem, SearchResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQuery {
    pub keyword: String,
    pub limit: Option<usize>,
    #[serde(default)]
    pub category_id: Option<String>,
}

pub struct SearchState {
    pub index: Arc<Mutex<SearchIndex>>,
    pub items: Arc<Mutex<Vec<SearchItem>>>,
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
            index: Arc::new(Mutex::new(SearchIndex::new())),
            items: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl Default for SearchState {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
pub async fn update_search_items(state: State<'_, SearchState>, items: Vec<SearchItem>) -> AppResult<()> {
    {
        let mut stored = state.items.lock().unwrap();
        *stored = items;
    }

    let items_snapshot = {
        let stored = state.items.lock().unwrap();
        stored.clone()
    };

    let built_index = tokio::task::spawn_blocking(move || {
        let search_items = build_search_items_from(&items_snapshot);
        let mut index = crate::search::SearchIndex::new();
        index.build_index(search_items);
        index
    })
    .await
    .map_err(|e| crate::error::AppError::internal(format!("Index build failed: {}", e)))?;

    let mut index = state.index.lock().unwrap();
    *index = built_index;

    Ok(())
}

fn search_item_key(category_id: &str, id: &str) -> String {
    format!("{category_id}:{id}")
}

/// 增量更新搜索索引。
///
/// 增量路径同样要重建整份拼音索引（`build_index_from_items`），属于 CPU + 锁竞争，
/// 放到阻塞线程池里做，避免和 `search_apps` 抢同一把锁卡住消息泵。
#[tauri::command]
pub async fn update_search_items_incremental(
    state: State<'_, SearchState>,
    changes: SearchIndexChanges,
) -> AppResult<()> {
    let items = Arc::clone(&state.items);
    let index = Arc::clone(&state.index);

    tokio::task::spawn_blocking(move || {
        let mut stored = items.lock().unwrap();
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

        let built = build_search_items_from(&stored);
        let mut guard = index.lock().unwrap();
        guard.build_index(built);
        Ok(())
    })
    .await
    .map_err(|e| crate::error::AppError::internal(format!("Index update failed: {}", e)))?
}

/// 把原始条目转换成带拼音 token 的索引项。
///
/// `update_search_items` 与增量更新共用，避免两处逻辑漂移。
fn build_search_items_from(items: &[SearchItem]) -> Vec<SearchItem> {
    let pinyin_index = crate::pinyin::PinyinIndex::new();
    items
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
        .collect()
}

/// 搜索。
///
/// 查询本身很快，但它与索引重建共享同一把锁；放到阻塞线程池后
/// 不会和主线程上的其它 IPC 互相排队。
#[tauri::command]
pub async fn search_apps(
    state: State<'_, SearchState>,
    query: SearchQuery,
) -> AppResult<Vec<SearchResult>> {
    let index = Arc::clone(&state.index);
    tokio::task::spawn_blocking(move || {
        let guard = index.lock().unwrap();
        let ctx = parse_search_input(&query.keyword);
        let ctx = SearchContext {
            keyword: ctx.keyword,
            limit: query.limit.unwrap_or(20),
            now: ctx.now,
            category_id: query.category_id,
        };
        Ok(guard.search(&ctx))
    })
    .await
    .map_err(|e| crate::error::AppError::internal(format!("search_apps failed: {}", e)))?
}
