//! File modification-time tracker for stale-edit detection
//!
//! After each tool call that writes a file, the turn executor records the
//! file's `mtime`. On subsequent write calls, it checks whether the file has
//! been modified externally since the last write and surfaces a warning if so.

use std::collections::HashMap;
use std::time::SystemTime;

use serde_json::Value;

use crate::tools::names as tool_names;

// ============================================
// FileTime Tracker
// ============================================

/// Tracks file modification times to detect stale edits.
///
/// When a file is read (via `read_file`), its mtime is recorded.
/// Before a file-modifying tool (`edit_file`, `apply_patch`)
/// executes, the tracker checks that the file hasn't been modified
/// since the last read. If stale, the tool call is rejected with an
/// error asking the agent to re-read the file.
#[derive(Debug, Clone, Default)]
pub struct FileTimeTracker {
    /// file_path → last-read mtime
    read_times: HashMap<String, SystemTime>,
    /// Insertion order for FIFO eviction (HashMap iteration is unordered)
    insertion_order: Vec<String>,
}

const MAX_FILE_TRACKER_ENTRIES: usize = 500;

impl FileTimeTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns true if no files have been tracked.
    pub fn is_empty(&self) -> bool {
        self.read_times.is_empty()
    }

    /// Returns the number of tracked files.
    pub fn len(&self) -> usize {
        self.read_times.len()
    }

    /// Record the current mtime of a file after a successful read.
    pub fn record_read(&mut self, file_path: &str) {
        if let Ok(metadata) = std::fs::metadata(file_path) {
            if let Ok(mtime) = metadata.modified() {
                let is_new = !self.read_times.contains_key(file_path);
                if is_new && self.read_times.len() >= MAX_FILE_TRACKER_ENTRIES {
                    if let Some(oldest_key) = self.insertion_order.first().cloned() {
                        self.read_times.remove(&oldest_key);
                        self.insertion_order.remove(0);
                    }
                }
                self.read_times.insert(file_path.to_string(), mtime);
                if is_new {
                    self.insertion_order.push(file_path.to_string());
                }
            }
        }
    }

    /// Check if a file has been modified since the last recorded read.
    /// Returns Ok(()) if safe to edit, Err(message) if stale.
    /// Files that were never read always pass (the edit tool itself
    /// may enforce read-before-edit via its description).
    pub fn assert_fresh(&self, file_path: &str) -> Result<(), String> {
        let Some(recorded_mtime) = self.read_times.get(file_path) else {
            return Ok(()); // Never read — let the tool handle it
        };

        let current_mtime = std::fs::metadata(file_path)
            .and_then(|m| m.modified())
            .map_err(|err| format!("Cannot stat {}: {}", file_path, err))?;

        if current_mtime > *recorded_mtime {
            return Err(format!(
                "File was modified since you last read it: {}. Read it again before editing.",
                file_path
            ));
        }

        Ok(())
    }

    /// Record a write — update the tracked mtime after a successful edit/write.
    pub fn record_write(&mut self, file_path: &str) {
        if let Ok(metadata) = std::fs::metadata(file_path) {
            if let Ok(mtime) = metadata.modified() {
                self.read_times.insert(file_path.to_string(), mtime);
            }
        }
    }
}

/// Tools that read files — we track their mtime after execution.
pub(super) const FILE_READ_TOOLS: &[&str] = &[tool_names::READ_FILE];

/// Tools that modify files — we check mtime before execution.
pub(super) const FILE_WRITE_TOOLS: &[&str] = &[
    tool_names::EDIT_FILE,
    tool_names::DELETE_FILE,
    tool_names::APPLY_PATCH,
];

pub(crate) fn is_file_write_tool(tool_name: &str) -> bool {
    FILE_WRITE_TOOLS.contains(&tool_name)
}

/// Extract file path(s) from tool arguments for FileTime tracking.
///
/// Callers MUST gate this with `FILE_READ_TOOLS.contains(...)` or
/// `is_file_write_tool(...)` first — calling it for any other tool name
/// is a programming error. The previous catch-all `_ => Vec::new()` arm
/// silently absorbed such mistakes and would have made any new file-
/// modifying tool stop participating in stale-edit detection without a
/// single test failure.
pub(crate) fn extract_file_paths(tool_name: &str, args: &Value) -> Vec<String> {
    match tool_name {
        tool_names::READ_FILE | tool_names::EDIT_FILE | tool_names::DELETE_FILE => {
            // edit_file uses "file_path", read_file/delete_file may use "path" or "file_path"
            if let Some(path) = args
                .get("file_path")
                .or_else(|| args.get("path"))
                .and_then(|v| v.as_str())
            {
                vec![path.to_string()]
            } else {
                Vec::new()
            }
        }
        tool_names::APPLY_PATCH => {
            if let Some(patch) = args.get("patch_text").and_then(|v| v.as_str()) {
                let mut paths = Vec::new();
                for line in patch.lines() {
                    let trimmed = line.trim();
                    let file_path = trimmed
                        .strip_prefix("*** Add File:")
                        .or_else(|| trimmed.strip_prefix("*** Update File:"))
                        .or_else(|| trimmed.strip_prefix("*** Delete File:"))
                        .or_else(|| trimmed.strip_prefix("*** Move to:"));
                    if let Some(path) = file_path {
                        let path = path.trim();
                        if !path.is_empty() {
                            paths.push(path.to_string());
                        }
                    }
                }
                paths.sort();
                paths.dedup();
                paths
            } else {
                Vec::new()
            }
        }
        // Any other tool is a caller-path bug: a new file-modifying tool
        // must be added to `FILE_WRITE_TOOLS` *and* extended here; an
        // accidental call from an unrelated tool means the gate above
        // is missing and stale-edit detection would be skipped silently.
        other => {
            debug_assert!(
                false,
                "extract_file_paths called for non-tracked tool {other:?} — \
                 caller missed FILE_READ_TOOLS / is_file_write_tool gate"
            );
            tracing::error!(
                "[file_tracker] extract_file_paths called for non-tracked tool {other:?} — \
                 caller missed FILE_READ_TOOLS / is_file_write_tool gate; stale-edit \
                 detection will be skipped for this call"
            );
            Vec::new()
        }
    }
}

/// Pinning invariant: every member of `FILE_READ_TOOLS` and
/// `FILE_WRITE_TOOLS` MUST be handled by `extract_file_paths`. If a new
/// tool is added to either list without a matching arm, this check
/// will catch it.
#[cfg(test)]
mod gate_invariant_tests {
    use super::*;

    #[test]
    fn every_tracked_tool_has_an_extraction_arm() {
        // Empty args is fine — we only care that the function does NOT
        // hit the catch-all `tracing::error!` arm. The first two arms
        // both handle empty/missing arg payloads by returning an empty
        // vec, so reaching them with an empty `Value::Null` is benign.
        for &tool in FILE_READ_TOOLS.iter().chain(FILE_WRITE_TOOLS.iter()) {
            // We can't directly observe which arm fired, but
            // `debug_assert!` in the catch-all will panic in debug
            // builds, so this test is the regression guard.
            let _ = extract_file_paths(tool, &Value::Null);
        }
    }
}
