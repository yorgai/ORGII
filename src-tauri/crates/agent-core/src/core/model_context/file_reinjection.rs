//! Post-compaction file re-injection.
//!
//! After compaction, recently read files may have been dropped from the
//! context (their `read_file` tool results are gone).  This module scans
//! the pre-compaction messages for file reads, then re-reads the most
//! recent files from disk and injects them as context messages so the
//! agent doesn't lose awareness of files it was working with.
//!
//! Reference: `claude_code/services/compact/compact.ts` — file re-injection
//! after compactConversation.

#[cfg(test)]
#[path = "tests/file_reinjection_tests.rs"]
mod tests;

use serde_json::Value;
use std::collections::HashSet;
use tracing::{debug, info};

const MAX_FILES_TO_REINJECT: usize = 5;
const MAX_FILE_SIZE_BYTES: u64 = 100_000;
const MAX_TOTAL_CONTENT_CHARS: usize = 48_000;
const MAX_CONTENT_CHARS: usize = 12_000;

/// Extract file paths from `read_file` tool calls in messages.
///
/// Scans assistant messages for `read_file` tool calls and returns
/// unique file paths in reverse chronological order (most recent first).
pub fn extract_recently_read_files(messages: &[Value]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut files = Vec::new();

    for msg in messages.iter().rev() {
        let role = msg.get("role").and_then(|val| val.as_str()).unwrap_or("");
        if role != "assistant" {
            continue;
        }

        let Some(tool_calls) = msg.get("tool_calls").and_then(|val| val.as_array()) else {
            continue;
        };

        for tc in tool_calls {
            let name = tc
                .get("function")
                .and_then(|func| func.get("name"))
                .and_then(|val| val.as_str())
                .unwrap_or("");

            if name != crate::tools::names::READ_FILE {
                continue;
            }

            let args_str = tc
                .get("function")
                .and_then(|func| func.get("arguments"))
                .and_then(|val| val.as_str())
                .unwrap_or("{}");

            if let Ok(args) = serde_json::from_str::<Value>(args_str) {
                let path = args
                    .get("file_path")
                    .or_else(|| args.get("path"))
                    .and_then(|val| val.as_str());

                if let Some(file_path) = path {
                    if seen.insert(file_path.to_string()) {
                        files.push(file_path.to_string());
                    }
                }
            }
        }

        if files.len() >= MAX_FILES_TO_REINJECT * 2 {
            break;
        }
    }

    files.truncate(MAX_FILES_TO_REINJECT);
    files
}

fn message_text(value: &Value, output: &mut String) {
    match value {
        Value::String(text) => {
            output.push_str(text);
            output.push('\n');
        }
        Value::Array(items) => {
            for item in items {
                message_text(item, output);
            }
        }
        Value::Object(map) => {
            if let Some(content) = map.get("content") {
                message_text(content, output);
            }
            if let Some(text) = map.get("text") {
                message_text(text, output);
            }
        }
        _ => {}
    }
}

fn preserved_tail_text(messages: &[Value]) -> String {
    let mut text = String::new();
    for message in messages.iter().rev().take(8) {
        message_text(message, &mut text);
    }
    text
}

fn truncate_at_boundary(content: &str, max_bytes: usize) -> String {
    if content.len() <= max_bytes {
        return content.to_string();
    }

    let mut boundary = max_bytes;
    while boundary > 0 && !content.is_char_boundary(boundary) {
        boundary -= 1;
    }

    format!(
        "{}...\n[truncated, {} chars total]",
        &content[..boundary],
        content.len()
    )
}

/// Read files from disk and create context injection messages.
///
/// Returns a system message containing the contents of recently read
/// files.  Files that don't exist, are too large, or can't be read are
/// silently skipped.
pub fn build_file_reinjection_messages(file_paths: &[String]) -> Vec<Value> {
    build_file_reinjection_messages_with_preserved_tail(file_paths, &[])
}

pub fn build_file_reinjection_messages_with_preserved_tail(
    file_paths: &[String],
    preserved_messages: &[Value],
) -> Vec<Value> {
    if file_paths.is_empty() {
        return Vec::new();
    }

    let preserved_tail = preserved_tail_text(preserved_messages);
    let mut sections = Vec::new();
    let mut remaining_chars = MAX_TOTAL_CONTENT_CHARS;

    for path in file_paths {
        if remaining_chars == 0 {
            break;
        }
        if preserved_tail.contains(path) {
            debug!(
                "[file_reinjection] skipping {}: already present in preserved tail",
                path
            );
            continue;
        }

        let metadata = match std::fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(err) => {
                debug!(
                    "[file_reinjection] skipping {}: metadata error: {}",
                    path, err
                );
                continue;
            }
        };

        if !metadata.is_file() {
            debug!("[file_reinjection] skipping {}: not a regular file", path);
            continue;
        }
        if metadata.len() > MAX_FILE_SIZE_BYTES {
            debug!(
                "[file_reinjection] skipping {}: size {} exceeds limit {}",
                path,
                metadata.len(),
                MAX_FILE_SIZE_BYTES
            );
            continue;
        }

        let content = match std::fs::read_to_string(path) {
            Ok(content) => content,
            Err(err) => {
                debug!("[file_reinjection] skipping {}: read error: {}", path, err);
                continue;
            }
        };

        let per_file_budget = MAX_CONTENT_CHARS.min(remaining_chars);
        let truncated = truncate_at_boundary(&content, per_file_budget);
        remaining_chars = remaining_chars.saturating_sub(truncated.len());

        sections.push(format!("### {}\n```\n{}\n```", path, truncated));
    }

    if sections.is_empty() {
        return Vec::new();
    }

    info!(
        "[file-reinjection] Re-injecting {} file(s) after compaction",
        sections.len()
    );

    vec![serde_json::json!({
        "role": "system",
        "content": format!(
            "[Files re-injected after compaction — these were recently read]\n\n{}",
            sections.join("\n\n")
        ),
    })]
}

/// Full pipeline: scan pre-compaction messages, read files, build injection messages.
pub fn reinject_files_after_compaction(
    pre_compaction_messages: &[Value],
    compacted_messages: &mut Vec<Value>,
) {
    let file_paths = extract_recently_read_files(pre_compaction_messages);
    if file_paths.is_empty() {
        return;
    }

    let injection_msgs =
        build_file_reinjection_messages_with_preserved_tail(&file_paths, compacted_messages);
    if injection_msgs.is_empty() {
        return;
    }

    let injection_count = injection_msgs.len();
    let insert_idx = if compacted_messages.len() > 1 { 1 } else { 0 };
    for (offset, msg) in injection_msgs.into_iter().enumerate() {
        compacted_messages.insert(insert_idx + offset, msg);
    }

    info!(
        "[file-reinjection] Inserted {} context message(s) at index {}",
        injection_count, insert_idx
    );
}
