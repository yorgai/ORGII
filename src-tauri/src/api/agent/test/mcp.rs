//! `/agent/test/mcp/*` endpoints (debug-only).
//!
//! Debug probes for MCP server notifications, prompts cache, progress
//! events, tool listing/calling, and server lifecycle (inject /
//! disconnect / reconnect). Used by the E2E `mcp` group to prove the
//! manager wiring without depending on a live server.

#![cfg(debug_assertions)]

use axum::Json;
use serde::Deserialize;

/// Return a snapshot of the manager-level `NotificationCounters`. Used by
/// the E2E `mcp` group to assert that the notification listener fires on
/// each MCP notification kind. Unlike recovery counters, these are not
/// per-session — they're per-manager.
///
/// Response shape mirrors `NotificationCountersSnapshot`:
/// ```json
/// {
///   "toolsRefreshed": 0,
///   "resourcesListChanged": 0,
///   "resourcesUpdated": 0,
///   "promptsListChangedNoop": 0,
///   "unknown": 0
/// }
/// ```
pub(crate) fn mcp_manager_from_state() -> Option<std::sync::Arc<agent_core::mcp::McpManager>> {
    use tauri::Manager;
    let handle = crate::api::get_app_handle()?;
    let state = handle.state::<agent_core::mcp::commands::McpState>();
    Some(std::sync::Arc::clone(&state.manager))
}

pub async fn test_mcp_notification_counters() -> Json<serde_json::Value> {
    let manager = match mcp_manager_from_state() {
        Some(m) => m,
        None => {
            return Json(serde_json::json!({
                "error": "AppHandle or McpState not initialized"
            }))
        }
    };
    Json(
        serde_json::to_value(manager.notification_counters())
            .unwrap_or_else(|_| serde_json::json!({})),
    )
}

/// Reset all MCP notification counters to zero. Called at the start of
/// each E2E scenario.
pub async fn test_mcp_notification_counters_reset() -> Json<serde_json::Value> {
    let manager = match mcp_manager_from_state() {
        Some(m) => m,
        None => {
            return Json(serde_json::json!({
                "error": "AppHandle or McpState not initialized"
            }))
        }
    };
    manager.reset_notification_counters();
    Json(serde_json::json!({ "ok": true }))
}

#[derive(Debug, Deserialize)]
pub struct McpInjectNotificationRequest {
    /// Name of a connected MCP server (e.g. `"e2e-mcp"`). The injection
    /// fails if the server isn't connected — it has to share a real
    /// `McpClient`'s channel so the listener task actually receives it.
    server_name: String,
    /// Raw MCP method, e.g. `"notifications/resources/list_changed"`.
    /// Arbitrary strings are accepted so we can also exercise the
    /// `unknown` counter branch.
    method: String,
    /// Optional `params` payload. For `notifications/resources/updated`
    /// callers typically pass `{ "uri": "file:///foo" }`.
    #[serde(default)]
    params: Option<serde_json::Value>,
}

/// Push a synthetic notification into a connected MCP server's channel
/// so the manager's background listener handles it exactly like a real
/// server-emitted notification. The listener runs asynchronously on a
/// separate task, so callers should poll the counters endpoint for the
/// expected delta rather than assume the state has updated by the time
/// this call returns.
pub async fn test_mcp_inject_notification(
    Json(request): Json<McpInjectNotificationRequest>,
) -> Json<serde_json::Value> {
    let manager = match mcp_manager_from_state() {
        Some(m) => m,
        None => {
            return Json(serde_json::json!({
                "ok": false,
                "error": "AppHandle or McpState not initialized"
            }))
        }
    };
    match manager
        .debug_inject_notification(&request.server_name, &request.method, request.params)
        .await
    {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(err) => Json(serde_json::json!({ "ok": false, "error": err })),
    }
}

// ─── MCP prompt debug endpoints ─────────────────────────────────────────────
//
// These mirror the user-facing `mcp_list_prompts` / `mcp_get_prompt` /
// `mcp_render_prompt` Tauri commands but live on the debug HTTP port so
// the `e2e-test` binary can exercise them without driving the Tauri IPC
// channel. They go through the exact same `McpManager` entry points as
// the Tauri commands so there's no second code path — if the debug
// endpoints pass, the Tauri commands pass.

#[derive(Debug, Deserialize)]
pub struct McpServerNameRequest {
    server_name: String,
}

#[derive(Debug, Deserialize)]
pub struct McpGetPromptRequest {
    server_name: String,
    prompt_name: String,
    /// Optional `{ argName: value }` object. `None` means the caller
    /// omitted the field entirely (no arguments). An explicit JSON `null`
    /// is rejected upstream by `mcp_get_prompt` so the wire layer can
    /// distinguish "no arguments" from "explicit null" (patch semantics).
    #[serde(default)]
    arguments: Option<serde_json::Map<String, serde_json::Value>>,
}

pub async fn test_mcp_list_prompts(
    Json(request): Json<McpServerNameRequest>,
) -> Json<serde_json::Value> {
    let manager = match mcp_manager_from_state() {
        Some(m) => m,
        None => {
            return Json(serde_json::json!({
                "ok": false,
                "error": "AppHandle or McpState not initialized"
            }))
        }
    };
    match manager.list_prompts(&request.server_name).await {
        Ok(prompts) => Json(serde_json::json!({ "ok": true, "prompts": prompts })),
        Err(err) => Json(serde_json::json!({ "ok": false, "error": err })),
    }
}

/// Aggregate prompts from every connected server, same surface as the
/// `mcp_list_all_prompts` Tauri command. Useful for the E2E scenario
/// that verifies prompts are fanned out into the global slash registry
/// with the `mcp__<server>__<prompt>` naming convention.
pub async fn test_mcp_list_all_prompts() -> Json<serde_json::Value> {
    let manager = match mcp_manager_from_state() {
        Some(m) => m,
        None => {
            return Json(serde_json::json!({
                "ok": false,
                "error": "AppHandle or McpState not initialized"
            }))
        }
    };
    let pairs = manager.all_prompts().await;
    let entries: Vec<serde_json::Value> = pairs
        .into_iter()
        .map(|(server_name, prompt)| {
            serde_json::json!({
                "name": format!("mcp__{}__{}", server_name, prompt.name),
                "serverName": server_name,
                "prompt": prompt,
            })
        })
        .collect();
    Json(serde_json::json!({ "ok": true, "prompts": entries }))
}

pub async fn test_mcp_get_prompt(
    Json(request): Json<McpGetPromptRequest>,
) -> Json<serde_json::Value> {
    let manager = match mcp_manager_from_state() {
        Some(m) => m,
        None => {
            return Json(serde_json::json!({
                "ok": false,
                "error": "AppHandle or McpState not initialized"
            }))
        }
    };
    match manager
        .get_prompt(
            &request.server_name,
            &request.prompt_name,
            request.arguments,
        )
        .await
    {
        Ok(rendered) => Json(serde_json::json!({ "ok": true, "rendered": rendered })),
        Err(err) => Json(serde_json::json!({ "ok": false, "error": err })),
    }
}

/// Returns `{ ok: true, cached: bool }` — whether `list_prompts` for
/// the given server currently has a memoized value. E2E flow:
///   1. cache-has → false (fresh state)
///   2. list_prompts → populates cache
///   3. cache-has → true
///   4. inject `notifications/prompts/list_changed`
///   5. poll cache-has → flips back to false (cache invalidated)
pub async fn test_mcp_prompts_cache_has(
    Json(request): Json<McpServerNameRequest>,
) -> Json<serde_json::Value> {
    let manager = match mcp_manager_from_state() {
        Some(m) => m,
        None => {
            return Json(serde_json::json!({
                "ok": false,
                "error": "AppHandle or McpState not initialized"
            }))
        }
    };
    let cached = manager.debug_prompts_cache_has(&request.server_name).await;
    Json(serde_json::json!({ "ok": true, "cached": cached }))
}

// ─── MCP tool progress debug endpoints ──────────────────────────────────────
//
// Full end-to-end progress streaming needs a live MCP server that emits
// `notifications/progress` mid-`tools/call`. E2E can't assume one is
// present. So the minimum contract we lock down here is:
//
// 1. The shape of `NotificationCountersSnapshot` includes
//    `toolProgressTotal` (covered by the shape test in
//    `crates/e2e-test/src/mcp.rs::counters_snapshot_shape`).
// 2. The counter is monotonic — a debug bump increments it, and
//    `reset_notification_counters` zeroes it back. This endpoint pokes
//    the counter directly so the snapshot <-> reset <-> bump cycle is
//    observable without a live MCP server.
//
// The production path (real progress ticks) bumps the same counter
// via `call_tool_with_progress` → `bump_tool_progress`. This probe
// pokes that same atomic directly. It is a **symbol-pinning probe**
// for the counter wiring (positive match for "the counter we claim
// exists is wired"); it does not exercise the production bump path
// (`call_tool_with_progress`), so a regression that drops that
// upstream call would not surface here.

/// POST `/agent/test/mcp/progress-bump`: synthetically increments the
/// `toolProgressTotal` counter by 1. Debug-only.
pub async fn test_mcp_progress_bump() -> Json<serde_json::Value> {
    let manager = match mcp_manager_from_state() {
        Some(m) => m,
        None => {
            return Json(serde_json::json!({
                "ok": false,
                "error": "AppHandle or McpState not initialized"
            }))
        }
    };
    manager.notification_counters_handle().bump_tool_progress();
    Json(serde_json::json!({ "ok": true }))
}

/// POST `/agent/test/mcp/emit-progress-event`: **symbol-pinning probe**
/// for the `agent:mcp_progress` broadcast schema. Mirrors
/// `McpBridgeTool::execute`'s progress callback exactly — bumps
/// `toolProgressTotal` AND broadcasts an `agent:mcp_progress` event on
/// the WS bus with the exact same schema the real code emits.
/// Consumers that want to assert "the frontend actually receives the
/// event" can subscribe on the WS side. This pins the schema /
/// counter / broadcast contract; it does **not** exercise
/// `McpBridgeTool::execute` itself — a regression where the real
/// progress callback stops firing would not surface here.
///
/// Body (all fields optional, patch-style — null vs missing matters):
///   `{ "sessionId": "...", "toolCallId": "...", "toolName": "mcp_x_y",
///      "progress": 42.0, "total": 100.0, "message": "halfway" }`
///
/// Absent keys fall back to defaults; explicit `null` on `total` /
/// `message` is preserved in the emitted payload (distinguishes
/// "unbounded spinner" from "we simply didn't set it").
pub async fn test_mcp_emit_progress_event(
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let manager = match mcp_manager_from_state() {
        Some(m) => m,
        None => {
            return Json(serde_json::json!({
                "ok": false,
                "error": "AppHandle or McpState not initialized"
            }))
        }
    };

    let obj = body.as_object();
    let session_id = obj
        .and_then(|o| o.get("sessionId"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let tool_call_id = obj
        .and_then(|o| o.get("toolCallId"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let tool_name = obj
        .and_then(|o| o.get("toolName"))
        .and_then(|v| v.as_str())
        .unwrap_or("mcp_test_tool")
        .to_string();
    let progress = obj
        .and_then(|o| o.get("progress"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    // Patch-semantics: preserve missing vs explicit null for total/message.
    let total = obj
        .and_then(|o| o.get("total"))
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let message = obj
        .and_then(|o| o.get("message"))
        .cloned()
        .unwrap_or(serde_json::Value::Null);

    manager.notification_counters_handle().bump_tool_progress();
    agent_core::bus::broadcast_event(
        "agent:mcp_progress",
        serde_json::json!({
            "sessionId": session_id,
            "toolCallId": tool_call_id,
            "toolName": tool_name,
            "progress": progress,
            "total": total,
            "message": message,
        }),
    );
    Json(serde_json::json!({ "ok": true }))
}

// ─── MCP end-to-end server test endpoints ───────────────────────────────────
//
// Reason for existence: the notification/progress endpoints above exercise
// internal plumbing (synthetic injection, counter bumping), but they never
// prove that the `rmcp` client can actually *talk* to a real stdio MCP
// server from inside the app's event loop — list its tools, invoke one,
// get structured output back. Manual testing revealed the
// filesystem MCP server connected fine but `call_tool` was never verified
// through the app's own code path. These three endpoints close that gap by
// driving `McpManager::connect_server` / `server_tools` / `call_tool`
// directly from HTTP so the E2E binary can run a full
// Add → list_tools → call_tool → teardown scenario.
//
// Naming: `inject-server` / `list-tools` / `call-tool` mirrors the
// filesystem server's own method names so scenarios read naturally.

#[derive(Debug, Deserialize)]
pub struct McpInjectServerRequest {
    server_name: String,
    config: agent_core::mcp::config::McpServerConfig,
}

/// POST `/agent/test/mcp/inject-server`: in-memory only. Connects a
/// server directly via `McpManager::connect_server` without touching
/// `~/.orgii/mcp-servers.json`, so scenarios don't pollute the user's
/// config file. Idempotent: calling with the same name replaces the
/// previous entry (disconnect + reconnect).
pub async fn test_mcp_inject_server(
    Json(request): Json<McpInjectServerRequest>,
) -> Json<serde_json::Value> {
    let manager = match mcp_manager_from_state() {
        Some(m) => m,
        None => {
            return Json(serde_json::json!({
                "ok": false,
                "error": "AppHandle or McpState not initialized"
            }))
        }
    };
    manager.disconnect_server(&request.server_name).await;
    match manager
        .connect_server(&request.server_name, &request.config)
        .await
    {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(err) => Json(serde_json::json!({ "ok": false, "error": err })),
    }
}

#[derive(Debug, Deserialize)]
pub struct McpListToolsRequest {
    server_name: String,
}

/// POST `/agent/test/mcp/list-tools`: aggregates `McpManager::server_tools`
/// for the given connected server. Returns the full `McpToolDef` array so
/// scenarios can assert both tool count AND a specific tool name is
/// present (positive + negative match).
pub async fn test_mcp_list_tools(
    Json(request): Json<McpListToolsRequest>,
) -> Json<serde_json::Value> {
    let manager = match mcp_manager_from_state() {
        Some(m) => m,
        None => {
            return Json(serde_json::json!({
                "ok": false,
                "error": "AppHandle or McpState not initialized"
            }))
        }
    };
    match manager.server_tools(&request.server_name).await {
        Ok(tools) => Json(serde_json::json!({
            "ok": true,
            "toolCount": tools.len(),
            "tools": tools,
        })),
        Err(err) => Json(serde_json::json!({ "ok": false, "error": err })),
    }
}

#[derive(Debug, Deserialize)]
pub struct McpCallToolRequest {
    server_name: String,
    tool_name: String,
    #[serde(default)]
    arguments: serde_json::Value,
}

/// POST `/agent/test/mcp/call-tool`: drives `McpManager::call_tool` end
/// to end. Returns the text result on success; scenarios assert the
/// output contains the expected payload (e.g. file contents).
pub async fn test_mcp_call_tool(
    Json(request): Json<McpCallToolRequest>,
) -> Json<serde_json::Value> {
    let manager = match mcp_manager_from_state() {
        Some(m) => m,
        None => {
            return Json(serde_json::json!({
                "ok": false,
                "error": "AppHandle or McpState not initialized"
            }))
        }
    };
    let arguments = if request.arguments.is_null() {
        serde_json::json!({})
    } else {
        request.arguments
    };
    match manager
        .call_tool(&request.server_name, &request.tool_name, arguments)
        .await
    {
        Ok(text) => Json(serde_json::json!({ "ok": true, "text": text })),
        Err(err) => Json(serde_json::json!({ "ok": false, "error": err })),
    }
}

/// POST `/agent/test/mcp/disconnect-server`: teardown counterpart for
/// `inject-server`. Idempotent — disconnecting an unknown server is a
/// no-op.
pub async fn test_mcp_disconnect_server(
    Json(request): Json<McpListToolsRequest>,
) -> Json<serde_json::Value> {
    let manager = match mcp_manager_from_state() {
        Some(m) => m,
        None => {
            return Json(serde_json::json!({
                "ok": false,
                "error": "AppHandle or McpState not initialized"
            }))
        }
    };
    manager.disconnect_server(&request.server_name).await;
    Json(serde_json::json!({ "ok": true }))
}

/// POST `/agent/test/mcp/reconnect-server`: kill the current process for
/// `server_name` and re-spawn it from its on-disk config. Stdio servers
/// like `@modelcontextprotocol/server-memory` hold their entire state in
/// the child process, so this is also how an E2E scenario gets a
/// guaranteed clean slate between runs that share the same
/// app-wide `McpState`.
///
/// Returns `{ok: true}` even if the server wasn't connected, because
/// `reconnect_server` handles the not-found case by attempting a fresh
/// connect from config. Errors surface as `{ok: false, error: "..."}`.
pub async fn test_mcp_reconnect_server(
    Json(request): Json<McpListToolsRequest>,
) -> Json<serde_json::Value> {
    let manager = match mcp_manager_from_state() {
        Some(m) => m,
        None => {
            return Json(serde_json::json!({
                "ok": false,
                "error": "AppHandle or McpState not initialized"
            }))
        }
    };
    match manager.reconnect_server(&request.server_name).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(err) => Json(serde_json::json!({ "ok": false, "error": err })),
    }
}

/// POST `/agent/test/mcp/invalid-config-preserved`: **symbol-pinning
/// probe** for the `insert_server_config` helper used by registry
/// install commands. Creates a temporary MCP config file with invalid
/// JSON, calls the helper directly, and asserts the bad file was not
/// overwritten with an empty config. Pins the helper's
/// "no-clobber-on-corruption" contract; the registry-install caller
/// path itself is exercised separately.
pub async fn test_mcp_invalid_config_preserved() -> Json<serde_json::Value> {
    let dir = std::env::temp_dir().join(format!(
        "orgii-e2e-mcp-invalid-config-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ));
    if let Err(err) = std::fs::create_dir_all(&dir) {
        return Json(serde_json::json!({ "ok": false, "error": err.to_string() }));
    }

    let path = dir.join("mcp-servers.json");
    let original = "{not valid json";
    if let Err(err) = std::fs::write(&path, original) {
        return Json(serde_json::json!({ "ok": false, "error": err.to_string() }));
    }

    let server_config = agent_core::mcp::config::McpServerConfig {
        transport_type: agent_core::mcp::config::McpTransportType::Stdio,
        command: Some("e2e-mcp-server".to_string()),
        args: None,
        cwd: None,
        env: None,
        url: None,
        headers: None,
        auto_approve: None,
        disabled: false,
        timeout: 30,
    };

    let result = agent_core::mcp::config::insert_server_config(
        &path,
        "e2e-invalid".to_string(),
        server_config,
    );
    // The assertion below is `result.is_err() && after == original`,
    // so a silent default of `String::new()` on read failure could
    // make `after == original` trivially true if `original` is
    // also empty — masking a corrupted MCP config that the test
    // is supposed to catch. Surface the read failure so the test
    // runner can distinguish "file preserved" from "couldn't
    // re-read file".
    let after = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(err) => {
            tracing::warn!(
                path = %path.display(),
                error = %err,
                "test::mcp::insert_invalid: post-write read failed; preserving=? assertion may be unreliable"
            );
            String::new()
        }
    };
    let _ = std::fs::remove_dir_all(&dir);

    Json(serde_json::json!({
        "ok": result.is_err() && after == original,
        "error": result.err(),
        "preserved": after == original,
    }))
}
