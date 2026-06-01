//! File watching automation trigger listener.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use super::common::{TriggerEvent, TriggerHandle};

pub(super) fn spawn_file_watch(
    rule_id: String,
    paths: Vec<String>,
    debounce_ms: u64,
    event_tx: mpsc::Sender<TriggerEvent>,
) -> Option<TriggerHandle> {
    use notify::Watcher;

    if paths.is_empty() {
        warn!(
            "[automation] FileWatch rule '{}' has no paths to watch",
            rule_id
        );
        return None;
    }

    let running = Arc::new(AtomicBool::new(true));
    let running_clone = running.clone();
    let rid = rule_id.clone();
    let watch_paths: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();

    let handle = tokio::spawn(async move {
        info!(
            "[automation] FileWatch trigger starting for rule '{}' (debounce: {}ms, paths: {})",
            rid,
            debounce_ms,
            watch_paths.len()
        );

        let (notify_tx, notify_rx) = std::sync::mpsc::channel::<()>();
        let rid_for_callback = rid.clone();
        let mut watcher = match notify::recommended_watcher(
            move |result: Result<notify::Event, notify::Error>| match result {
                Ok(_event) => {
                    if notify_tx.send(()).is_err() {
                        debug!(
                            "[automation] FileWatch debounce channel for rule '{}' was closed",
                            rid_for_callback
                        );
                    }
                }
                Err(err) => {
                    error!(
                        "[automation] FileWatch error for rule '{}': {}",
                        rid_for_callback, err
                    );
                }
            },
        ) {
            Ok(watcher) => watcher,
            Err(err) => {
                error!(
                    "[automation] Failed to create file watcher for rule '{}': {}",
                    rid, err
                );
                return;
            }
        };

        for path in &watch_paths {
            if let Err(err) = watcher.watch(path, notify::RecursiveMode::Recursive) {
                warn!(
                    "[automation] FileWatch could not watch path '{}' for rule '{}': {}",
                    path.display(),
                    rid,
                    err
                );
            }
        }

        info!("[automation] FileWatch trigger started for rule '{}'", rid);
        let debounce_duration = tokio::time::Duration::from_millis(debounce_ms.max(100));

        while running_clone.load(Ordering::Relaxed) {
            match notify_rx.try_recv() {
                Ok(()) => {
                    tokio::time::sleep(debounce_duration).await;
                    while notify_rx.try_recv().is_ok() {}

                    if !running_clone.load(Ordering::Relaxed) {
                        break;
                    }

                    if let Err(err) = event_tx
                        .send(TriggerEvent {
                            rule_id: rid.clone(),
                        })
                        .await
                    {
                        error!(
                            "[automation] Failed to send file watch trigger event for rule '{}': {}",
                            rid, err
                        );
                        break;
                    }
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => {
                    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                }
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    warn!(
                        "[automation] FileWatch notify channel disconnected for rule '{}'",
                        rid
                    );
                    break;
                }
            }
        }

        drop(watcher);
        info!("[automation] FileWatch trigger stopped for rule '{}'", rid);
    });

    Some(TriggerHandle {
        rule_id,
        running,
        handle: Some(handle),
    })
}
