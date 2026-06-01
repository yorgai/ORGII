//! Production [`DispatchHost`] backed by a live `tauri::AppHandle`.
//!
//! Routes the canonical mobile-remote commands directly to the
//! underlying Rust functions that back the corresponding
//! `#[tauri::command]` handlers. We deliberately call the bare async
//! functions (e.g. [`list_all_sessions`], `send_message_impl_for_mobile_remote`)
//! rather than the `__cmd__` macro symbols, because the macro
//! symbols re-marshal arguments through `tauri::ipc::Invoke` — a
//! surface only reachable from the frontend. The bare functions are
//! the same ones the macro decorates and are therefore the canonical
//! implementation.
//!
//! ## Wired commands
//!
//! | Method                | Underlying call |
//! |---|---|
//! | [`list_sessions`]      | `agent_sessions::unified_stats::aggregation::list_all_sessions` (no `State<...>`) |
//! | [`get_session`]        | filtered scan over `list_all_sessions` (no `State<...>`) |
//! | [`approve_tool_call`]  | `AgentPermissionManager::respond` via `AgentAppState::get_session` |
//! | [`deny_tool_call`]     | `AgentPermissionManager::respond` via `AgentAppState::get_session` |
//! | [`send_message`]       | `agent_core::state::commands::session::message::send_message_impl_for_mobile_remote` |
//!
//! The mutating commands resolve `AgentAppState` via
//! `AppHandle::try_state::<AgentAppState>()` rather than reaching for
//! a `tauri::State<'_, AgentAppState>` (which only Tauri's command
//! macro can hand out). The state lookup matches the pattern used by
//! other non-command callers such as `member_shutdown` and
//! `inbox_wake`.
//!
//! ## Mobile call_id semantics
//!
//! The mobile wire schema names the field `call_id` in
//! `tool_call_approve` / `tool_call_deny`. On the desktop the
//! permission manager keys pending approvals on `request_id` (the ID
//! emitted in the `permission:request` event the mobile client
//! subscribed to). The mobile client therefore sends back the
//! `requestId` it received from the event under the wire name
//! `call_id`. We forward it verbatim to
//! [`AgentPermissionManager::respond`].

use async_trait::async_trait;
use tauri::Manager;

use agent_core::interaction::permission::PermissionResponse;
use agent_core::state::commands::session::message::send_message_impl_for_mobile_remote;
use agent_core::state::AgentAppState;
use mobile_remote::dispatch::DispatchHost;
use mobile_remote::error::MobileRemoteError;

use crate::agent_sessions::unified_stats::aggregation::list_all_sessions;
use crate::agent_sessions::unified_stats::types::SessionFilter;

/// Live dispatch host. Holds the Tauri `AppHandle` so methods that
/// need state (mutating commands) can pull it via
/// `self.app.try_state::<AgentAppState>()`. Read methods that don't
/// touch state ignore the handle entirely.
#[derive(Clone)]
pub struct TauriDispatchHost {
    app: tauri::AppHandle,
}

impl TauriDispatchHost {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }

    /// Borrow the underlying `AppHandle`. Exposed for tests and for
    /// any future wiring that needs `self.app.try_state::<…>()`.
    pub fn app(&self) -> &tauri::AppHandle {
        &self.app
    }

    /// Resolve `AgentAppState` from the held `AppHandle`. Returns a
    /// `MobileRemoteError::DispatchHandler` when the state has not
    /// been registered (the bridge is only spawned after `setup`, so
    /// in production this never fails — the error path exists for
    /// defence in depth and so tests can observe a deterministic
    /// failure mode).
    fn agent_state(&self) -> Result<tauri::State<'_, AgentAppState>, MobileRemoteError> {
        self.app.try_state::<AgentAppState>().ok_or_else(|| {
            MobileRemoteError::DispatchHandler(
                "AgentAppState not registered on AppHandle".to_owned(),
            )
        })
    }
}

impl std::fmt::Debug for TauriDispatchHost {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TauriDispatchHost").finish_non_exhaustive()
    }
}

#[async_trait]
impl DispatchHost for TauriDispatchHost {
    async fn list_sessions(&self) -> Result<serde_json::Value, MobileRemoteError> {
        // `list_all_sessions` performs blocking SQLite work; the live
        // `session_aggregate_list` Tauri command wraps it in
        // `spawn_blocking` for the same reason. We mirror that here
        // so we don't stall the bridge's tokio runtime.
        let response = tokio::task::spawn_blocking(|| list_all_sessions(None))
            .await
            .map_err(|err| {
                MobileRemoteError::DispatchHandler(format!("sessions_list join: {err}"))
            })?
            .map_err(|err| MobileRemoteError::DispatchHandler(format!("sessions_list: {err}")))?;

        serde_json::to_value(response).map_err(MobileRemoteError::Serialize)
    }

    async fn get_session(&self, id: &str) -> Result<serde_json::Value, MobileRemoteError> {
        // No first-class `session_get` Tauri command exists today;
        // the closest equivalent is filtering the aggregate list by
        // `session_id`. That's still cheap because the aggregator
        // hits already-warm caches.
        let target = id.to_owned();
        let response =
            tokio::task::spawn_blocking(move || list_all_sessions(Some(&SessionFilter::default())))
                .await
                .map_err(|err| {
                    MobileRemoteError::DispatchHandler(format!("session_get join: {err}"))
                })?
                .map_err(|err| MobileRemoteError::DispatchHandler(format!("session_get: {err}")))?;

        let session = response
            .sessions
            .into_iter()
            .find(|record| record.session_id == target)
            .ok_or_else(|| {
                MobileRemoteError::DispatchHandler(format!("session_get: not found: {target}"))
            })?;

        serde_json::to_value(session).map_err(MobileRemoteError::Serialize)
    }

    async fn approve_tool_call(
        &self,
        session_id: &str,
        call_id: &str,
    ) -> Result<(), MobileRemoteError> {
        let state = self.agent_state()?;
        let session = state.get_session(session_id).await.ok_or_else(|| {
            MobileRemoteError::DispatchHandler(format!(
                "approve_tool_call: session not found: {session_id}"
            ))
        })?;

        // `tool_name` / `tool_args` are only consulted for the
        // `AlwaysAllow` branch (to materialize a session-scoped
        // always-allow rule). A plain `Allow` from the mobile peer
        // never persists a rule, so passing `None` here is correct.
        let dispatched = session
            .permission_manager
            .respond(call_id, PermissionResponse::Allow, None, None)
            .await;
        if !dispatched {
            return Err(MobileRemoteError::DispatchHandler(format!(
                "approve_tool_call: no pending request for {call_id} on session {session_id}"
            )));
        }
        Ok(())
    }

    async fn deny_tool_call(
        &self,
        session_id: &str,
        call_id: &str,
        _reason: Option<String>,
    ) -> Result<(), MobileRemoteError> {
        // `reason` is captured in the wire schema for future audit
        // log / UI surfacing but the underlying
        // `AgentPermissionManager::respond` does not accept a free-
        // form rejection reason today — the rejection just maps to a
        // canonical "User denied this tool invocation." string in the
        // finalized event. We intentionally drop the field rather
        // than silently inventing a side-channel.
        let state = self.agent_state()?;
        let session = state.get_session(session_id).await.ok_or_else(|| {
            MobileRemoteError::DispatchHandler(format!(
                "deny_tool_call: session not found: {session_id}"
            ))
        })?;

        let dispatched = session
            .permission_manager
            .respond(call_id, PermissionResponse::Deny, None, None)
            .await;
        if !dispatched {
            return Err(MobileRemoteError::DispatchHandler(format!(
                "deny_tool_call: no pending request for {call_id} on session {session_id}"
            )));
        }
        Ok(())
    }

    async fn send_message(&self, session_id: &str, content: &str) -> Result<(), MobileRemoteError> {
        // Mobile peers don't carry `IdentityOverrides` (model /
        // account / workspace_root) on the wire today. The mobile-
        // remote helper constructs a default `IdentityOverrides` so
        // `send_message_impl`'s resolver falls back to the in-memory
        // `SessionRuntime` cache and then the DB persistence row —
        // i.e. "use whatever the desktop last used for this session",
        // which is the least surprising behavior for a remote-control
        // follow-up.
        let state = self.agent_state()?;
        send_message_impl_for_mobile_remote(&state, session_id.to_owned(), content.to_owned())
            .await
            .map(|_| ())
            .map_err(MobileRemoteError::DispatchHandler)
    }
}

#[cfg(test)]
#[path = "mobile_remote_host_tests.rs"]
mod tests;
