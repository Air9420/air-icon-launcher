use std::collections::{HashMap, HashSet, VecDeque};
use std::time::Instant;

use super::types::ClipboardRecord;

pub struct ClipboardCache {
    pub(crate) list: VecDeque<ClipboardRecord>,
    pub(crate) hash_index: HashSet<String>,
    pub(crate) content_index: HashMap<String, String>,
    pub(crate) buffer_hashes: HashSet<String>,
}

impl ClipboardCache {
    pub fn new() -> Self {
        Self {
            list: VecDeque::new(),
            hash_index: HashSet::new(),
            content_index: HashMap::new(),
            buffer_hashes: HashSet::new(),
        }
    }

    #[allow(dead_code)]
    fn hash_exists(&self, hash: &str) -> bool {
        self.hash_index.contains(hash) || self.buffer_hashes.contains(hash)
    }

    pub fn push_with_limit(&mut self, record: ClipboardRecord, max_records: usize) {
        if let Some(pos) = self.list.iter().position(|item| item.hash == record.hash) {
            if let Some(existing) = self.list.remove(pos) {
                self.hash_index.remove(&existing.hash);
                self.content_index.remove(&existing.hash);
                self.buffer_hashes.remove(&existing.hash);
            }
        }

        self.hash_index.insert(record.hash.clone());
        if let Some(ref content) = record.text_content {
            self.content_index
                .insert(record.hash.clone(), content.clone());
        }
        self.buffer_hashes.insert(record.hash.clone());
        self.list.push_front(record);

        let _ = self.enforce_max_records(max_records);
    }

    #[allow(dead_code)]
    pub fn push(&mut self, record: ClipboardRecord) {
        self.push_with_limit(record, 1000);
    }

    /// 限制缓存最大条数，返回被裁剪掉的记录（按最旧顺序）。
    /// max_records = 0 表示不限制。
    pub fn enforce_max_records(&mut self, max_records: usize) -> Vec<ClipboardRecord> {
        if max_records == 0 {
            return Vec::new();
        }

        let mut removed = Vec::new();
        while self.list.len() > max_records {
            if let Some(old) = self.list.pop_back() {
                self.hash_index.remove(&old.hash);
                self.content_index.remove(&old.hash);
                self.buffer_hashes.remove(&old.hash);
                removed.push(old);
            }
        }
        removed
    }

    pub fn remove_by_id(&mut self, id: &str) -> Option<ClipboardRecord> {
        if let Some(pos) = self.list.iter().position(|r| r.id == id) {
            let record = self.list.remove(pos).unwrap();
            self.hash_index.remove(&record.hash);
            self.content_index.remove(&record.hash);
            self.buffer_hashes.remove(&record.hash);
            Some(record)
        } else {
            None
        }
    }

    pub fn remove_by_ids(&mut self, ids: &[String]) -> Vec<ClipboardRecord> {
        ids.iter()
            .filter_map(|id| self.remove_by_id(id))
            .collect()
    }

    pub(crate) fn clear_buffer_hashes(&mut self) {
        self.buffer_hashes.clear();
    }

    pub fn get_all(&self) -> Vec<ClipboardRecord> {
        self.list.iter().cloned().collect()
    }
}

pub struct EventDeduplicator {
    last_event_hash: Option<String>,
    last_event_time: Option<Instant>,
}

impl EventDeduplicator {
    pub fn new() -> Self {
        Self {
            last_event_hash: None,
            last_event_time: None,
        }
    }

    pub fn should_process(&mut self, hash: &str) -> bool {
        let now = Instant::now();

        if let (Some(ref last_hash), Some(last_time)) =
            (&self.last_event_hash, &self.last_event_time)
        {
            if last_hash == hash && now.duration_since(*last_time).as_millis() < 100 {
                return false;
            }
        }

        self.last_event_hash = Some(hash.to_string());
        self.last_event_time = Some(now);
        true
    }
}
