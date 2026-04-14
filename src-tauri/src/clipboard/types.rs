use crate::db::ClipboardRecordDb;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardRecord {
    pub id: String,
    #[serde(rename = "content_type")]
    pub record_type: String,
    pub text_content: Option<String>,
    pub image_path: Option<String>,
    pub hash: String,
    pub timestamp: u64,
}

impl From<ClipboardRecordDb> for ClipboardRecord {
    fn from(db_record: ClipboardRecordDb) -> Self {
        Self {
            id: db_record.id,
            record_type: db_record.content_type,
            text_content: db_record.text_content,
            image_path: db_record.image_path,
            hash: db_record.hash,
            timestamp: db_record.timestamp as u64,
        }
    }
}

impl From<&ClipboardRecord> for ClipboardRecordDb {
    fn from(record: &ClipboardRecord) -> Self {
        Self {
            id: record.id.clone(),
            content_type: record.record_type.clone(),
            text_content: record.text_content.clone(),
            image_path: record.image_path.clone(),
            hash: record.hash.clone(),
            timestamp: record.timestamp as i64,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardConfig {
    pub max_records: usize,
    pub max_image_size_mb: f64,
    pub encrypted: bool,
    pub storage_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClipboardConfigPatch {
    pub max_records: Option<usize>,
    pub max_image_size_mb: Option<f64>,
    pub encrypted: Option<bool>,
}

impl Default for ClipboardConfig {
    fn default() -> Self {
        Self {
            max_records: 1000,
            max_image_size_mb: 1.0,
            encrypted: false,
            storage_path: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ClipboardConfigDebug {
    pub config_path: String,
    pub runtime: ClipboardConfig,
    pub disk_max_records: usize,
    pub disk_max_image_size_mb: f64,
    pub disk_encrypted: bool,
    pub disk_storage_path: Option<String>,
}
