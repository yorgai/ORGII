//! In-memory routing layer: per-user `UserHub` actors that hold the
//! mpsc senders for every connected desktop / mobile peer and route
//! frames between them.
//!
//! Phase 2 wires the registry but does NOT yet plug the WS upgrade
//! handler in — the senders are exposed via the public methods so a
//! Phase 2.5/3 WS handler can install them once we're ready.

pub mod registry;
pub mod user_hub;

pub use registry::UserHubRegistry;
pub use user_hub::{RouteError, UserHub};

#[cfg(test)]
#[path = "hub_tests.rs"]
mod tests;
