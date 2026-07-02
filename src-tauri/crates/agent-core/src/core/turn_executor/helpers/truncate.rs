//! UTF-8 safe truncation for tool output strings.
//!
//! `truncate_output` caps tool result strings at `MAX_TOOL_OUTPUT_CHARS`
//! (or a per-tool override) and prepends a marker so the LLM sees a bounded
//! context window. `truncate_or_persist_output` additionally writes the FULL
//! oversized output to disk and hands the model a `<persisted-output>` stub
//! (path + size + preview) so the information is retrievable instead of
//! destroyed. `safe_truncate_end` is the low-level char-boundary helper that
//! never panics on multi-byte input.

use crate::core::turn_executor::MAX_TOOL_OUTPUT_CHARS;

/// Hard cap on what we are willing to write to disk for one tool result.
/// Guards runaway processes from filling the disk (mirrors the reference
/// implementation's 64MB persist ceiling).
const PERSIST_MAX_BYTES: usize = 64 * 1024 * 1024;

/// Preview size (head) included inline in the `<persisted-output>` stub.
const PERSIST_PREVIEW_CHARS: usize = 4_000;

/// Truncate a string at a UTF-8 char boundary (never panics on multi-byte).
pub fn safe_truncate_end(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut offset = s.len().saturating_sub(max_bytes);
    while !s.is_char_boundary(offset) && offset < s.len() {
        offset += 1;
    }
    &s[offset..]
}

/// Truncate the HEAD of a string at a char boundary (keep the beginning).
fn safe_truncate_start(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while !s.is_char_boundary(end) && end > 0 {
        end -= 1;
    }
    &s[..end]
}

/// Truncate tool output to prevent context window blowout.
///
/// If the output exceeds `budget` characters, keeps the last
/// `budget` characters with a marker at the top.
/// When no budget is given, falls back to [`MAX_TOOL_OUTPUT_CHARS`].
pub fn truncate_output(output: &str, budget: Option<usize>) -> String {
    let limit = budget.unwrap_or(MAX_TOOL_OUTPUT_CHARS);
    if output.len() <= limit {
        return output.to_string();
    }
    let truncated = safe_truncate_end(output, limit);
    let aligned = match truncated.find('\n') {
        Some(idx) => &truncated[idx + 1..],
        None => truncated,
    };
    let remaining_lines = output[..output.len() - truncated.len()]
        .matches('\n')
        .count();
    format!(
        "[output truncated, showing last ~{}K chars. {} lines truncated]\n{}",
        limit / 1000,
        remaining_lines,
        aligned
    )
}

/// Directory where oversized tool results are persisted for a session.
pub fn tool_results_dir(session_id: &str) -> std::path::PathBuf {
    app_paths::orgii_root()
        .join("tool-results")
        .join(session_id)
}

/// Like [`truncate_output`], but when the output exceeds the budget the FULL
/// text is persisted to `~/.orgii/tool-results/<session>/` and the model
/// receives a `<persisted-output>` stub with the file path, size, and a
/// head preview — the tail is still inlined via the normal truncation so
/// recent output (errors usually print last) stays visible. Falls back to
/// plain truncation when the write fails.
pub fn truncate_or_persist_output(
    output: &str,
    budget: Option<usize>,
    session_id: &str,
    tool_name: &str,
) -> String {
    let limit = budget.unwrap_or(MAX_TOOL_OUTPUT_CHARS);
    if output.len() <= limit {
        return output.to_string();
    }

    let dir = tool_results_dir(session_id);
    let persist_result = std::fs::create_dir_all(&dir).and_then(|_| {
        let file_name = format!(
            "{}-{}.txt",
            tool_name.replace(|c: char| !c.is_ascii_alphanumeric() && c != '_', "-"),
            uuid::Uuid::new_v4().simple()
        );
        let path = dir.join(file_name);
        let capped = safe_truncate_start(output, PERSIST_MAX_BYTES);
        std::fs::write(&path, capped).map(|_| (path, capped.len()))
    });

    match persist_result {
        Ok((path, written_bytes)) => {
            let preview = safe_truncate_start(output, PERSIST_PREVIEW_CHARS);
            let tail = truncate_output(output, Some(limit.min(MAX_TOOL_OUTPUT_CHARS) / 2));
            format!(
                "<persisted-output>\nFull output was too large to inline ({} bytes) and has been saved to:\n{}\nUse read_file (with offset/limit) or code_search on that file to inspect any part of it.\n</persisted-output>\n\n[head preview]\n{}\n\n[tail]\n{}",
                written_bytes,
                path.display(),
                preview,
                tail,
            )
        }
        Err(err) => {
            tracing::warn!(
                "[agent-core] Failed to persist oversized tool output ({} bytes) for {}: {}",
                output.len(),
                tool_name,
                err
            );
            truncate_output(output, budget)
        }
    }
}

#[cfg(test)]
mod persist_tests {
    use super::*;

    #[test]
    fn under_limit_passes_through() {
        let out = truncate_or_persist_output("small output", Some(100), "sess-x", "run_shell");
        assert_eq!(out, "small output");
    }

    #[test]
    fn over_limit_persists_and_stubs() {
        let big = "line\n".repeat(10_000); // 50K chars
        let session = format!("persist-test-{}", uuid::Uuid::new_v4().simple());
        let out = truncate_or_persist_output(&big, Some(1_000), &session, "run_shell");
        assert!(out.contains("<persisted-output>"), "got: {}", &out[..200]);
        assert!(out.contains("[head preview]"));
        assert!(out.contains("[tail]"));
        // The referenced file exists and holds the full output.
        let dir = tool_results_dir(&session);
        let entries: Vec<_> = std::fs::read_dir(&dir).unwrap().collect();
        assert_eq!(entries.len(), 1);
        let content = std::fs::read_to_string(entries[0].as_ref().unwrap().path()).unwrap();
        assert_eq!(content.len(), big.len());
        std::fs::remove_dir_all(&dir).ok();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_output_no_budget_under_limit() {
        let short = "hello world";
        assert_eq!(truncate_output(short, None), short);
    }

    #[test]
    fn truncate_output_with_custom_budget_under_limit() {
        let short = "abc";
        assert_eq!(truncate_output(short, Some(100)), "abc");
    }

    #[test]
    fn truncate_output_none_budget_uses_default() {
        let big = "x".repeat(MAX_TOOL_OUTPUT_CHARS + 100);
        let result = truncate_output(&big, None);
        assert!(result.contains("[output truncated"));
        assert!(result.contains(&format!("~{}K chars", MAX_TOOL_OUTPUT_CHARS / 1000)));
    }

    #[test]
    fn truncate_output_custom_budget_truncates() {
        let content = "line1\nline2\nline3\nline4\nline5\nline6";
        let result = truncate_output(content, Some(10));
        assert!(result.contains("[output truncated"));
        assert!(result.contains("~0K chars"));
    }

    #[test]
    fn truncate_output_custom_budget_keeps_tail() {
        let content = (1..=100)
            .map(|idx| format!("line {}", idx))
            .collect::<Vec<_>>()
            .join("\n");
        let result = truncate_output(&content, Some(50));
        assert!(result.contains("line 100"));
        assert!(!result.contains("line 1\n"));
    }

    #[test]
    fn truncate_output_reports_truncated_line_count() {
        let content = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj";
        let result = truncate_output(content, Some(5));
        assert!(result.contains("lines truncated"));
    }

    #[test]
    fn safe_truncate_end_handles_multibyte() {
        let emoji = "hello 😀 world";
        let result = safe_truncate_end(emoji, 7);
        assert!(result.len() <= 7 || result.starts_with(' '));
        assert!(result.is_char_boundary(0));
    }

    #[test]
    fn safe_truncate_end_noop_when_under_limit() {
        let short = "abc";
        assert_eq!(safe_truncate_end(short, 100), "abc");
    }
}
