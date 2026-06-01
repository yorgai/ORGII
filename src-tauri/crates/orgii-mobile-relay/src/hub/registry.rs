//! Top-level registry mapping `UserId` → per-user `UserHub`.
//!
//! Hubs are created lazily on first reference (`get_or_create_hub`)
//! so the relay's memory grows linearly with the number of distinct
//! tenants connected at once, not the number of users in the
//! database. Empty hubs are NOT auto-pruned in Phase 2 — that's
//! deferred to Phase 9 (hardening) along with stale-connection
//! cleanup.

use std::collections::HashMap;
use std::sync::Arc;

use orgii_protocol::UserId;
use tokio::sync::RwLock;

use super::user_hub::UserHub;

#[derive(Default)]
pub struct UserHubRegistry {
    hubs: RwLock<HashMap<UserId, Arc<UserHub>>>,
}

impl UserHubRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns a reference-counted handle to the hub for `user_id`,
    /// creating one if it doesn't exist yet. The caller is expected
    /// to clone the `Arc` cheaply rather than re-resolving on every
    /// frame.
    pub async fn get_or_create_hub(&self, user_id: &UserId) -> Arc<UserHub> {
        // Read-lock fast path: the common case is "hub already
        // exists" (every frame after the first).
        {
            let hubs = self.hubs.read().await;
            if let Some(hub) = hubs.get(user_id) {
                return hub.clone();
            }
        }
        // Slow path: write-lock and re-check (another task may have
        // raced us). This is the standard double-checked-locking
        // pattern for concurrent insert.
        let mut hubs = self.hubs.write().await;
        if let Some(hub) = hubs.get(user_id) {
            return hub.clone();
        }
        let hub = Arc::new(UserHub::new(user_id.clone()));
        hubs.insert(user_id.clone(), hub.clone());
        hub
    }

    /// Number of distinct tenants currently held in memory. Useful
    /// for the future `/metrics` endpoint and for tests.
    pub async fn user_count(&self) -> usize {
        self.hubs.read().await.len()
    }
}
