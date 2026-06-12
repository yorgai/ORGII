use super::types::UnifiedDiffNormalization;

const HUNK_HEADER_PREFIX: &str = "@@";

#[derive(Debug, Clone, Copy)]
struct HunkInfo {
    old_start: usize,
    new_start: usize,
}

fn parse_hunk_header(line: &str) -> Option<HunkInfo> {
    if !line.starts_with(HUNK_HEADER_PREFIX) {
        return None;
    }

    let mut parts = line.split_whitespace();
    if parts.next()? != "@@" {
        return None;
    }

    let old_part = parts.next()?;
    let new_part = parts.next()?;
    if !old_part.starts_with('-') || !new_part.starts_with('+') {
        return None;
    }

    let old_start = old_part[1..]
        .split(',')
        .next()
        .and_then(|value| value.parse::<usize>().ok())?;
    let new_start = new_part[1..]
        .split(',')
        .next()
        .and_then(|value| value.parse::<usize>().ok())?;

    Some(HunkInfo {
        old_start,
        new_start,
    })
}

pub fn normalize_unified_diff(diff: &str) -> UnifiedDiffNormalization {
    let mut old_lines: Vec<String> = Vec::new();
    let mut new_lines: Vec<String> = Vec::new();
    let mut old_start_line: Option<usize> = None;
    let mut new_start_line: Option<usize> = None;
    let mut old_cursor = 0;
    let mut new_cursor = 0;
    let mut lines_added = 0;
    let mut lines_removed = 0;

    for line in diff.split('\n') {
        if line.starts_with("diff ")
            || line.starts_with("index ")
            || line.starts_with("---")
            || line.starts_with("+++")
        {
            continue;
        }

        if let Some(hunk) = parse_hunk_header(line) {
            if old_start_line.is_none() {
                old_start_line = Some(hunk.old_start);
                new_start_line = Some(hunk.new_start);
            } else {
                let old_gap = hunk.old_start.saturating_sub(old_cursor);
                let new_gap = hunk.new_start.saturating_sub(new_cursor);
                let gap_count = old_gap.max(new_gap);
                for i in 0..gap_count {
                    if i < old_gap {
                        old_lines.push(String::new());
                    }
                    if i < new_gap {
                        new_lines.push(String::new());
                    }
                }
            }
            old_cursor = hunk.old_start;
            new_cursor = hunk.new_start;
            continue;
        }

        if let Some(content) = line.strip_prefix('-') {
            old_lines.push(content.to_string());
            old_cursor += 1;
            lines_removed += 1;
        } else if let Some(content) = line.strip_prefix('+') {
            new_lines.push(content.to_string());
            new_cursor += 1;
            lines_added += 1;
        } else if let Some(content) = line.strip_prefix(' ') {
            old_lines.push(content.to_string());
            new_lines.push(content.to_string());
            old_cursor += 1;
            new_cursor += 1;
        } else if line.is_empty() {
            old_lines.push(String::new());
            new_lines.push(String::new());
            old_cursor += 1;
            new_cursor += 1;
        }
    }

    UnifiedDiffNormalization {
        old_content: old_lines.join("\n"),
        new_content: new_lines.join("\n"),
        old_start_line,
        new_start_line,
        lines_added,
        lines_removed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_single_hunk() {
        let result = normalize_unified_diff(
            "--- a/file.ts\n+++ b/file.ts\n@@ -10,3 +10,3 @@\n context\n-old\n+new\n tail",
        );

        assert_eq!(result.old_content, "context\nold\ntail");
        assert_eq!(result.new_content, "context\nnew\ntail");
        assert_eq!(result.old_start_line, Some(10));
        assert_eq!(result.new_start_line, Some(10));
        assert_eq!(result.lines_added, 1);
        assert_eq!(result.lines_removed, 1);
    }

    #[test]
    fn normalizes_multi_hunk_with_gaps() {
        let result = normalize_unified_diff(
            "@@ -1,2 +1,2 @@\n a\n-old\n+new\n@@ -10,2 +10,2 @@\n z\n-before\n+after",
        );

        assert_eq!(result.old_start_line, Some(1));
        assert_eq!(result.new_start_line, Some(1));
        assert_eq!(result.old_content, "a\nold\n\n\n\n\n\n\n\nz\nbefore");
        assert_eq!(result.new_content, "a\nnew\n\n\n\n\n\n\n\nz\nafter");
    }

    #[test]
    fn normalizes_added_file() {
        let result =
            normalize_unified_diff("--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,2 @@\n+one\n+two");

        assert_eq!(result.old_content, "");
        assert_eq!(result.new_content, "one\ntwo");
        assert_eq!(result.old_start_line, Some(0));
        assert_eq!(result.new_start_line, Some(1));
        assert_eq!(result.lines_added, 2);
        assert_eq!(result.lines_removed, 0);
    }

    #[test]
    fn normalizes_deleted_file_header_only() {
        let result = normalize_unified_diff("--- old.ts\n+++ /dev/null");

        assert_eq!(result.old_content, "");
        assert_eq!(result.new_content, "");
        assert_eq!(result.old_start_line, None);
        assert_eq!(result.new_start_line, None);
        assert_eq!(result.lines_added, 0);
        assert_eq!(result.lines_removed, 0);
    }

    #[test]
    fn normalizes_blank_context_lines() {
        let result = normalize_unified_diff("@@ -1,3 +1,3 @@\n line1\n\n line3");

        assert_eq!(result.old_content, "line1\n\nline3");
        assert_eq!(result.new_content, "line1\n\nline3");
    }
}
