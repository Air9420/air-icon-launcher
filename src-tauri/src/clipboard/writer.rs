use crate::clipboard::{ClipboardRecord, ClipboardState};
use crate::db::ClipboardRecordDb;
use crossbeam_channel::Receiver;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

pub(crate) fn start_writer_thread(receiver: Receiver<ClipboardRecord>, state: Arc<ClipboardState>) {
    thread::spawn(move || {
        let mut buffer: Vec<ClipboardRecordDb> = Vec::new();
        let mut last_flush = Instant::now();
        let flush_interval = Duration::from_secs(1);
        let batch_size = 50;

        loop {
            match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(record) => {
                    buffer.push(ClipboardRecordDb::from(&record));

                    if buffer.len() >= batch_size || last_flush.elapsed() >= flush_interval {
                        if !buffer.is_empty() {
                            let records_to_flush = std::mem::take(&mut buffer);
                            if let Some(db) = state.database.lock().unwrap().as_ref() {
                                if db.insert_batch(&records_to_flush).is_err() {
                                    buffer.extend(records_to_flush);
                                } else {
                                    let max_records = state.config.lock().unwrap().max_records;
                                    if max_records > 0 {
                                        let protected_hashes =
                                            state.favorite_hashes.lock().unwrap().clone();
                                        if let Ok(pruned) = db
                                            .enforce_max_records_with_protected(
                                                max_records,
                                                &protected_hashes,
                                            )
                                        {
                                            let pruned_ids: Vec<String> =
                                                pruned.iter().map(|record| record.id.clone()).collect();
                                            if !pruned_ids.is_empty() {
                                                let mut cache = state.cache.lock().unwrap();
                                                let _ = cache.remove_by_ids(&pruned_ids);
                                            }
                                            for record in pruned {
                                                if let Some(image_path) = record.image_path {
                                                    if !image_path.is_empty() {
                                                        let _ = std::fs::remove_file(image_path);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        last_flush = Instant::now();
                    }
                }
                Err(_) => {
                    if last_flush.elapsed() >= flush_interval && !buffer.is_empty() {
                        let records_to_flush = std::mem::take(&mut buffer);
                        if let Some(db) = state.database.lock().unwrap().as_ref() {
                            if db.insert_batch(&records_to_flush).is_err() {
                                buffer.extend(records_to_flush);
                            } else {
                                let max_records = state.config.lock().unwrap().max_records;
                                if max_records > 0 {
                                    let protected_hashes =
                                        state.favorite_hashes.lock().unwrap().clone();
                                    if let Ok(pruned) = db
                                        .enforce_max_records_with_protected(
                                            max_records,
                                            &protected_hashes,
                                        )
                                    {
                                        let pruned_ids: Vec<String> =
                                            pruned.iter().map(|record| record.id.clone()).collect();
                                        if !pruned_ids.is_empty() {
                                            let mut cache = state.cache.lock().unwrap();
                                            let _ = cache.remove_by_ids(&pruned_ids);
                                        }
                                        for record in pruned {
                                            if let Some(image_path) = record.image_path {
                                                if !image_path.is_empty() {
                                                    let _ = std::fs::remove_file(image_path);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        last_flush = Instant::now();
                    }
                }
            }

            if !buffer.is_empty() && last_flush.elapsed() >= flush_interval {
                let records_to_flush = std::mem::take(&mut buffer);
                if let Some(db) = state.database.lock().unwrap().as_ref() {
                    if db.insert_batch(&records_to_flush).is_err() {
                        buffer.extend(records_to_flush);
                    } else {
                        let max_records = state.config.lock().unwrap().max_records;
                        if max_records > 0 {
                            let protected_hashes = state.favorite_hashes.lock().unwrap().clone();
                            if let Ok(pruned) = db.enforce_max_records_with_protected(
                                max_records,
                                &protected_hashes,
                            ) {
                                let pruned_ids: Vec<String> =
                                    pruned.iter().map(|record| record.id.clone()).collect();
                                if !pruned_ids.is_empty() {
                                    let mut cache = state.cache.lock().unwrap();
                                    let _ = cache.remove_by_ids(&pruned_ids);
                                }
                                for record in pruned {
                                    if let Some(image_path) = record.image_path {
                                        if !image_path.is_empty() {
                                            let _ = std::fs::remove_file(image_path);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                last_flush = Instant::now();
            }
        }
    });
}
