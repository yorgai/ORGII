//! UTF-8 safe truncation for tool output strings.
//!
//! `truncate_output` caps tool result strings at `MAX_TOOL_OUTPUT_CHARS`
//! (or a per-tool override) and prepends a marker so the LLM sees a bounded
//! context window. `safe_truncate_end` is the low-level char-boundary
//! helper that never panics on multi-byte input.

use crate::core::turn_executor::MAX_TOOL_OUTPUT_CHARS;

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
