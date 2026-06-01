//! Helpers to read and slice job output bodies (shell log files / subagent
//! buffers) for inclusion in `await` responses.

use ::regex::Regex;
use std::fs;

use super::super::registry;

/// Read the body of a terminal log file (skip YAML header).
///
/// Returns an empty string if the log file is missing (a job that hasn't
/// produced output yet is the common case). Other read failures (permission
/// denied, IO error) are logged at `warn!` so they're diagnosable instead
/// of silently returning empty output to the caller.
pub(super) fn read_log_body(log_path: &std::path::Path) -> String {
    let content = match fs::read_to_string(log_path) {
        Ok(c) => c,
        Err(err) => {
            if err.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(
                    path = %log_path.display(),
                    error = %err,
                    "[await_tool] failed to read terminal log body"
                );
            }
            return String::new();
        }
    };
    let mut in_header = false;
    let mut header_count = 0;
    let mut body_lines = Vec::new();
    for line in content.lines() {
        if line.starts_with("---") {
            header_count += 1;
            if header_count == 1 {
                in_header = true;
                continue;
            }
            if header_count == 2 {
                in_header = false;
                continue;
            }
            break;
        }
        if !in_header {
            body_lines.push(line);
        }
    }
    body_lines.join("\n")
}

/// Return the last N lines of a string.
pub(super) fn tail(text: &str, count: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(count);
    lines[start..].join("\n")
}

/// Find the first line matching a regex, returning it for metadata.
pub(super) fn find_match_line<'a>(text: &'a str, re: &Regex) -> Option<&'a str> {
    text.lines().find(|line| re.is_match(line))
}

/// Read the current body of a job (log file for shells, buffer/final_result for subagents).
pub(super) fn read_body(handle: &str, kind: &registry::JobKind) -> String {
    match kind {
        registry::JobKind::Shell { log_path, .. } => read_log_body(log_path),
        registry::JobKind::Subagent { .. } => registry::get_final_result(handle)
            .or_else(|| registry::get_recent_output(handle))
            .unwrap_or_default(),
    }
}
