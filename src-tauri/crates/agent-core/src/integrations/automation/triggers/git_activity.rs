//! Git activity automation trigger listener.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc};
use tracing::{error, info, warn};

use super::super::types::GitEvent;
use super::common::{TriggerContext, TriggerEvent, TriggerHandle};

pub(super) fn spawn_git_activity(
    rule_id: String,
    events: Vec<GitEvent>,
    repo_filter: Option<String>,
    event_tx: mpsc::Sender<TriggerEvent>,
    ctx: &TriggerContext,
) -> Option<TriggerHandle> {
    let mut git_rx = ctx.git_event_tx.subscribe();
    let running = Arc::new(AtomicBool::new(true));
    let running_clone = running.clone();
    let rid = rule_id.clone();

    let handle = tokio::spawn(async move {
        info!(
            "[automation] GitActivity trigger started for rule '{}' (events: {:?})",
            rid, events
        );

        while running_clone.load(Ordering::Relaxed) {
            let git_event = match git_rx.recv().await {
                Ok(evt) => evt,
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    warn!(
                        "[automation] GitActivity rule '{}' lagged, skipped {} events",
                        rid, skipped
                    );
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => {
                    info!(
                        "[automation] GitActivity broadcast closed for rule '{}'",
                        rid
                    );
                    break;
                }
            };

            if !running_clone.load(Ordering::Relaxed) {
                break;
            }

            if let Some(ref filter) = repo_filter {
                if !git_event.repo_id.contains(filter.as_str()) {
                    continue;
                }
            }

            let matches = match git_event.operation.as_str() {
                "commit" => events.contains(&GitEvent::Commit),
                "push" => events.contains(&GitEvent::Push),
                "pull" | "fetch" => events.contains(&GitEvent::Pull),
                "checkout" | "switch" => events.contains(&GitEvent::BranchChange),
                _ => false,
            } || match git_event.change_type.as_str() {
                "files" => events.contains(&GitEvent::FileChange),
                "branch" => events.contains(&GitEvent::BranchChange),
                _ => false,
            };

            if matches {
                if let Err(err) = event_tx
                    .send(TriggerEvent {
                        rule_id: rid.clone(),
                    })
                    .await
                {
                    error!(
                        "[automation] Failed to send git trigger event for rule '{}': {}",
                        rid, err
                    );
                    break;
                }
            }
        }

        info!(
            "[automation] GitActivity trigger stopped for rule '{}'",
            rid
        );
    });

    Some(TriggerHandle {
        rule_id,
        running,
        handle: Some(handle),
    })
}
