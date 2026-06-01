//! Channel workspace-tool registration.
//!
//! Registers `list_known_workspaces`, `add_workspace_directory`,
//! `remove_workspace_directory`, and `list_session_workspace`.
//! These are available to any session; channel-attached sessions
//! (OS agent) get automatic target-session resolution via
//! `ChannelContext`.

use std::collections::HashSet;

use crate::tools::impls::orchestration::channel::{
    AddWorkspaceDirectoryTool, ListKnownWorkspacesTool, ListSessionWorkspaceTool,
    RemoveWorkspaceDirectoryTool,
};
use crate::tools::registry::ToolRegistry;

use super::{register_if_enabled, ToolDeps};

pub fn register(registry: &mut ToolRegistry, deps: &ToolDeps, disabled: &HashSet<String>) {
    let Some(ref handle) = deps.app_handle else {
        return;
    };

    let ctx = deps.channel_context.clone();

    register_if_enabled(registry, Box::new(ListKnownWorkspacesTool::new()), disabled);

    // Workspace mutators the OS agent calls silently in response to
    // natural-language path mentions. Each tool resolves the target
    // session from the per-chat binding when `target_session_id` is
    // omitted; `channel_ctx` gives them `(channel, chat_id, sender_id)`
    // for that resolution.
    register_if_enabled(
        registry,
        Box::new(AddWorkspaceDirectoryTool::new(handle.clone(), ctx.clone())),
        disabled,
    );
    register_if_enabled(
        registry,
        Box::new(RemoveWorkspaceDirectoryTool::new(
            handle.clone(),
            ctx.clone(),
        )),
        disabled,
    );
    register_if_enabled(
        registry,
        Box::new(ListSessionWorkspaceTool::new(handle.clone(), ctx.clone())),
        disabled,
    );
}
