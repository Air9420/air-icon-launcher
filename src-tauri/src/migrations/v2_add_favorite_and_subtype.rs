//! 版本 2：添加收藏和子类型字段

use rusqlite::{Connection, Result as SqliteResult};

use crate::migration::Migration;

pub struct AddFavoriteAndSubtypeFields {
    favorite_hashes: Vec<String>,
}

impl AddFavoriteAndSubtypeFields {
    pub fn new(favorite_hashes: Vec<String>) -> Self {
        Self { favorite_hashes }
    }
}

impl Migration for AddFavoriteAndSubtypeFields {
    fn version(&self) -> i32 {
        2
    }

    fn name(&self) -> &str {
        "add_favorite_and_subtype_fields"
    }

    fn up(&self, conn: &Connection) -> SqliteResult<()> {
        // 添加新字段
        conn.execute(
            "ALTER TABLE clipboard_records ADD COLUMN is_favorite BOOLEAN DEFAULT 0",
            [],
        )?;
        conn.execute(
            "ALTER TABLE clipboard_records ADD COLUMN content_subtype TEXT",
            [],
        )?;

        // 迁移收藏数据
        for hash in &self.favorite_hashes {
            conn.execute(
                "UPDATE clipboard_records SET is_favorite = 1 WHERE hash = ?1",
                [hash],
            )?;
        }

        // 迁移 content_subtype 数据
        //
        // 注意：代码检测是"尽力而为"的启发式方法，基于简单的关键词匹配。
        // 这种方法有局限性：
        // - 可能误判包含代码关键词的普通文本为代码
        // - 可能遗漏不常见语法的代码片段
        // - 不支持所有编程语言
        //
        // 如果需要更精确的代码检测，建议使用专门的语法分析库。
        conn.execute(
            "UPDATE clipboard_records SET content_subtype = CASE
                WHEN content_type = 'image' THEN 'image'
                WHEN text_content LIKE '%```%'
                     OR text_content LIKE '%function %'
                     OR text_content LIKE '%class %'
                     OR text_content LIKE '%const %'
                     OR text_content LIKE '%let %'
                     OR text_content LIKE '%var %'
                     OR text_content LIKE '%import %'
                     OR text_content LIKE '%export %'
                     OR text_content LIKE '%def %'
                     OR text_content LIKE '%return %'
                THEN 'code'
                ELSE 'text'
            END",
            [],
        )?;

        // 创建索引
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_favorite ON clipboard_records(is_favorite)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_subtype ON clipboard_records(content_subtype)",
            [],
        )?;

        Ok(())
    }

    fn down(&self, _conn: &Connection) -> SqliteResult<()> {
        // SQLite 3.35.0 之前不支持 DROP COLUMN
        // 回滚此迁移需要重建表，风险较高，建议从备份恢复
        Err(rusqlite::Error::InvalidParameterName(
            "Rollback of V2 migration is not supported. Restore from backup instead.".to_string(),
        ))
    }
}
