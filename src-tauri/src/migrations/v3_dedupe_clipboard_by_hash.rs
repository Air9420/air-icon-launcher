//! 版本 3：清理重复的剪贴板记录，并建立 hash 唯一约束
//!
//! 背景：历史版本里存在「同一内容（hash 相同）被插入多行」的情况，
//! 例如 `Clash Verge` 这一条内容在库里存在 5 行，导致：
//! - 搜索结果里出现重复条目
//! - 剪贴板历史列表出现重复
//! - 「在剪贴板历史中定位」定位到其中一行后，其余重复行仍然可见
//!
//! 本迁移做两件事：
//! 1. 每组相同 hash 只保留一行（优先保留最新时间戳、收藏状态合并为「任一行为收藏即为收藏」）
//! 2. 建立 `hash` 唯一索引，从数据库层面杜绝再次产生重复

use rusqlite::{Connection, Result as SqliteResult};

use crate::migration::Migration;

pub struct DedupeClipboardByHash;

impl Migration for DedupeClipboardByHash {
    fn version(&self) -> i32 {
        3
    }

    fn name(&self) -> &str {
        "dedupe_clipboard_by_hash"
    }

    fn up(&self, conn: &Connection) -> SqliteResult<()> {
        // 先把「组内任意一行是收藏」合并到保留下来的那一行，
        // 避免删重复行时把用户的收藏状态一起删掉。
        conn.execute(
            "UPDATE clipboard_records
             SET is_favorite = 1
             WHERE hash IN (
                 SELECT hash FROM clipboard_records
                 GROUP BY hash
                 HAVING MAX(is_favorite) > 0
             )",
            [],
        )?;

        // 每组 hash 只保留一行：优先保留时间戳最新的；时间戳相同则保留 rowid 最小的。
        //
        // 用 rowid 而不是 id 作为兜底排序，是因为 rowid 单调递增，
        // 能保证结果确定（同组内不会因为排序不稳定而随机保留）。
        conn.execute(
            "DELETE FROM clipboard_records
             WHERE rowid NOT IN (
                 SELECT rowid FROM (
                     SELECT rowid,
                            ROW_NUMBER() OVER (
                                PARTITION BY hash
                                ORDER BY timestamp DESC, rowid ASC
                            ) AS rn
                     FROM clipboard_records
                 )
                 WHERE rn = 1
             )",
            [],
        )?;

        // 唯一索引：此后任何重复 hash 的插入都会被数据库拒绝
        // （写入侧已改为 upsert，见 `ClipboardDatabase::insert_batch`）。
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_hash_unique ON clipboard_records(hash)",
            [],
        )?;

        Ok(())
    }

    fn down(&self, conn: &Connection) -> SqliteResult<()> {
        // 去重不可逆：被删除的重复行无法恢复，只能从迁移前的备份还原。
        conn.execute("DROP INDEX IF EXISTS idx_hash_unique", [])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup(conn: &Connection) {
        conn.execute(
            "CREATE TABLE clipboard_records (
                id TEXT PRIMARY KEY,
                content_type TEXT NOT NULL,
                content_subtype TEXT,
                text_content TEXT,
                image_path TEXT,
                hash TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                is_favorite INTEGER NOT NULL DEFAULT 0
            )",
            [],
        )
        .unwrap();
    }

    fn insert(conn: &Connection, id: &str, hash: &str, ts: i64, fav: i64) {
        conn.execute(
            "INSERT INTO clipboard_records (id, content_type, text_content, hash, timestamp, is_favorite)
             VALUES (?1, 'text', 'x', ?2, ?3, ?4)",
            rusqlite::params![id, hash, ts, fav],
        )
        .unwrap();
    }

    fn count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM clipboard_records", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn keeps_latest_row_per_hash() {
        let conn = Connection::open_in_memory().unwrap();
        setup(&conn);
        insert(&conn, "a1", "h1", 100, 0);
        insert(&conn, "a2", "h1", 300, 0);
        insert(&conn, "a3", "h1", 200, 0);
        insert(&conn, "b1", "h2", 100, 0);

        DedupeClipboardByHash.up(&conn).unwrap();

        assert_eq!(count(&conn), 2);
        let kept: String = conn
            .query_row("SELECT id FROM clipboard_records WHERE hash = 'h1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(kept, "a2", "应保留时间戳最新的那一行");
    }

    #[test]
    fn merges_favorite_state_into_kept_row() {
        let conn = Connection::open_in_memory().unwrap();
        setup(&conn);
        // 最新一行未收藏，旧一行已收藏 —— 删除后必须仍为收藏
        insert(&conn, "old", "h1", 100, 1);
        insert(&conn, "new", "h1", 300, 0);

        DedupeClipboardByHash.up(&conn).unwrap();

        assert_eq!(count(&conn), 1);
        let (id, fav): (String, i64) = conn
            .query_row(
                "SELECT id, is_favorite FROM clipboard_records WHERE hash = 'h1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(id, "new");
        assert_eq!(fav, 1, "收藏状态必须合并保留");
    }

    #[test]
    fn unique_index_blocks_future_duplicates() {
        let conn = Connection::open_in_memory().unwrap();
        setup(&conn);
        insert(&conn, "a1", "h1", 100, 0);
        DedupeClipboardByHash.up(&conn).unwrap();

        let result = conn.execute(
            "INSERT INTO clipboard_records (id, content_type, text_content, hash, timestamp, is_favorite)
             VALUES ('a2', 'text', 'x', 'h1', 200, 0)",
            [],
        );
        assert!(result.is_err(), "唯一索引应阻止重复 hash 插入");
    }

    #[test]
    fn empty_table_is_safe() {
        let conn = Connection::open_in_memory().unwrap();
        setup(&conn);
        DedupeClipboardByHash.up(&conn).unwrap();
        assert_eq!(count(&conn), 0);
    }

    #[test]
    fn down_drops_unique_index() {
        let conn = Connection::open_in_memory().unwrap();
        setup(&conn);
        insert(&conn, "a1", "h1", 100, 0);
        DedupeClipboardByHash.up(&conn).unwrap();
        DedupeClipboardByHash.down(&conn).unwrap();

        // 索引已删除，重复插入应重新被允许
        let result = conn.execute(
            "INSERT INTO clipboard_records (id, content_type, text_content, hash, timestamp, is_favorite)
             VALUES ('a2', 'text', 'x', 'h1', 200, 0)",
            [],
        );
        assert!(result.is_ok());
    }
}
