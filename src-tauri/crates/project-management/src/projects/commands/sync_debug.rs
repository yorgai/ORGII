//! Debug-only utilities for the OAuth flow and e2e testing surface.
//!
//! All items in this file are gated by `#[cfg(debug_assertions)]` so
//! production binaries compile the entire module out. The e2e binary
//! reaches these via `project_management::projects::commands::sync::*`
//! (because `sync.rs` re-exports everything from its private submodules).

#[cfg(debug_assertions)]
use super::{PendingFlow, PENDING_FLOWS, connection_pending_key};

/// Snapshot of a pending [`PendingFlow::Redirect`] entry's
/// non-cancel-token fields. The e2e debug binary uses this to simulate
/// the loopback callback without binding a real TCP port: the simulated
/// handler reads `state` + `code_verifier` + `client_id` + `redirect_uri`
/// from the snapshot, validates the caller-supplied `state`, and feeds
/// the `code` straight into [`oauth::linear::exchange_code`].
///
/// Debug-only so production binaries cannot accidentally surface
/// PKCE state material outside the IPC boundary.
#[cfg(debug_assertions)]
#[derive(Debug, Clone)]
pub struct DebugRedirectFlowSnapshot {
    pub adapter_id: String,
    pub client_id: String,
    pub state: String,
    pub code_verifier: String,
    pub port: u16,
    pub redirect_uri: String,
}

/// Read the pending [`PendingFlow::Redirect`] for `(connection_id, adapter_id)`
/// without removing it from the registry. Returns `None` when no
/// pending flow exists or when the pending entry is the device-flow
/// variant.
#[cfg(debug_assertions)]
pub fn debug_peek_connection_redirect_flow(
    connection_id: &str,
    adapter_id: &str,
) -> Option<DebugRedirectFlowSnapshot> {
    let map = PENDING_FLOWS.lock().ok()?;
    match map.get(&connection_pending_key(connection_id, adapter_id))? {
        PendingFlow::Redirect {
            adapter_id,
            client_id,
            state,
            code_verifier,
            port,
            redirect_uri,
            ..
        } => Some(DebugRedirectFlowSnapshot {
            adapter_id: adapter_id.clone(),
            client_id: client_id.clone(),
            state: state.clone(),
            code_verifier: code_verifier.clone(),
            port: *port,
            redirect_uri: redirect_uri.clone(),
        }),
        PendingFlow::Device { .. } => None,
    }
}

/// Drop the pending flow for `(connection_id, adapter_id)` without firing its
/// cancel token. Used by the e2e debug simulate-callback path after a
/// successful exchange.
#[cfg(debug_assertions)]
pub fn debug_drop_connection_pending(connection_id: &str, adapter_id: &str) {
    let _ = PENDING_FLOWS
        .lock()
        .ok()
        .and_then(|mut map| map.remove(&connection_pending_key(connection_id, adapter_id)));
}
