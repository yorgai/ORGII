//! Tool-failure → user-intervention pattern detection.
//!
//! Pure scanning over the persisted message stream — no LLM calls. We look
//! for `tool_result` rows that smell like errors and pair each with the
//! NEXT user turn. Matches that count as "the user had to intervene"
//! become candidates for the active-observation extractor.
//!
//! Pure functions are kept small and unit-testable. The only DB-touching
//! function is [`scan_patterns`].

use crate::foundation::persistence::db_helpers::message_role;

/// Minimum number of (tool_error → user intervention) patterns required to
/// fire the extractor. A single isolated failure is just normal error
/// handling, not a durable blind spot; two or more in the same session
/// means the agent kept doing the thing the user corrected.
pub(super) const MIN_PATTERN_COUNT: usize = 2;

/// Maximum number of pattern occurrences we summarise into the LLM prompt.
/// Past this cap the prompt grows without adding signal.
pub(super) const MAX_PATTERNS_IN_PROMPT: usize = 5;

/// Byte cap per tool-error snippet inlined in the prompt. Matches the
/// tail-biased truncation philosophy of reflection — we keep the message
/// informative without flooding the context.
const PATTERN_SNIPPET_CAP: usize = 400;

/// Captured (tool_result → user intervention) occurrence used to build the
/// extractor prompt.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ToolFailurePattern {
    /// Tool name from the offending `tool_result` row (e.g. `bash`,
    /// `str_replace`). Empty when the row did not record one.
    pub tool_name: String,
    /// Truncated snippet of the tool-result content indicating the error.
    pub tool_result_snippet: String,
    /// Truncated snippet of the following user turn indicating intervention.
    pub user_intervention_snippet: String,
}

pub(super) fn scan_patterns(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Result<Vec<ToolFailurePattern>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT role, content, tool_name
             FROM agent_messages
             WHERE session_id = ?1
             ORDER BY sequence ASC",
        )
        .map_err(|e| format!("Query failed: {}", e))?;

    let rows: Vec<(String, String, Option<String>)> = stmt
        .query_map(rusqlite::params![session_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|e| format!("Query failed: {}", e))?
        .filter_map(Result::ok)
        .collect();

    Ok(detect_patterns(&rows))
}

/// Pure-function pattern detector. Extracted for unit testability: takes
/// the raw `(role, content, tool_name)` stream and returns matched
/// `(tool_result_error, user_intervention)` pairs.
pub(crate) fn detect_patterns(
    rows: &[(String, String, Option<String>)],
) -> Vec<ToolFailurePattern> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < rows.len() {
        let (role, content, tool_name) = &rows[i];
        if role == message_role::TOOL_RESULT && looks_like_error(content) {
            if let Some(next_user) = find_next_user(rows, i + 1) {
                out.push(ToolFailurePattern {
                    tool_name: tool_name.clone().unwrap_or_default(),
                    tool_result_snippet: truncate_snippet(content, PATTERN_SNIPPET_CAP),
                    user_intervention_snippet: truncate_snippet(
                        &rows[next_user].1,
                        PATTERN_SNIPPET_CAP,
                    ),
                });
                i = next_user + 1;
                continue;
            }
        }
        i += 1;
    }
    out
}

fn find_next_user(rows: &[(String, String, Option<String>)], start: usize) -> Option<usize> {
    (start..rows.len()).find(|idx| rows[*idx].0 == message_role::USER)
}

/// Heuristic "this tool_result indicates a failure" detector.
///
/// We deliberately keep this conservative: the signal we care about is
/// durable blind spots, so we only fire on strong markers. False negatives
/// (missed failures) cost us one pending insight per session; false
/// positives flood the extractor with noise and waste LLM budget.
///
/// Matches (case-insensitive on the first ~1 KB of the body, which is
/// where exit-code preambles and stderr prefixes live):
/// - `exit code: N` with `N != 0`
/// - word `error`, `failed`, `traceback`, `panic`, or `denied`
/// - `err:` / `fail:` / `stderr:` prefixes
pub(crate) fn looks_like_error(content: &str) -> bool {
    let head: String = content
        .chars()
        .take(1024)
        .collect::<String>()
        .to_ascii_lowercase();

    if head.contains("exit code: ") || head.contains("exit code ") {
        if let Some(pos) = head.find("exit code") {
            let tail = &head[pos..];
            if !tail.contains("exit code: 0") && !tail.contains("exit code 0") {
                return true;
            }
        }
    }

    const MARKERS: &[&str] = &[
        "error:",
        "failed:",
        "traceback",
        "panic",
        "denied:",
        " error ",
        " failed ",
        " err: ",
        " fail: ",
        "stderr:",
    ];
    MARKERS.iter().any(|m| head.contains(m))
}

pub(super) fn truncate_snippet(text: &str, cap: usize) -> String {
    if text.len() <= cap {
        return text.trim().to_string();
    }
    let mut boundary = cap;
    while boundary > 0 && !text.is_char_boundary(boundary) {
        boundary -= 1;
    }
    format!("{}…", text[..boundary].trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(role: &str, content: &str, tool: Option<&str>) -> (String, String, Option<String>) {
        (
            role.to_string(),
            content.to_string(),
            tool.map(String::from),
        )
    }

    #[test]
    fn looks_like_error_detects_common_markers() {
        assert!(looks_like_error("Error: cargo build failed"));
        assert!(looks_like_error("command exited with exit code: 2"));
        assert!(looks_like_error("Traceback (most recent call last):"));
        assert!(looks_like_error("thread 'main' panicked at 'oops'"));
        assert!(looks_like_error("Permission denied: ..."));
        assert!(looks_like_error("stderr: no such file"));
    }

    #[test]
    fn looks_like_error_rejects_clean_output() {
        assert!(!looks_like_error(""));
        assert!(!looks_like_error("exit code: 0\nall good"));
        assert!(!looks_like_error("file content with 3 lines"));
        assert!(!looks_like_error("Listed 12 files in /tmp"));
    }

    #[test]
    fn detect_patterns_finds_error_then_user_pair() {
        let rows = vec![
            row("user", "run the build", None),
            row("assistant", "ok", None),
            row("tool_call", "cargo build", Some("bash")),
            row(
                "tool_result",
                "Error: cargo build failed with exit code: 101",
                Some("bash"),
            ),
            row("user", "try `cargo build --release` instead", None),
        ];
        let got = detect_patterns(&rows);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].tool_name, "bash");
        assert!(got[0].tool_result_snippet.contains("Error"));
        assert!(got[0]
            .user_intervention_snippet
            .contains("cargo build --release"));
    }

    #[test]
    fn detect_patterns_requires_user_after_error() {
        let rows = vec![
            row("user", "do X", None),
            row("tool_result", "Error: transient", Some("bash")),
            row("assistant", "retrying...", None),
            row("tool_result", "exit code: 0", Some("bash")),
        ];
        assert!(detect_patterns(&rows).is_empty());
    }

    #[test]
    fn detect_patterns_skips_non_error_tool_results() {
        let rows = vec![
            row(
                "tool_result",
                "file content with 3 lines",
                Some("read_file"),
            ),
            row("user", "that looks wrong", None),
        ];
        assert!(detect_patterns(&rows).is_empty());
    }

    #[test]
    fn detect_patterns_captures_multiple_distinct_failures() {
        let rows = vec![
            row("tool_result", "Error: cargo build failed", Some("bash")),
            row("user", "use --release", None),
            row("tool_result", "Error: file not found", Some("read_file")),
            row("user", "it's at src/main.rs", None),
            row("tool_result", "Traceback: stuff", Some("bash")),
            row("user", "activate the venv first", None),
        ];
        let got = detect_patterns(&rows);
        assert_eq!(got.len(), 3);
        assert_eq!(got[0].tool_name, "bash");
        assert_eq!(got[1].tool_name, "read_file");
        assert_eq!(got[2].tool_name, "bash");
    }

    #[test]
    fn detect_patterns_does_not_double_count_single_failure() {
        let rows = vec![
            row("tool_result", "Error: one", Some("bash")),
            row("user", "fix it", None),
            row("assistant", "done", None),
        ];
        assert_eq!(detect_patterns(&rows).len(), 1);
    }

    #[test]
    fn truncate_snippet_snaps_to_char_boundary() {
        let s = "✓".repeat(100);
        let got = truncate_snippet(&s, 10);
        assert!(got.ends_with('…'));
        assert!(got.is_char_boundary(got.len()));
    }
}
