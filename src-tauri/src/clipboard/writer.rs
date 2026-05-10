use crate::clipboard::{ClipboardRecord, ClipboardState};
use crate::db::ClipboardRecordDb;
use crossbeam_channel::Receiver;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

pub(crate) fn start_writer_thread(
    receiver: Receiver<ClipboardRecord>,
    state: Arc<ClipboardState>,
) -> thread::JoinHandle<()> {
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
                            flush_records_or_retain(&state, &mut buffer);
                        }
                        last_flush = Instant::now();
                    }
                }
                Err(_) => {
                    if !*state.is_monitoring.lock().unwrap() && receiver.is_empty() {
                        if !buffer.is_empty() {
                            flush_records_or_retain(&state, &mut buffer);
                        }
                        break;
                    }

                    if last_flush.elapsed() >= flush_interval && !buffer.is_empty() {
                        flush_records_or_retain(&state, &mut buffer);
                        last_flush = Instant::now();
                    }
                }
            }

            if !buffer.is_empty() && last_flush.elapsed() >= flush_interval {
                flush_records_or_retain(&state, &mut buffer);
                last_flush = Instant::now();
            }
        }
    })
}

fn flush_records_or_retain(state: &Arc<ClipboardState>, buffer: &mut Vec<ClipboardRecordDb>) {
    let db_lock = state.database.lock().unwrap();
    let Some(db) = db_lock.as_ref() else {
        return;
    };
    let records_to_flush = std::mem::take(buffer);
    if db.insert_batch(&records_to_flush).is_err() {
        buffer.extend(records_to_flush);
    } else {
        drop(db_lock);
        prune_after_flush(state);
    }
}

fn prune_after_flush(state: &Arc<ClipboardState>) {
    let max_records = state.config.lock().unwrap().max_records;
    if max_records == 0 {
        return;
    }

    let protected_hashes = state.favorite_hashes.lock().unwrap().clone();
    let db_lock = state.database.lock().unwrap();
    let Some(db) = db_lock.as_ref() else {
        return;
    };
    if let Ok(pruned) = db.enforce_max_records_with_protected(max_records, &protected_hashes) {
        let pruned_ids: Vec<String> = pruned.iter().map(|record| record.id.clone()).collect();
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clipboard::ClipboardState;
    use crossbeam_channel::bounded;
    use std::sync::Arc;

    #[test]
    fn writer_thread_exits_after_monitoring_stops_and_queue_drains() {
        let (sender, receiver) = bounded::<ClipboardRecord>(1);
        let state = Arc::new(ClipboardState::default());
        *state.is_monitoring.lock().unwrap() = true;

        let handle = start_writer_thread(receiver, state.clone());
        drop(sender);
        *state.is_monitoring.lock().unwrap() = false;

        let (done_sender, done_receiver) = bounded::<()>(1);
        let waiter = thread::spawn(move || {
            handle.join().unwrap();
            let _ = done_sender.send(());
        });

        done_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("writer thread should exit after monitoring stops");
        waiter.join().unwrap();
    }
}
