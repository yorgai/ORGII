//! Dispatch user-defined tool-call hooks plus LSP post-edit diagnostics.
//!
//! `.orgii/hooks.json` hooks sit behind the hook executor. Post-tool LSP
//! diagnostics are wired into `post_tool_hook` for `edit_file` / `apply_patch`
//! only.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::Value;
use tracing::info;

use crate::specialization::hooks::events::HookContext;
use crate::specialization::hooks::{HookEvent, HookExecutor};
use crate::tools::impls::coding::query_lsp::get_post_edit_diagnostics;
use crate::tools::names as tool_names;
use crate::turn_executor::ToolHookIntervention;

use super::helpers::parse_hook_decision;

/// Run user-defined PreToolUse hooks.
///
/// Returns the first intervention found. Hook stdout is parsed via
/// `parse_hook_decision`.
pub(super) async fn dispatch_pre_tool(
    hook_executor: Option<&Arc<HookExecutor>>,
    session_id: &str,
    tool_name: &str,
    args: &Value,
) -> Option<ToolHookIntervention> {
    if let Some(executor) = hook_executor {
        if executor.has_hooks_for(HookEvent::PreToolUse) {
            let ctx = HookContext::for_tool(session_id, tool_name, "")
                .with_var("ORGII_TOOL_ARGS", args.to_string());
            let results = executor.run(HookEvent::PreToolUse, &ctx).await;
            for hook_result in &results {
                if !hook_result.success && !hook_result.stderr.is_empty() {
                    info!(
                        "[unified_handler] PreToolUse hook stderr: {}",
                        &hook_result.stderr[..hook_result.stderr.len().min(200)]
                    );
                }
                if let Some(intervention) = parse_hook_decision(&hook_result.stdout) {
                    return Some(intervention);
                }
            }
        }
    }

    None
}

/// Run user-defined `Stop` hooks synchronously and return blocking
/// feedback, if any.
///
/// A hook blocks the turn from ending by printing
/// `{"decision":"block","message":"..."}` on stdout (same JSON contract as
/// PreToolUse deny). The message is returned so the turn loop can inject
/// it and continue; non-blocking hooks (any other output) let the turn
/// end normally.
pub(super) async fn dispatch_stop_check(
    hook_executor: Option<&Arc<HookExecutor>>,
    session_id: &str,
) -> Option<String> {
    let executor = hook_executor?;
    if !executor.has_hooks_for(HookEvent::Stop) {
        return None;
    }
    let ctx = HookContext::for_session(session_id);
    let results = executor.run(HookEvent::Stop, &ctx).await;
    for hook_result in &results {
        if !hook_result.success && !hook_result.stderr.is_empty() {
            info!(
                "[unified_handler] Stop hook stderr: {}",
                &hook_result.stderr[..hook_result.stderr.len().min(200)]
            );
        }
        if let Some(message) = parse_stop_block(&hook_result.stdout) {
            return Some(message);
        }
    }
    None
}

/// Parse a Stop hook's stdout for a blocking decision.
fn parse_stop_block(stdout: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(stdout.trim()).ok()?;
    let decision = parsed.get("decision").and_then(Value::as_str)?;
    if decision != "block" {
        return None;
    }
    Some(
        parsed
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("A Stop hook blocked this completion. Continue working on the task.")
            .to_string(),
    )
}

/// Fire user-defined PostToolUse hooks in the background.
#[allow(clippy::too_many_arguments)]
pub(super) async fn dispatch_post_tool(
    hook_executor: Option<&Arc<HookExecutor>>,
    session_id: &str,
    tool_name: &str,
    result: &str,
    error: Option<&str>,
    duration_ms: u64,
) {
    if let Some(executor) = hook_executor {
        if executor.has_hooks_for(HookEvent::PostToolUse) {
            let ctx = HookContext::for_tool(session_id, tool_name, "")
                .with_var("ORGII_TOOL_RESULT", &result[..result.len().min(5000)])
                .with_var("ORGII_TOOL_DURATION_MS", duration_ms.to_string())
                .with_var("ORGII_TOOL_ERROR", error.unwrap_or("").to_string());
            let hook_executor = executor.clone();
            tokio::spawn(async move {
                hook_executor.run(HookEvent::PostToolUse, &ctx).await;
            });
        }
    }
}

/// LSP post-edit diagnostics — only fires for successful `edit_file` /
/// `apply_patch` calls. Returns the diagnostic summary string the
/// turn_executor will splice into the assistant context.
pub(super) async fn lsp_post_edit_diagnostics(
    lsp_manager: Option<&Arc<tokio::sync::Mutex<lsp::LspManager>>>,
    app_handle: Option<&tauri::AppHandle>,
    workspace_path: Option<&std::path::PathBuf>,
    tool_name: &str,
    args: &Value,
    result: &str,
) -> Option<String> {
    if result.starts_with("Error") {
        return None;
    }

    let is_file_mod = matches!(tool_name, tool_names::EDIT_FILE | tool_names::APPLY_PATCH);
    if !is_file_mod {
        return None;
    }

    let manager = lsp_manager?;
    let app_handle = app_handle?;
    let workspace_path = workspace_path?;
    let file_path = extract_modified_file_path(args, workspace_path)?;
    get_post_edit_diagnostics(manager, app_handle, workspace_path, &file_path).await
}

fn extract_modified_file_path(args: &Value, workspace_path: &Path) -> Option<String> {
    let raw_path = args
        .get("file_path")
        .or_else(|| args.get("filePath"))
        .or_else(|| args.get("path"))
        .and_then(Value::as_str)?;
    let path = PathBuf::from(raw_path);
    let absolute_path = if path.is_absolute() {
        path
    } else {
        workspace_path.join(path)
    };
    Some(absolute_path.to_string_lossy().into_owned())
}
