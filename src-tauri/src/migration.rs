//! 数据库迁移框架
//!
//! 提供通用的数据库迁移功能，支持版本管理、自动备份、回滚等

use log::{info, warn};
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

    pub fn run(&self, conn: &Connection, db_path: &Path) -> SqliteResult<()> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        let current_version = self.get_current_version(conn)?;

        // 只在需要迁移时备份数据库
        let needs_migration = self.migrations.iter().any(|m| m.version() > current_version);
        if needs_migration && db_path.exists() {
            if let Err(e) = backup_database(db_path) {
                warn!("Failed to backup database before migration: {}", e);
            }
        }

        for migration in &self.migrations {
            if migration.version() > current_version {
                info!(
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
                info!(
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

    info!("Database backed up to: {:?}", backup_path);
    Ok(backup_path)
}

/// 恢复备份
#[allow(dead_code)]
pub fn restore_backup(backup_path: &Path, db_path: &Path) -> std::io::Result<()> {
    fs::copy(backup_path, db_path)?;
    info!("Database restored from: {:?}", backup_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    struct TestMigration {
        version: i32,
        name: String,
        executed: std::sync::Arc<std::sync::Mutex<bool>>,
    }

    impl TestMigration {
        fn new(version: i32, name: &str, executed: std::sync::Arc<std::sync::Mutex<bool>>) -> Self {
            Self {
                version,
                name: name.to_string(),
                executed,
            }
        }
    }

    impl Migration for TestMigration {
        fn version(&self) -> i32 {
            self.version
        }

        fn name(&self) -> &str {
            &self.name
        }

        fn up(&self, conn: &Connection) -> SqliteResult<()> {
            conn.execute(
                &format!(
                    "CREATE TABLE IF NOT EXISTS test_table_{} (id INTEGER PRIMARY KEY)",
                    self.version
                ),
                [],
            )?;
            *self.executed.lock().unwrap() = true;
            Ok(())
        }

        fn down(&self, conn: &Connection) -> SqliteResult<()> {
            conn.execute(&format!("DROP TABLE IF EXISTS test_table_{}", self.version), [])?;
            Ok(())
        }
    }

    #[test]
    fn test_migration_runner_skips_applied_migrations() {
        let conn = Connection::open_in_memory().unwrap();
        let executed = std::sync::Arc::new(std::sync::Mutex::new(false));

        let migration = TestMigration::new(1, "test_migration", executed.clone());
        let runner = MigrationRunner {
            migrations: vec![Box::new(migration)],
        };

        // 第一次运行：应该执行迁移
        let db_path = std::path::PathBuf::from(":memory:");
        runner.run(&conn, &db_path).unwrap();
        assert!(*executed.lock().unwrap());

        // 重置执行标志
        *executed.lock().unwrap() = false;

        // 第二次运行：不应该执行迁移（已应用）
        let executed2 = std::sync::Arc::new(std::sync::Mutex::new(false));
        let migration2 = TestMigration::new(1, "test_migration", executed2.clone());
        let runner2 = MigrationRunner {
            migrations: vec![Box::new(migration2)],
        };
        runner2.run(&conn, &db_path).unwrap();
        assert!(!*executed2.lock().unwrap());
    }

    #[test]
    fn test_migration_runner_runs_new_migrations() {
        let conn = Connection::open_in_memory().unwrap();
        let executed1 = std::sync::Arc::new(std::sync::Mutex::new(false));
        let executed2 = std::sync::Arc::new(std::sync::Mutex::new(false));

        let migration1 = TestMigration::new(1, "migration_1", executed1.clone());
        let migration2 = TestMigration::new(2, "migration_2", executed2.clone());

        let runner = MigrationRunner {
            migrations: vec![Box::new(migration1), Box::new(migration2)],
        };

        let db_path = std::path::PathBuf::from(":memory:");
        runner.run(&conn, &db_path).unwrap();

        assert!(*executed1.lock().unwrap());
        assert!(*executed2.lock().unwrap());
    }

    #[test]
    fn test_get_current_version_returns_zero_for_empty_db() {
        let conn = Connection::open_in_memory().unwrap();
        let runner = MigrationRunner {
            migrations: vec![],
        };

        // 创建 schema_migrations 表
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )
        .unwrap();

        let version = runner.get_current_version(&conn).unwrap();
        assert_eq!(version, 0);
    }
}
