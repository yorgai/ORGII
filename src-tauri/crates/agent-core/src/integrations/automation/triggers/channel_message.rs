//! Channel message automation trigger listener.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc};
use tracing::{error, info, warn};

use super::common::{TriggerContext, TriggerEvent, TriggerHandle};

pub(super) fn spawn_channel_message(
    rule_id: String,
    channel: String,
    pattern: Option<String>,
    event_tx: mpsc::Sender<TriggerEvent>,
    ctx: &TriggerContext,
) -> Option<TriggerHandle> {
    let compiled_pattern = pattern
        .as_ref()
        .and_then(|pat| match regex::Regex::new(pat) {
            Ok(re) => Some(re),
            Err(err) => {
                error!(
                    "[automation] Invalid regex pattern '{}' for rule '{}': {}",
                    pat, rule_id, err
                );
                None
            }
        });

    let mut msg_rx = ctx.channel_msg_tx.subscribe();
    let running = Arc::new(AtomicBool::new(true));
    let running_clone = running.clone();
    let rid = rule_id.clone();

    let handle = tokio::spawn(async move {
        info!(
            "[automation] ChannelMessage trigger started for rule '{}' (channel: {}, pattern: {:?})",
            rid, channel, pattern
        );

        while running_clone.load(Ordering::Relaxed) {
            let msg = match msg_rx.recv().await {
                Ok(msg) => msg,
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    warn!(
                        "[automation] ChannelMessage rule '{}' lagged, skipped {} messages",
                        rid, skipped
                    );
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => {
                    info!(
                        "[automation] ChannelMessage broadcast closed for rule '{}'",
                        rid
                    );
                    break;
                }
            };

            if !running_clone.load(Ordering::Relaxed) {
                break;
            }

            if msg.channel != channel {
                continue;
            }

            if let Some(ref re) = compiled_pattern {
                if !re.is_match(&msg.content) {
                    continue;
                }
            }

            if let Err(err) = event_tx
                .send(TriggerEvent {
                    rule_id: rid.clone(),
                })
                .await
            {
                error!(
                    "[automation] Failed to send channel message trigger event for rule '{}': {}",
                    rid, err
                );
                break;
            }
        }

        info!(
            "[automation] ChannelMessage trigger stopped for rule '{}'",
            rid
        );
    });

    Some(TriggerHandle {
        rule_id,
        running,
        handle: Some(handle),
    })
}
