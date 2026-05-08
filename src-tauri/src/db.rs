use rusqlite::{params, params_from_iter, Connection, Result as SqliteResult};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

fn configure_connection(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA busy_timeout=5000;",
    )?;
    Ok(())
}

fn initialize_schema(conn: &Connection) -> SqliteResult<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS clipboard_records (
            id TEXT PRIMARY KEY,
            content_type TEXT NOT NULL,
            text_content TEXT,
            image_path TEXT,
            hash TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_hash ON clipboard_records(hash)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_time ON clipboard_records(timestamp DESC)",
        [],
    )?;

    Ok(())
}

pub struct ClipboardDatabase {
    write_conn: Mutex<Connection>,
    read_conn: Mutex<Connection>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrunedClipboardRecord {
    pub id: String,
    pub image_path: Option<String>,
}

#[allow(dead_code)]
impl ClipboardDatabase {
    pub fn new(db_path: &Path) -> SqliteResult<Self> {
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent).ok();
        }

        let write_conn = Connection::open(db_path)?;
        configure_connection(&write_conn)?;
        initialize_schema(&write_conn)?;
        let read_conn = Connection::open(db_path)?;
        configure_connection(&read_conn)?;

        Ok(Self {
            write_conn: Mutex::new(write_conn),
            read_conn: Mutex::new(read_conn),
        })
    }

    pub fn insert(&self, record: &ClipboardRecordDb) -> SqliteResult<()> {
        let conn = self.write_conn.lock().unwrap();
        conn.execute(
            "INSERT INTO clipboard_records (id, content_type, text_content, image_path, hash, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                record.id,
                record.content_type,
                record.text_content,
                record.image_path,
                record.hash,
                record.timestamp
            ],
        )?;
        Ok(())
    }

    pub fn insert_batch(&self, records: &[ClipboardRecordDb]) -> SqliteResult<()> {
        let mut conn = self.write_conn.lock().unwrap();
        let tx = conn.transaction()?;
        for record in records {
            tx.execute(
                "INSERT INTO clipboard_records (id, content_type, text_content, image_path, hash, timestamp)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    record.id,
                    record.content_type,
                    record.text_content,
                    record.image_path,
                    record.hash,
                    record.timestamp
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn delete(&self, id: &str) -> SqliteResult<Option<String>> {
        let conn = self.write_conn.lock().unwrap();
        let image_path: Option<String> = conn
            .query_row(
                "SELECT image_path FROM clipboard_records WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .ok();

        conn.execute("DELETE FROM clipboard_records WHERE id = ?1", [id])?;

        Ok(image_path)
    }

    pub fn delete_batch(&self, ids: &[String]) -> SqliteResult<Vec<String>> {
        let mut conn = self.write_conn.lock().unwrap();
        let tx = conn.transaction()?;
        let mut deleted_images = Vec::new();

        for id in ids {
            if let Ok(image_path) = tx.query_row(
                "SELECT image_path FROM clipboard_records WHERE id = ?1",
                [id.as_str()],
                |row| row.get::<_, String>(0),
            ) {
                if !image_path.is_empty() {
                    deleted_images.push(image_path);
                }
            }

            tx.execute("DELETE FROM clipboard_records WHERE id = ?1", [id.as_str()])?;
        }

        tx.commit()?;
        Ok(deleted_images)
    }

    pub fn get_all(&self) -> SqliteResult<Vec<ClipboardRecordDb>> {
        let conn = self.read_conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, content_type, text_content, image_path, hash, timestamp
             FROM clipboard_records ORDER BY timestamp DESC",
        )?;

        let records = stmt
            .query_map([], |row| {
                Ok(ClipboardRecordDb {
                    id: row.get(0)?,
                    content_type: row.get(1)?,
                    text_content: row.get(2)?,
                    image_path: row.get(3)?,
                    hash: row.get(4)?,
                    timestamp: row.get(5)?,
                })
            })?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(records)
    }

    pub fn get_by_hash(&self, hash: &str) -> SqliteResult<Option<ClipboardRecordDb>> {
        let conn = self.read_conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, content_type, text_content, image_path, hash, timestamp
             FROM clipboard_records WHERE hash = ?1",
        )?;

        let mut records = stmt.query_map([hash], |row| {
            Ok(ClipboardRecordDb {
                id: row.get(0)?,
                content_type: row.get(1)?,
                text_content: row.get(2)?,
                image_path: row.get(3)?,
                hash: row.get(4)?,
                timestamp: row.get(5)?,
            })
        })?;

        if let Some(record) = records.next() {
            return record.map(Some);
        }
        Ok(None)
    }

    pub fn count(&self) -> SqliteResult<i64> {
        let conn = self.read_conn.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM clipboard_records", [], |row| {
            row.get(0)
        })
    }

    pub fn enforce_max_records(&self, max: usize) -> SqliteResult<Vec<PrunedClipboardRecord>> {
        self.enforce_max_records_with_protected(max, &HashSet::new())
    }

    pub fn enforce_max_records_with_protected(
        &self,
        max: usize,
        protected_hashes: &HashSet<String>,
    ) -> SqliteResult<Vec<PrunedClipboardRecord>> {
        let conn = self.write_conn.lock().unwrap();
        let (count_sql, query_sql) = if protected_hashes.is_empty() {
            (
                "SELECT COUNT(*) FROM clipboard_records".to_string(),
                "SELECT id, image_path FROM clipboard_records ORDER BY timestamp ASC".to_string(),
            )
        } else {
            let placeholders = vec!["?"; protected_hashes.len()].join(", ");
            (
                format!(
                    "SELECT COUNT(*) FROM clipboard_records WHERE hash NOT IN ({})",
                    placeholders
                ),
                format!(
                    "SELECT id, image_path FROM clipboard_records WHERE hash NOT IN ({}) ORDER BY timestamp ASC",
                    placeholders
                ),
            )
        };

        let protected_vec: Vec<String> = protected_hashes.iter().cloned().collect();

        let count: i64 = if protected_vec.is_empty() {
            conn.query_row(&count_sql, [], |row| row.get(0))?
        } else {
            conn.query_row(
                &count_sql,
                params_from_iter(protected_vec.iter().map(|s| s.as_str())),
                |row| row.get(0),
            )?
        };

        if count as usize <= max {
            return Ok(Vec::new());
        }

        let to_delete = count as usize - max;
        let old_records: Vec<(String, Option<String>)> = if protected_vec.is_empty() {
            let mut stmt = conn.prepare(&query_sql)?;
            let mapped = stmt
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                .filter_map(|r| r.ok())
                .take(to_delete)
                .collect();
            mapped
        } else {
            let mut stmt = conn.prepare(&query_sql)?;
            let mapped = stmt
                .query_map(
                    params_from_iter(protected_vec.iter().map(|s| s.as_str())),
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?
                .filter_map(|r| r.ok())
                .take(to_delete)
                .collect();
            mapped
        };

        let pruned: Vec<PrunedClipboardRecord> = old_records
            .into_iter()
            .map(|(id, image_path)| PrunedClipboardRecord { id, image_path })
            .collect();

        for id in pruned.iter().map(|record| record.id.as_str()) {
            conn.execute("DELETE FROM clipboard_records WHERE id = ?1", [id])?;
        }

        Ok(pruned)
    }

    pub fn hash_exists(&self, hash: &str) -> SqliteResult<bool> {
        let conn = self.read_conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM clipboard_records WHERE hash = ?1",
            [hash],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    pub fn clear(&self) -> SqliteResult<Vec<String>> {
        let conn = self.write_conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT image_path FROM clipboard_records WHERE image_path IS NOT NULL")?;

        let images: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .filter(|p| !p.is_empty())
            .collect();

        conn.execute("DELETE FROM clipboard_records", [])?;

        Ok(images)
    }
}

#[derive(Debug, Clone)]
pub struct ClipboardRecordDb {
    pub id: String,
    pub content_type: String,
    pub text_content: Option<String>,
    pub image_path: Option<String>,
    pub hash: String,
    pub timestamp: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{Connection, OpenFlags};
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEST_DB_ID: AtomicU64 = AtomicU64::new(1);

    fn make_record(
        id: &str,
        content_type: &str,
        text: Option<&str>,
        hash: &str,
        ts: i64,
    ) -> ClipboardRecordDb {
        ClipboardRecordDb {
            id: id.to_string(),
            content_type: content_type.to_string(),
            text_content: text.map(|s| s.to_string()),
            image_path: None,
            hash: hash.to_string(),
            timestamp: ts,
        }
    }

    fn open_mem_db() -> ClipboardDatabase {
        let db_id = NEXT_TEST_DB_ID.fetch_add(1, Ordering::Relaxed);
        let db_uri = format!("file:clipboard_test_{db_id}?mode=memory&cache=shared");
        let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_URI;

        let write_conn = Connection::open_with_flags(&db_uri, flags).unwrap();
        configure_connection(&write_conn).unwrap();
        initialize_schema(&write_conn).unwrap();
        let read_conn = Connection::open_with_flags(&db_uri, flags).unwrap();
        configure_connection(&read_conn).unwrap();

        ClipboardDatabase {
            write_conn: Mutex::new(write_conn),
            read_conn: Mutex::new(read_conn),
        }
    }

    #[test]
    fn test_insert_and_get_all() {
        let db = open_mem_db();
        let record = make_record("1", "text", Some("hello"), "hash1", 1000);
        db.insert(&record).unwrap();

        let all = db.get_all().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, "1");
        assert_eq!(all[0].text_content, Some("hello".to_string()));
    }

    #[test]
    fn test_insert_batch() {
        let db = open_mem_db();
        let records = vec![
            make_record("1", "text", Some("a"), "h1", 1000),
            make_record("2", "text", Some("b"), "h2", 2000),
            make_record("3", "image", None, "h3", 3000),
        ];
        db.insert_batch(&records).unwrap();

        let all = db.get_all().unwrap();
        assert_eq!(all.len(), 3);
    }

    #[test]
    fn test_get_by_hash() {
        let db = open_mem_db();
        db.insert(&make_record("1", "text", Some("data"), "abc123", 1000))
            .unwrap();

        let found = db.get_by_hash("abc123").unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, "1");

        let not_found = db.get_by_hash("nonexistent").unwrap();
        assert!(not_found.is_none());
    }

    #[test]
    fn test_delete() {
        let db = open_mem_db();
        db.insert(&make_record("1", "text", Some("data"), "h1", 1000))
            .unwrap();

        let result = db.delete("1").unwrap();
        assert_eq!(result, None);

        let all = db.get_all().unwrap();
        assert!(all.is_empty());
    }

    #[test]
    fn test_delete_with_image_path() {
        let db = open_mem_db();
        let mut rec = make_record("1", "image", None, "h1", 1000);
        rec.image_path = Some("/path/to/img.png".to_string());
        db.insert(&rec).unwrap();

        let result = db.delete("1").unwrap();
        assert_eq!(result, Some("/path/to/img.png".to_string()));
    }

    #[test]
    fn test_delete_nonexistent_returns_ok() {
        let db = open_mem_db();
        let result = db.delete("nonexistent").unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_delete_batch() {
        let db = open_mem_db();
        db.insert(&make_record("1", "text", Some("a"), "h1", 1000))
            .unwrap();
        db.insert(&make_record("2", "text", Some("b"), "h2", 2000))
            .unwrap();
        db.insert(&make_record("3", "text", Some("c"), "h3", 3000))
            .unwrap();

        let deleted = db
            .delete_batch(&["1".to_string(), "2".to_string()])
            .unwrap();
        assert_eq!(deleted.len(), 0);

        let remaining = db.get_all().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "3");
    }

    #[test]
    fn test_count() {
        let db = open_mem_db();
        assert_eq!(db.count().unwrap(), 0);

        db.insert(&make_record("1", "text", Some("a"), "h1", 1000))
            .unwrap();
        db.insert(&make_record("2", "text", Some("b"), "h2", 2000))
            .unwrap();
        assert_eq!(db.count().unwrap(), 2);
    }

    #[test]
    fn test_hash_exists() {
        let db = open_mem_db();
        assert!(!db.hash_exists("h1").unwrap());

        db.insert(&make_record("1", "text", Some("a"), "h1", 1000))
            .unwrap();
        assert!(db.hash_exists("h1").unwrap());
    }

    #[test]
    fn test_clear() {
        let db = open_mem_db();
        db.insert(&make_record("1", "text", Some("a"), "h1", 1000))
            .unwrap();
        db.insert(&make_record("2", "image", None, "h2", 2000))
            .unwrap();

        let cleared_images = db.clear().unwrap();
        assert_eq!(cleared_images.len(), 0);
        assert_eq!(db.count().unwrap(), 0);
    }

    #[test]
    fn test_clear_returns_image_paths() {
        let db = open_mem_db();
        let mut rec = make_record("1", "image", None, "h1", 1000);
        rec.image_path = Some("/img/a.png".to_string());
        db.insert(&rec).unwrap();

        let cleared_images = db.clear().unwrap();
        assert_eq!(cleared_images.len(), 1);
        assert_eq!(cleared_images[0], "/img/a.png");
    }

    #[test]
    fn test_enforce_max_records_within_limit() {
        let db = open_mem_db();
        for i in 0..5 {
            db.insert(&make_record(
                &format!("{}", i),
                "text",
                Some("x"),
                &format!("h{}", i),
                i as i64,
            ))
            .unwrap();
        }
        let deleted = db.enforce_max_records(10).unwrap();
        assert!(deleted.is_empty());
        assert_eq!(db.count().unwrap(), 5);
    }

    #[test]
    fn test_enforce_max_records_exceeds_limit() {
        let db = open_mem_db();
        for i in 0..5 {
            db.insert(&make_record(
                &format!("{}", i),
                "text",
                Some("x"),
                &format!("h{}", i),
                (i + 1) as i64 * 1000,
            ))
            .unwrap();
        }
        let _deleted = db.enforce_max_records(3).unwrap();
        assert_eq!(db.count().unwrap(), 3);
    }

    #[test]
    fn test_enforce_max_records_with_protected_hashes() {
        let db = open_mem_db();
        for i in 0..5 {
            db.insert(&make_record(
                &format!("{}", i),
                "text",
                Some("x"),
                &format!("h{}", i),
                (i + 1) as i64 * 1000,
            ))
            .unwrap();
        }

        let protected_hashes = HashSet::from([
            "h0".to_string(), // oldest
            "h3".to_string(),
        ]);

        let deleted = db
            .enforce_max_records_with_protected(2, &protected_hashes)
            .unwrap();

        let deleted_ids: HashSet<String> = deleted.into_iter().map(|r| r.id).collect();
        assert!(deleted_ids.contains("1"));
        assert!(deleted_ids.contains("2"));
        assert!(deleted_ids.contains("4"));
        assert!(!deleted_ids.contains("0"));
        assert!(!deleted_ids.contains("3"));

        let remained = db.get_all().unwrap();
        let remained_hashes: HashSet<String> = remained.into_iter().map(|r| r.hash).collect();
        assert_eq!(remained_hashes.len(), 2);
        assert!(remained_hashes.contains("h0"));
        assert!(remained_hashes.contains("h3"));
    }
}
