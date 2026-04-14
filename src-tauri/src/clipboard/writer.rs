use crate::db::ClipboardRecordDb;
use crate::clipboard::{ClipboardRecord, ClipboardState};
use crossbeam_channel::Receiver;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

pub(crate) fn start_writer_thread(
    receiver: Receiver<ClipboardRecord>,
    state: Arc<ClipboardState>,
) {
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
                    }
                }
                last_flush = Instant::now();
            }
        }
    });
}