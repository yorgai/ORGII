//! Per-tool-call file_history snapshot capture.
//!
//! Before a file-modifying tool runs, capture the current bytes of every
//! file the tool is about to touch into a per-session backup pool under
//! `~/.orgii/file-history/<session_id>/`. Rewinding only ever touches files
//! captured here, so concurrent sessions editing the same project never
//! step on each other's blobs.

use std::path::{Path, PathBuf};

use serde_json::Value;
use tracing::{info, warn};

use super::super::super::persistence as unified_persistence;
use super::super::streaming::is_file_modifying_tool;

/// Take a snapshot of every file the upcoming tool call is about to modify.
///
/// `workspace_root` is `None` for handlers built without a workspace path
/// (background agents, tests) — in which case we no-op.
pub(super) fn take_snapshot(
    workspace_root: Option<&Path>,
    session_id: &str,
    tool_call_id: &str,
    tool_name: &str,
    args: &Value,
) {
    let Some(workspace_root) = workspace_root else {
        return;
    };

    if !is_file_modifying_tool(tool_name) {
        return;
    }

    let args_str = args.to_string();
    let rel_paths =
        crate::persistence::session_snapshots::extract_paths_from_tool_input(tool_name, &args_str);
    let abs_paths: Vec<PathBuf> = rel_paths
        .into_iter()
        .filter(|p| !p.trim().is_empty())
        .map(|p| {
            let candidate = PathBuf::from(&p);
            if candidate.is_absolute() {
                candidate
            } else {
                workspace_root.join(p)
            }
        })
        .collect();

    if abs_paths.is_empty() {
        warn!(
            "[unified_handler] skipped file_history snapshot before {} because no file paths were extractable",
            tool_name
        );
        return;
    }

    match crate::tools::file_history::make_tool_snapshot(session_id, &abs_paths) {
        Ok(snapshot_id) => {
            info!(
                "[unified_handler] file_history snapshot before {} ({} file(s)): {}",
                tool_name,
                abs_paths.len(),
                snapshot_id
            );
            match unified_persistence::save_snapshot(session_id, tool_call_id, &snapshot_id) {
                Ok(()) => info!(
                    "[unified_handler] persisted file_history snapshot row session={} tool_call_id={} snapshot={}",
                    session_id, tool_call_id, snapshot_id
                ),
                Err(err) => warn!("[unified_handler] Failed to persist snapshot row: {}", err),
            }
        }
        Err(err) => {
            warn!(
                "[unified_handler] file_history snapshot failed before {}: {}",
                tool_name, err
            );
        }
    }
}
