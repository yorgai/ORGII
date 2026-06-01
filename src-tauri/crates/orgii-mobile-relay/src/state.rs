//! Shared state passed to every axum handler via `with_state`.
//!
//! `AppState` is a couple of `Arc`s — cloning it for every request is
//! O(refcount-bump). The two members are:
//!
//! - `storage`: the durable layer (paired devices, pending pairings,
//!   audit log, connection history). Trait object so tests can swap
//!   in `MemoryStorage`.
//! - `hub_registry`: in-memory routing layer keyed by `UserId`. The
//!   WS upgrade handler in Phase 2.5/3 will install mpsc senders
//!   here; for now the registry exists so the wiring is in place.

use std::sync::Arc;

use crate::hub::UserHubRegistry;
use crate::storage::Storage;

#[derive(Clone)]
pub struct AppState {
    pub storage: Arc<dyn Storage>,
    pub hub_registry: Arc<UserHubRegistry>,
}

impl AppState {
    /// Construct an `AppState` from already-built dependencies. The
    /// server boot path (`server::run`) and tests both go through
    /// here so the wiring stays in one place.
    pub fn new(storage: Arc<dyn Storage>, hub_registry: Arc<UserHubRegistry>) -> Self {
        Self {
            storage,
            hub_registry,
        }
    }
}

#[cfg(test)]
#[path = "state_tests.rs"]
mod tests;
