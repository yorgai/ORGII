//! Tauri commands for cursor_ide session streaming delta delivery.
//!
//! `cursor_bridge_watch_composer` establishes a persistent CDP WebSocket to
//! the running Cursor renderer, injects a `MutationObserver` that fires
//! `window.__orgii_delta__(payload)` on every new token, and broadcasts
//! each delta to the frontend as a `code_session.activity` event routed to
//! the `cursoride-<uuid>` session IPC channel.
//!
//! `cursor_bridge_unwatch_composer` cancels the watch, closing the
//! long-lived WebSocket cleanly.
//!
//! Both commands are thin wrappers; real work lives in
//! `cursor_bridge_app::client::connect_and_watch`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use cursor_bridge_app::client::connect_and_watch;
use cursor_bridge_app::commands::DEFAULT_REMOTE_DEBUG_PORT;
use serde_json::json;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::api::websocket_handler;

// ─────────────────────────── State ───────────────────────────

/// Tauri-managed state that holds one `CancellationToken` per watched
/// `cursoride-*` session. Inserting a new entry for a session that is
/// already being watched automatically cancels the previous watch.
pub struct WatchHandlesState {
    handles: Mutex<HashMap<String, CancellationToken>>,
}

impl WatchHandlesState {
    pub fn new() -> Self {
        Self {
            handles: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for WatchHandlesState {
    fn default() -> Self {
        Self::new()
    }
}

// ─────────────────────────── Commands ───────────────────────────

/// Start a streaming delta watch for a `cursoride-*` session.
///
/// Connects to the Cursor renderer at the debug port, registers the
/// `__orgii_delta__` CDP binding, injects a MutationObserver into the
/// composer's DOM, and spawns a background task that forwards each
/// `Runtime.bindingCalled` event to the frontend as a
/// `code_session.activity` event with a delta chunk.
///
/// If a watch is already active for `session_id`, it is cancelled first
/// so at most one watcher exists per session.
#[tauri::command]
pub async fn cursor_bridge_watch_composer(
    session_id: String,
    composer_id: String,
    port: Option<u16>,
    state: tauri::State<'_, WatchHandlesState>,
) -> Result<(), String> {
    if session_id.trim().is_empty() {
        return Err("session_id must not be empty".to_string());
    }
    if composer_id.trim().is_empty() {
        return Err("composer_id must not be empty".to_string());
    }

    let resolved_port = port.unwrap_or(DEFAULT_REMOTE_DEBUG_PORT);

    // Cancel any existing watch for this session before starting a new one.
    {
        let mut guard = state
            .handles
            .lock()
            .expect("WatchHandlesState mutex poisoned");
        if let Some(existing) = guard.remove(&session_id) {
            existing.cancel();
        }
    }

    let session_id_clone = session_id.clone();

    // The `on_delta` callback runs inside a tokio task spawned by
    // `connect_and_watch`; it must be `Send + Sync + 'static`.
    // We capture the session_id string and call `websocket_handler::broadcast`
    // directly — this is in `src-tauri/src` so it has full access.
    let on_delta: Arc<dyn Fn(cursor_bridge_app::DeltaPayload) + Send + Sync + 'static> =
        Arc::new(move |delta: cursor_bridge_app::DeltaPayload| {
            // Build a `code_session.activity` envelope matching the format
            // CLI sessions use, so the existing `cliAdapter.createEventHandler`
            // delta path works without changes on the TypeScript side.
            let chunk = json!({
                "action_type": "assistant_delta",
                "result": {
                    "content": delta.text,
                    "is_delta": true,
                },
                "sequence": 0,
            });
            let msg = json!({
                "type": "code_session.activity",
                "session_id": delta.session_id,
                "chunk": chunk,
            });
            websocket_handler::broadcast(msg.to_string());
        });

    let token = connect_and_watch(
        "127.0.0.1",
        resolved_port,
        None,
        session_id_clone,
        composer_id.clone(),
        on_delta,
    )
    .await?;

    state
        .handles
        .lock()
        .expect("WatchHandlesState mutex poisoned")
        .insert(session_id.clone(), token);

    info!(session_id, composer_id, "started cursor_ide delta watch");
    Ok(())
}

/// Cancel the streaming delta watch for a `cursoride-*` session.
///
/// No-op if no watch is active for `session_id`. Returns `Ok` in both cases.
#[tauri::command]
pub async fn cursor_bridge_unwatch_composer(
    session_id: String,
    state: tauri::State<'_, WatchHandlesState>,
) -> Result<(), String> {
    let removed = state
        .handles
        .lock()
        .expect("WatchHandlesState mutex poisoned")
        .remove(&session_id);

    if let Some(token) = removed {
        token.cancel();
        info!(session_id, "cancelled cursor_ide delta watch");
    } else {
        warn!(
            session_id,
            "cursor_bridge_unwatch_composer: no active watch"
        );
    }

    Ok(())
}
