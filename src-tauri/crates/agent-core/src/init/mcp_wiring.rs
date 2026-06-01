//! MCP server wiring for session initialization.
//!
//! Connects to MCP servers (via the shared `McpManager` on the Tauri app
//! handle), then registers their tools into the session's `ToolRegistry`.
//! Returns the list of tool names that should be auto-approved (i.e.
//! exempted from the human-in-the-loop permission prompt).
//!
//! These functions are split from session-runtime construction so callers
//! that need ad-hoc MCP wiring (e.g. test endpoints) can use them without
//! pulling in the full provider/policy assembly.

use std::collections::HashSet;

use tauri::Manager;
use tracing::info;
use tracing::warn;

use crate::mcp::commands::McpState;
use crate::tools::registry::ToolRegistry;

/// Connect to MCP servers and register their tools into the given registry.
///
/// Returns the auto-approved tool name list (MCP servers can mark tools as
/// `auto_approve: true` so the permission prompt is skipped).
///
/// **Filter semantics** — the underlying `register_mcp_tools` matches
/// its `disabled_tools` argument against the **MCP-namespaced** name
/// `mcp__<server>__<tool>` (see `bridge::register_mcp_tools`). The
/// `disabled_mcp_tools` parameter must therefore receive the
/// MCP-namespaced set (e.g. `AgentToolSelection.disabled_mcp_tools`),
/// not the builtin-tool blocklist; the latter lives in a disjoint
/// namespace and would silently filter nothing.
pub(super) async fn register_mcp_tools_from_app(
    app_handle: Option<&tauri::AppHandle>,
    tool_registry: &mut ToolRegistry,
    workspace: Option<&std::path::Path>,
    disabled_mcp_tools: Option<&HashSet<String>>,
    disabled_mcp_servers: Option<&HashSet<String>>,
    load_workspace_settings: bool,
    log_prefix: &str,
) -> Result<Vec<String>, String> {
    let Some(handle) = app_handle else {
        warn!("[{}] No app_handle — MCP tools unavailable", log_prefix);
        return Ok(Vec::new());
    };

    let mcp_state = handle.state::<McpState>();
    mcp_state
        .ensure_connected_with_workspace_scope(workspace, load_workspace_settings)
        .await;

    let auto_approved = crate::mcp::register_mcp_tools(
        tool_registry,
        &mcp_state.manager,
        disabled_mcp_tools,
        disabled_mcp_servers,
        workspace,
        load_workspace_settings,
    )
    .await?;

    let connected = mcp_state.manager.connected_count().await;
    if connected > 0 {
        info!("[{}] MCP: {} servers connected", log_prefix, connected);
    }

    Ok(auto_approved)
}
