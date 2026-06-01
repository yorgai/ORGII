//! Unified diff parser — parses patch text into `ParsedHunk` structs
//!
//! Consumed by the patch-apply logic to apply diffs to file content.

use super::types::{HunkResult, ParsedHunk};

/// Parse unified diff into hunks
pub(crate) fn parse_patch(patch: &str) -> Result<Vec<ParsedHunk>, String> {
    let mut hunks = Vec::new();
    let mut current_hunk: Option<ParsedHunk> = None;

    for line in patch.lines() {
        // Skip diff headers
        if line.starts_with("diff ")
            || line.starts_with("index ")
            || line.starts_with("---")
            || line.starts_with("+++")
        {
            continue;
        }

        // Parse hunk header: @@ -old_start,old_count +new_start,new_count @@
        if line.starts_with("@@") {
            if let Some(hunk) = current_hunk.take() {
                hunks.push(hunk);
            }

            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 3 {
                return Err(format!("Invalid hunk header: {}", line));
            }

            let (old_start, _) = parse_range(parts[1].trim_start_matches('-'))?;
            parse_range(parts[2].trim_start_matches('+'))?;

            current_hunk = Some(ParsedHunk {
                old_start,
                lines: Vec::new(),
            });
            continue;
        }

        if let Some(ref mut hunk) = current_hunk {
            if line.starts_with(' ')
                || line.starts_with('-')
                || line.starts_with('+')
                || line.is_empty()
            {
                hunk.lines.push(line.to_string());
            }
        }
    }

    if let Some(hunk) = current_hunk {
        hunks.push(hunk);
    }

    Ok(hunks)
}

/// Parse range like "10,5" or "10" into (start, count)
pub(super) fn parse_range(range: &str) -> Result<(usize, usize), String> {
    let parts: Vec<&str> = range.split(',').collect();
    let start = parts[0]
        .parse::<usize>()
        .map_err(|_| format!("Invalid range start: {}", parts[0]))?;
    let count = if parts.len() > 1 {
        parts[1]
            .parse::<usize>()
            .map_err(|_| format!("Invalid range count: {}", parts[1]))?
    } else {
        1
    };
    Ok((start, count))
}

/// Apply a single hunk at the specified position
/// Returns (new lines, line count delta)
pub(super) fn apply_hunk_at(
    lines: &[String],
    start: usize,
    hunk: &ParsedHunk,
) -> (Vec<String>, i32) {
    let mut result: Vec<String> = Vec::with_capacity(lines.len());
    let mut line_delta: i32 = 0;

    result.extend(lines.iter().take(start).cloned());

    let mut old_idx = start;
    for hunk_line in &hunk.lines {
        if hunk_line.starts_with('-') {
            old_idx += 1;
            line_delta -= 1;
        } else if let Some(after_plus) = hunk_line.strip_prefix('+') {
            result.push(after_plus.to_string());
            line_delta += 1;
        } else if old_idx < lines.len() {
            result.push(lines[old_idx].clone());
            old_idx += 1;
        }
    }

    result.extend(lines.iter().skip(old_idx).cloned());

    (result, line_delta)
}

/// Find best match position for context lines
pub(super) fn find_best_match(
    lines: &[String],
    context: &[&str],
    expected_line: usize,
    fuzz_factor: usize,
    ignore_whitespace: bool,
) -> (i32, f64) {
    let mut best_offset: i32 = 0;
    let mut best_similarity: f64 = 0.0;

    let search_start = expected_line.saturating_sub(fuzz_factor);
    let search_end = (expected_line + fuzz_factor).min(lines.len());

    for start in search_start..search_end {
        if start + context.len() > lines.len() {
            continue;
        }

        let similarity = compute_similarity(
            context,
            &lines[start..start + context.len()],
            ignore_whitespace,
        );

        if similarity > best_similarity {
            best_similarity = similarity;
            best_offset = start as i32 - expected_line as i32;
        }

        if similarity >= 1.0 {
            break;
        }
    }

    (best_offset, best_similarity)
}

/// Compute similarity between expected and actual lines
pub(super) fn compute_similarity(expected: &[&str], actual: &[String], ignore_ws: bool) -> f64 {
    if expected.is_empty() {
        return 1.0;
    }

    let normalize = |s: &str| -> String {
        if ignore_ws {
            s.split_whitespace().collect::<Vec<_>>().join(" ")
        } else {
            s.to_string()
        }
    };

    let matches = expected
        .iter()
        .zip(actual.iter())
        .filter(|(exp, act)| normalize(exp) == normalize(act))
        .count();

    matches as f64 / expected.len() as f64
}

/// Extract context lines from a hunk (lines with ' ' or '-' prefix)
pub(super) fn extract_context_lines(hunk: &ParsedHunk) -> Vec<&str> {
    hunk.lines
        .iter()
        .filter(|l| l.starts_with(' ') || l.starts_with('-'))
        .map(|l| if l.is_empty() { "" } else { &l[1..] })
        .collect()
}

/// Build hunk result for a failed fuzzy match
pub(super) fn failed_hunk_result(
    idx: usize,
    best_similarity: f64,
    min_similarity: f64,
) -> HunkResult {
    HunkResult {
        hunk_index: idx,
        offset_applied: 0,
        similarity: best_similarity,
        applied: false,
        reason: Some(format!(
            "Best match similarity ({:.2}) below threshold ({:.2})",
            best_similarity, min_similarity
        )),
    }
}
