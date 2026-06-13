//! Global user-presence state — process-wide snapshot + change notification.
//!
//! The per-message `IdeContext.user_presence` snapshot remains the source
//! for prompt building (turn-level freshness). This module adds the
//! *global* state needed by runtime enforcement:
//!
//!   * pending interactions (questions, plan approvals) must re-arm their
//!     auto-resolve deadlines when the user switches mode mid-wait;
//!   * the goal loop must stop immediately when the user comes back online.
//!
//! The frontend pushes every mode switch through the `set_user_presence`
//! Tauri command (and syncs once on startup), so this snapshot is always
//! current even when no message has been sent yet.

use std::sync::RwLock;

use tokio::sync::broadcast;
use tracing::info;

use crate::interaction::presence_policy::PresencePolicy;
use crate::session::UserPresence;

static GLOBAL_PRESENCE: RwLock<Option<UserPresence>> = RwLock::new(None);

/// Change-notification channel. Receivers get the new snapshot.
static PRESENCE_TX: std::sync::OnceLock<broadcast::Sender<UserPresence>> =
    std::sync::OnceLock::new();

fn sender() -> &'static broadcast::Sender<UserPresence> {
    PRESENCE_TX.get_or_init(|| broadcast::channel(16).0)
}

/// Install a new global presence snapshot and notify all listeners.
/// Called from the `set_user_presence` Tauri command on every mode
/// switch / spec edit, and once on frontend startup.
pub fn set_global_presence(presence: UserPresence) {
    info!(
        "[presence] global presence set: mode={} stance={:?}",
        presence.mode, presence.stance
    );
    if let Ok(mut guard) = GLOBAL_PRESENCE.write() {
        *guard = Some(presence.clone());
    }
    // Ignore "no receivers" — listeners subscribe lazily.
    let _ = sender().send(presence.clone());
    crate::bus::broadcast_event(
        "user-presence-changed",
        serde_json::to_value(&presence).unwrap_or(serde_json::Value::Null),
    );
}

/// Current global snapshot (None before the frontend's first sync).
pub fn global_presence() -> Option<UserPresence> {
    GLOBAL_PRESENCE.read().ok().and_then(|guard| guard.clone())
}

/// Resolved policy for the current global presence. `None` snapshot
/// behaves like Online (everything off).
pub fn global_policy() -> PresencePolicy {
    PresencePolicy::resolve_opt(global_presence().as_ref())
}

/// Subscribe to presence changes. Each event carries the new snapshot.
pub fn subscribe() -> broadcast::Receiver<UserPresence> {
    sender().subscribe()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::interaction::presence_policy::GoalLoopPolicy;

    // Single test — global state is process-wide, so parallel tests would
    // race each other.
    #[tokio::test]
    async fn set_get_policy_and_subscribe_round_trip() {
        let mut rx = subscribe();

        let presence = UserPresence {
            mode: "invisible".to_string(),
            label: Some("Invisible".to_string()),
            goal_max_turns: Some(7),
            ..Default::default()
        };
        set_global_presence(presence);

        let snapshot = global_presence().expect("snapshot");
        assert_eq!(snapshot.mode, "invisible");
        assert_eq!(
            global_policy().goal_loop,
            GoalLoopPolicy::On { max_turns: 7 }
        );

        let mut last = None;
        while let Ok(value) = rx.try_recv() {
            last = Some(value);
        }
        assert_eq!(last.expect("received").mode, "invisible");
    }
}
