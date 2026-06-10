//! 数据库迁移框架
//!
//! 提供通用的数据库迁移功能，支持版本管理、自动备份、回滚等

use rusqlite::{params, Connection, Result as SqliteResult};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// 迁移脚本 trait
pub trait Migration {
    fn version(&self) -> i32;
    fn name(&self) -> &str;
    fn up(&self, conn: &Connection) -> SqliteResult<()>;
    fn down(&self, conn: &Connection) -> SqliteResult<()>;
}

/// 迁移执行器
pub struct MigrationRunner {
    migrations: Vec<Box<dyn Migration>>,
}

impl MigrationRunner {
    pub fn new(favorite_hashes: Vec<String>) -> Self {
        Self {
            migrations: vec![Box::new(
                super::migrations::v2_add_favorite_and_subtype::AddFavoriteAndSubtypeFields::new(
                    favorite_hashes,
                ),
            )],
        }
    }

    pub fn run(&self, conn: &Connection) -> SqliteResult<()> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        let current_version = self.get_current_version(conn)?;

        for migration in &self.migrations {
            if migration.version() > current_version {
                println!(
                    "Running migration {}: {}",
                    migration.version(),
                    migration.name()
                );
                migration.up(conn)?;

                conn.execute(
                    "INSERT INTO schema_migrations (version, name) VALUES (?1, ?2)",
                    params![migration.version(), migration.name()],
                )?;
            }
        }

        Ok(())
    }

    fn get_current_version(&self, conn: &Connection) -> SqliteResult<i32> {
        let version: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        Ok(version)
    }

    #[allow(dead_code)]
    pub fn rollback(&self, conn: &Connection, target_version: i32) -> SqliteResult<()> {
        let current_version = self.get_current_version(conn)?;

        for migration in self.migrations.iter().rev() {
            if migration.version() > target_version && migration.version() <= current_version {
                println!(
                    "Rolling back migration {}: {}",
                    migration.version(),
                    migration.name()
                );
                migration.down(conn)?;

                conn.execute(
                    "DELETE FROM schema_migrations WHERE version = ?1",
                    params![migration.version()],
                )?;
            }
        }

        Ok(())
    }
}

/// 备份数据库
pub fn backup_database(db_path: &Path) -> std::io::Result<PathBuf> {
    let timestamp = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let backup_path = db_path.with_extension(format!("db.backup.{}", timestamp));
    fs::copy(db_path, &backup_path)?;

    println!("Database backed up to: {:?}", backup_path);
    Ok(backup_path)
}

/// 恢复备份
#[allow(dead_code)]
pub fn restore_backup(backup_path: &Path, db_path: &Path) -> std::io::Result<()> {
    fs::copy(backup_path, db_path)?;
    println!("Database restored from: {:?}", backup_path);
    Ok(())
}
