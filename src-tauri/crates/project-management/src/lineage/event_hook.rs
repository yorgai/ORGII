//! Event Hook — extracts file edit info from session events and records provenance.
//!
//! Called after `save_events()` and `insert_chunk()` to capture AI-originated
//! code in the `node_provenance` table.

use std::fs;
use std::path::Path;

use super::provenance::record_provenance;
use core_types::tool_names;

const FILE_DIFF_EVENT_FUNCTION_NAME: &str = "file_diff";
pub(crate) const CLI_EDIT_FUNCTIONS: &[&str] = &["Edit", "Write", "Patch", "Create"];

pub(crate) fn is_edit_event_function(function_name: &str) -> bool {
    tool_names::FILE_EDIT_EVENT_FUNCTION_NAMES.contains(&function_name)
        || function_name == FILE_DIFF_EVENT_FUNCTION_NAME
}

fn is_cli_edit_function(function_name: &str) -> bool {
    CLI_EDIT_FUNCTIONS.contains(&function_name) || is_edit_event_function(function_name)
}

/// Process a batch of session events for lineage tracking.
pub fn process_events(session_id: &str, events: &[(String, String)]) {
    for (function_name, args_json) in events {
        if !is_edit_event_function(function_name) {
            continue;
        }
        if let Err(err) = process_single_event(session_id, function_name, args_json) {
            log::warn!("[lineage] Failed to record provenance: {}", err);
        }
    }
}

/// Process a single code-session chunk for lineage tracking.
pub fn process_chunk(session_id: &str, function: &str, args_json: &str) {
    if !is_cli_edit_function(function) {
        return;
    }
    if let Err(err) = process_single_event(session_id, function, args_json) {
        log::warn!("[lineage] Failed to record chunk provenance: {}", err);
    }
}

fn process_single_event(
    session_id: &str,
    function_name: &str,
    args_json: &str,
) -> Result<(), String> {
    let args: serde_json::Value =
        serde_json::from_str(args_json).unwrap_or(serde_json::Value::Null);

    if function_name == tool_names::APPLY_PATCH {
        return process_patch_event(session_id, &args);
    }

    let file_path = args
        .get("file_path")
        .and_then(|v| v.as_str())
        .or_else(|| args.get("file_name").and_then(|v| v.as_str()))
        .or_else(|| args.get("path").and_then(|v| v.as_str()));

    let file_path = match file_path {
        Some(path) => path,
        None => return Ok(()),
    };

    let (start_line, end_line) = resolve_line_range(function_name, &args, file_path);
    record_provenance(session_id, file_path, start_line, end_line)
}

/// Resolve the line range for an edit operation.
///
/// Strategy by tool type:
/// 1. Explicit `start_line` / `end_line` fields → use directly
/// 2. Single `line` / `insert_line` + content → compute from content line count
/// 3. `edit_file_by_replace` with `old_string` → search file for match position
/// 4. `create_file` / `write_file` with content → use `(1, content_lines)`
/// 5. `append_file` with content → use `(file_lines + 1, file_lines + content_lines)`
/// 6. Fallback → skip (return 0,0 which record_provenance ignores)
fn resolve_line_range(
    function_name: &str,
    args: &serde_json::Value,
    file_path: &str,
) -> (u32, u32) {
    if let (Some(start), Some(end)) = (
        args.get("start_line").and_then(|v| v.as_u64()),
        args.get("end_line").and_then(|v| v.as_u64()),
    ) {
        return (start.max(1) as u32, end.max(1) as u32);
    }

    if let Some(line) = args
        .get("line")
        .and_then(|v| v.as_u64())
        .or_else(|| args.get("insert_line").and_then(|v| v.as_u64()))
    {
        let new_text = get_content_field(args);
        let line_count = new_text.lines().count().max(1) as u32;
        return (
            line.max(1) as u32,
            (line as u32).saturating_add(line_count - 1),
        );
    }

    if function_name == tool_names::STORAGE_EDIT_FILE_BY_REPLACE
        || function_name == tool_names::EDIT_FILE
        || function_name == "Edit"
    {
        return resolve_replace_range(args, file_path);
    }

    if function_name == tool_names::STORAGE_APPEND_FILE {
        return resolve_append_range(args, file_path);
    }

    // create_file / write_file / Write / Create — AI wrote the entire content
    let content = get_content_field(args);
    if !content.is_empty() {
        let line_count = content.lines().count().max(1) as u32;
        return (1, line_count);
    }

    (0, 0)
}

/// For replace-style tools: find `old_string` in the file to get exact position.
fn resolve_replace_range(args: &serde_json::Value, file_path: &str) -> (u32, u32) {
    let old_string = args
        .get("old_string")
        .and_then(|v| v.as_str())
        .or_else(|| args.get("old_str").and_then(|v| v.as_str()))
        .unwrap_or("");

    let new_string = args
        .get("new_string")
        .and_then(|v| v.as_str())
        .or_else(|| args.get("new_str").and_then(|v| v.as_str()))
        .unwrap_or("");

    if old_string.is_empty() && new_string.is_empty() {
        return (0, 0);
    }

    let file_content = match fs::read_to_string(Path::new(file_path)) {
        Ok(content) => content,
        Err(_) => {
            let line_count = new_string.lines().count().max(1) as u32;
            return (1, line_count);
        }
    };

    if !old_string.is_empty() {
        if let Some(byte_offset) = file_content.find(old_string) {
            let start_line = file_content[..byte_offset].lines().count().max(1) as u32;
            let new_line_count = new_string.lines().count().max(1) as u32;
            return (start_line, start_line.saturating_add(new_line_count - 1));
        }
    }

    let new_line_count = new_string.lines().count().max(1) as u32;
    (1, new_line_count)
}

/// For append operations: content goes at the end of the file.
fn resolve_append_range(args: &serde_json::Value, file_path: &str) -> (u32, u32) {
    let content = get_content_field(args);
    if content.is_empty() {
        return (0, 0);
    }

    let file_lines = match fs::read_to_string(Path::new(file_path)) {
        Ok(existing) => existing.lines().count() as u32,
        Err(_) => 0,
    };

    let content_lines = content.lines().count().max(1) as u32;
    let start = file_lines.saturating_add(1);
    (start, start.saturating_add(content_lines - 1))
}

pub(crate) fn get_content_field(args: &serde_json::Value) -> &str {
    args.get("new_string")
        .and_then(|v| v.as_str())
        .or_else(|| args.get("content").and_then(|v| v.as_str()))
        .or_else(|| args.get("insert_text").and_then(|v| v.as_str()))
        .or_else(|| args.get("file_text").and_then(|v| v.as_str()))
        .unwrap_or("")
}

/// Parse patch format to extract file paths and line ranges.
fn process_patch_event(session_id: &str, args: &serde_json::Value) -> Result<(), String> {
    let patch_text = match args.get("patch_text").and_then(|v| v.as_str()) {
        Some(text) => text,
        None => return Ok(()),
    };

    let mut current_file: Option<String> = None;
    let mut hunks: Vec<(String, u32, u32)> = Vec::new();

    for line in patch_text.lines() {
        let trimmed = line.trim();

        if let Some(path) = trimmed.strip_prefix("*** Add File:") {
            let path = path.trim();
            if !path.is_empty() {
                current_file = Some(path.to_string());
            }
            continue;
        }
        if let Some(path) = trimmed.strip_prefix("*** Update File:") {
            let path = path.trim();
            if !path.is_empty() {
                current_file = Some(path.to_string());
            }
            continue;
        }

        if trimmed.starts_with("@@") {
            if let Some(ref file) = current_file {
                if let Some((start, count)) = parse_hunk_header(trimmed) {
                    let end = start.saturating_add(count.max(1) - 1);
                    hunks.push((file.clone(), start, end));
                }
            }
            continue;
        }
    }

    if hunks.is_empty() {
        // Fallback: record whole file for Add File entries
        let mut seen = std::collections::HashSet::new();
        for line in patch_text.lines() {
            let trimmed = line.trim();
            let path = trimmed
                .strip_prefix("*** Add File:")
                .map(|path| path.trim());
            if let Some(path) = path {
                if !path.is_empty() && seen.insert(path.to_string()) {
                    let line_count = count_patch_content_lines(patch_text, path);
                    record_provenance(session_id, path, 1, line_count.max(1) as u32)?;
                }
            }
        }
    } else {
        for (file, start, end) in hunks {
            record_provenance(session_id, &file, start, end)?;
        }
    }

    Ok(())
}

/// Parse `@@ -old_start,old_count +new_start,new_count @@` header.
/// Returns `(new_start, new_count)`.
pub(crate) fn parse_hunk_header(header: &str) -> Option<(u32, u32)> {
    let plus_idx = header.find('+')?;
    let rest = &header[plus_idx + 1..];
    let end = rest.find([' ', '@'])?;
    let range_str = &rest[..end];

    if let Some(comma_idx) = range_str.find(',') {
        let start: u32 = range_str[..comma_idx].parse().ok()?;
        let count: u32 = range_str[comma_idx + 1..].parse().ok()?;
        Some((start.max(1), count))
    } else {
        let start: u32 = range_str.parse().ok()?;
        Some((start.max(1), 1))
    }
}

/// Count non-header content lines for a given file in patch text.
pub(crate) fn count_patch_content_lines(patch_text: &str, target_file: &str) -> usize {
    let mut in_target = false;
    let mut count = 0;
    for line in patch_text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("*** Add File:") || trimmed.starts_with("*** Update File:") {
            let path = trimmed
                .strip_prefix("*** Add File:")
                .or_else(|| trimmed.strip_prefix("*** Update File:"))
                .unwrap_or("")
                .trim();
            in_target = path == target_file;
            continue;
        }
        if trimmed.starts_with("*** End of File") || trimmed.starts_with("*** Delete File") {
            if in_target {
                break;
            }
            continue;
        }
        if in_target {
            count += 1;
        }
    }
    count
}

#[cfg(test)]
#[path = "tests/event_hook_tests.rs"]
mod tests;
