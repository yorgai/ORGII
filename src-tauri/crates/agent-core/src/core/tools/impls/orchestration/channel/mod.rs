//! Channel-attached workspace tools.
//!
//! When the OS agent is bound to a chat channel (Telegram, Discord, …) the
//! tools in this module let it grant/revoke directory access on the per-chat
//! session as conversations move across projects, without forcing the user to
//! learn `/add-dir` jargon.
//!
//! Also exports the [`REINJECT_CHANNEL`] marker used by the channel inbound
//! handler to distinguish re-injected messages from genuine external traffic.

mod add_workspace_directory;
mod list_known_workspaces;
mod list_session_workspace;
mod remove_workspace_directory;

pub use add_workspace_directory::AddWorkspaceDirectoryTool;
pub use list_known_workspaces::ListKnownWorkspacesTool;
pub use list_session_workspace::ListSessionWorkspaceTool;
pub use remove_workspace_directory::RemoveWorkspaceDirectoryTool;

use std::sync::Arc;
use tauri::Manager;

use crate::bus::InboundMessage;
use crate::channels::config::ChannelsConfig;
use crate::gateway::SessionKey;
use crate::tools::registration::ChannelContext;
use crate::tools::traits::{optional_string, ToolError};

/// Reserved `channel` value on a re-injected `InboundMessage`.
///
/// The channel inbound handler (`state::commands::channel_handler::GatewayInboundHandler`)
/// short-circuits its "create/resolve OS session" flow when it sees this
/// channel, treating `session_key_override` as the authoritative target
/// session id.
pub const REINJECT_CHANNEL: &str = "gateway-reinject";

// ------------------------------------------------------------------
// Shared channel-context cell
// ------------------------------------------------------------------

/// Shared, mutable channel-context cell for workspace-mutator tools.
///
/// When the OS agent is running against a channel-attached session, the tool
/// registry calls `Tool::set_context(channel, chat_id, sender_id)` on each
/// tool at the start of every turn (dispatcher: `process_message` via
/// `set_all_contexts`). Workspace tools store that triple here so they can
/// default `target_session_id` to the per-chat OS session derived from the
/// binding store when the LLM omits the explicit param.
pub(super) type ChannelCtxCell = Arc<parking_lot::RwLock<Option<ChannelContext>>>;

/// Read (channel, chat_id, sender_id) from the cell, returning empty strings
/// when unset. The tool execute path treats empty strings as "no channel
/// context, require explicit `target_session_id`".
pub(super) fn has_ctx(cell: &ChannelCtxCell) -> bool {
    let guard = cell.read();
    guard
        .as_ref()
        .is_some_and(|ctx| !ctx.channel.is_empty() && !ctx.chat_id.is_empty())
}

pub(super) fn read_ctx(cell: &ChannelCtxCell) -> (String, String, String) {
    let guard = cell.read();
    match guard.as_ref() {
        Some(ctx) => (
            ctx.channel.clone(),
            ctx.chat_id.clone(),
            ctx.sender_id.clone(),
        ),
        None => (String::new(), String::new(), String::new()),
    }
}

pub(super) fn make_cell(initial: Option<ChannelContext>) -> ChannelCtxCell {
    Arc::new(parking_lot::RwLock::new(initial))
}

/// Resolve the target session id for a workspace-mutator tool call.
///
/// Prefers the explicit `target_session_id` param so power-users / tests can
/// address a specific session; falls back to the per-chat binding derived
/// from the current channel context so the LLM can omit the param in the
/// common case. Returns `InvalidParams` with a clear, actionable message when
/// neither is available.
pub(super) async fn resolve_target_session_id(
    app_handle: &tauri::AppHandle,
    params: &serde_json::Value,
    channel_ctx: &ChannelCtxCell,
) -> Result<String, ToolError> {
    if let Some(explicit) = optional_string(params, "target_session_id") {
        return Ok(explicit);
    }

    let (ctx_channel, ctx_chat, ctx_sender) = read_ctx(channel_ctx);
    if ctx_channel.is_empty() || ctx_chat.is_empty() {
        return Err(ToolError::InvalidParams(
            "No channel context available. Pass an explicit `target_session_id`.".to_string(),
        ));
    }

    let state = app_handle.state::<crate::state::AgentAppState>();
    let channels_cfg: ChannelsConfig = state.integrations.snapshot().channels;
    let probe = InboundMessage::new(&ctx_channel, &ctx_sender, &ctx_chat, "");
    let key = SessionKey::from_inbound(&probe, &channels_cfg);
    state
        .gateway_bindings
        .get(&key)
        .await
        .map(|b| b.target_session_id)
        .ok_or_else(|| {
            ToolError::InvalidParams(
                "No session bound to this chat yet. Send a message first, or \
                 pass an explicit `target_session_id`."
                    .to_string(),
            )
        })
}
