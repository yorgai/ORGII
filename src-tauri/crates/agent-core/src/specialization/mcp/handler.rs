//! rmcp `ClientHandler` implementation for our MCP client.
//!
//! Converts rmcp's typed server-push notifications into our own
//! `HandlerEvent` enum, which is then fanned out to `ServerNotification`
//! by `client.rs` so the rest of the codebase keeps its existing
//! notification API surface.
//!
//! # Server-initiated sampling / elicitation
//!
//! The two `RoleClient` request methods `sampling/createMessage` and
//! `elicitation/create` are **explicitly denied** here. Rationale:
//!
//! 1. We advertise neither capability in `ClientInfo` (see
//!    `client::default_client_info` — it uses `ClientCapabilities::default()`
//!    which leaves both `sampling` and `elicitation` unset). A spec-compliant
//!    server therefore MUST NOT issue either request.
//! 2. If a misbehaving server issues one anyway we want a **loud, traceable**
//!    rejection (`tracing::warn!` with the request id + violated capability)
//!    rather than relying on rmcp's silent default. That is what The re-inject path can
//!    later upgrade to a UI-approval flow without restructuring wiring.
//!
//! The actual "build a denial response" logic lives in pure functions
//! (`deny_sampling_response`, `deny_elicitation_response`) so they are unit
//! testable without faking an entire `RequestContext`.

use rmcp::handler::client::progress::ProgressDispatcher;
use rmcp::handler::client::ClientHandler;
use rmcp::model::{
    ClientInfo, CreateElicitationResult, CreateMessageRequestMethod, CreateMessageRequestParams,
    CreateMessageResult, ElicitationAction, ErrorData as McpError, ProgressNotificationParam,
    ResourceUpdatedNotificationParam,
};
use rmcp::service::{NotificationContext, RequestContext};
use rmcp::RoleClient;
use tokio::sync::mpsc;
use tracing::warn;

#[derive(Debug, Clone)]
pub enum HandlerEvent {
    ToolListChanged,
    PromptListChanged,
    ResourceListChanged,
    ResourceUpdated(String),
}

/// Shared handler instance. It is `Clone`-able by design: rmcp takes `self`
/// by value on `serve`, but we also want to emit events before the handoff.
///
/// The handler additionally owns a [`ProgressDispatcher`] so
/// server-pushed `notifications/progress` can be routed to the caller
/// that issued the matching `tools/call`. The dispatcher is shared
/// (Arc-internally) so [`McpClient`] can call `subscribe(token)` before
/// it issues a progress-aware tool call.
#[derive(Clone)]
pub struct AgentClientHandler {
    tx: mpsc::Sender<HandlerEvent>,
    progress: ProgressDispatcher,
}

impl AgentClientHandler {
    pub fn new(tx: mpsc::Sender<HandlerEvent>) -> Self {
        Self {
            tx,
            progress: ProgressDispatcher::new(),
        }
    }

    /// Expose the shared dispatcher so `McpClient::call_tool_with_progress`
    /// can subscribe for a specific `ProgressToken` before sending the
    /// request. The returned handle's lifetime governs subscription:
    /// dropping it unsubscribes (see
    /// `ProgressSubscriber`'s `Drop` in rmcp).
    pub fn progress_dispatcher(&self) -> ProgressDispatcher {
        self.progress.clone()
    }
}

/// Build the `McpError` returned for every `sampling/createMessage` request.
///
/// Pure function: no I/O, no context needed. Unit-tested directly.
/// Matches rmcp's default-handler error (`method_not_found`) so servers see
/// standards-compliant rejection, but we emit the error ourselves so a
/// `warn!` line is guaranteed every time.
pub(crate) fn deny_sampling_response() -> McpError {
    McpError::method_not_found::<CreateMessageRequestMethod>()
}

/// Build the `CreateElicitationResult` returned for every
/// `elicitation/create` request. Spec-compliant "Decline" action with no
/// content — matches rmcp's default behavior but emitted explicitly so the
/// intent is visible in our tree.
pub(crate) fn deny_elicitation_response() -> CreateElicitationResult {
    CreateElicitationResult {
        action: ElicitationAction::Decline,
        content: None,
        meta: None,
    }
}

impl ClientHandler for AgentClientHandler {
    fn get_info(&self) -> ClientInfo {
        super::client::default_client_info()
    }

    async fn create_message(
        &self,
        _params: CreateMessageRequestParams,
        context: RequestContext<RoleClient>,
    ) -> Result<CreateMessageResult, McpError> {
        warn!(
            request_id = ?context.id,
            "mcp: server issued sampling/createMessage but client did not advertise \
             `sampling` capability; denying with method_not_found (The re-inject path may upgrade \
             this to a UI approval flow)"
        );
        Err(deny_sampling_response())
    }

    async fn create_elicitation(
        &self,
        _request: rmcp::model::CreateElicitationRequestParams,
        context: RequestContext<RoleClient>,
    ) -> Result<CreateElicitationResult, McpError> {
        warn!(
            request_id = ?context.id,
            "mcp: server issued elicitation/create but client did not advertise \
             `elicitation` capability; replying with ElicitationAction::Decline"
        );
        Ok(deny_elicitation_response())
    }

    async fn on_tool_list_changed(&self, _context: NotificationContext<RoleClient>) {
        let _ = self.tx.send(HandlerEvent::ToolListChanged).await;
    }

    async fn on_prompt_list_changed(&self, _context: NotificationContext<RoleClient>) {
        let _ = self.tx.send(HandlerEvent::PromptListChanged).await;
    }

    async fn on_resource_list_changed(&self, _context: NotificationContext<RoleClient>) {
        let _ = self.tx.send(HandlerEvent::ResourceListChanged).await;
    }

    async fn on_resource_updated(
        &self,
        params: ResourceUpdatedNotificationParam,
        _context: NotificationContext<RoleClient>,
    ) {
        let _ = self
            .tx
            .send(HandlerEvent::ResourceUpdated(params.uri))
            .await;
    }

    /// Forward progress notifications to the per-token
    /// subscriber. Callers who don't subscribe see their progress
    /// notifications silently dropped by the dispatcher (intentional —
    /// rmcp handles the "no subscriber" case internally by returning
    /// without side effects).
    async fn on_progress(
        &self,
        params: ProgressNotificationParam,
        _context: NotificationContext<RoleClient>,
    ) {
        self.progress.handle_notification(params).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::model::ErrorCode;

    #[test]
    fn deny_sampling_response_is_method_not_found() {
        let err = deny_sampling_response();
        assert_eq!(err.code, ErrorCode::METHOD_NOT_FOUND);
        assert!(
            err.message.to_lowercase().contains("method not found")
                || err.message.contains("sampling/createMessage"),
            "expected method-not-found message, got: {}",
            err.message
        );
    }

    #[test]
    fn deny_elicitation_response_is_decline_with_no_content() {
        let resp = deny_elicitation_response();
        assert!(matches!(resp.action, ElicitationAction::Decline));
        assert!(resp.content.is_none());
        assert!(resp.meta.is_none());
    }

    #[test]
    fn default_client_info_does_not_advertise_sampling_or_elicitation() {
        // The docstring above claims "We advertise neither capability
        // in ClientInfo". This test enforces that claim in code.
        let info = super::super::client::default_client_info();
        assert!(
            info.capabilities.sampling.is_none(),
            "client must not advertise `sampling` capability"
        );
        assert!(
            info.capabilities.elicitation.is_none(),
            "client must not advertise `elicitation` capability"
        );
    }
}
