//! Webhook automation trigger listener and global route registry.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{error, info};

use super::common::{TriggerEvent, TriggerHandle};

pub(super) fn spawn_webhook(
    rule_id: String,
    route: String,
    event_tx: mpsc::Sender<TriggerEvent>,
) -> Option<TriggerHandle> {
    let running = Arc::new(AtomicBool::new(true));
    let running_clone = running.clone();
    let rid = rule_id.clone();

    // Each webhook trigger listens on a unique route via the shared ATC webhook router.
    // We use a simple mpsc channel: the axum handler sends (), the trigger task receives.
    let (hook_tx, mut hook_rx) = mpsc::channel::<()>(32);

    webhook_registry::register(route.clone(), hook_tx);

    let handle = tokio::spawn(async move {
        info!(
            "[automation] Webhook trigger started for rule '{}' (route: {})",
            rid, route
        );

        while running_clone.load(Ordering::Relaxed) {
            match hook_rx.recv().await {
                Some(()) => {
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
                            "[automation] Failed to send webhook trigger event for rule '{}': {}",
                            rid, err
                        );
                        break;
                    }
                }
                None => {
                    info!("[automation] Webhook channel closed for rule '{}'", rid);
                    break;
                }
            }
        }

        webhook_registry::unregister(&route);
        info!("[automation] Webhook trigger stopped for rule '{}'", rid);
    });

    Some(TriggerHandle {
        rule_id,
        running,
        handle: Some(handle),
    })
}

/// Global registry mapping route strings to senders.
///
/// The ATC webhook axum handler looks up routes here.
pub mod webhook_registry {
    use parking_lot::RwLock;
    use std::collections::HashMap;
    use std::sync::LazyLock;
    use tokio::sync::mpsc;

    static REGISTRY: LazyLock<RwLock<HashMap<String, mpsc::Sender<()>>>> =
        LazyLock::new(|| RwLock::new(HashMap::new()));

    pub fn register(route: String, sender: mpsc::Sender<()>) {
        REGISTRY.write().insert(route, sender);
    }

    pub fn unregister(route: &str) {
        REGISTRY.write().remove(route);
    }

    /// Fire the webhook for a given route. Returns true if a handler was found.
    pub fn fire(route: &str) -> bool {
        let registry = REGISTRY.read();
        if let Some(sender) = registry.get(route) {
            sender.try_send(()).is_ok()
        } else {
            false
        }
    }

    /// List all registered webhook routes.
    pub fn list_routes() -> Vec<String> {
        REGISTRY.read().keys().cloned().collect()
    }
}
