//! Structured diff computation — produces `StructuredDiff` from two text buffers
//!
//! Uses the `similar` crate to compute line-level diffs and emits structured
//! `DiffLine` entries (added, removed, unchanged) with context window support.

use similar::{ChangeTag, TextDiff};
use std::collections::VecDeque;

use super::types::*;

/// Internal helper: compute structured diff lines (shared logic).
pub(super) fn compute_structured_diff_internal(
    old_text: &str,
    new_text: &str,
) -> Vec<StructuredDiffLine> {
    let is_old_empty = old_text.trim().is_empty();
    let is_new_empty = new_text.trim().is_empty();

    if is_old_empty && !is_new_empty {
        return new_text
            .split('\n')
            .enumerate()
            .map(|(idx, content)| StructuredDiffLine {
                line_type: "add",
                content: content.to_string(),
                old_line_number: None,
                new_line_number: Some(idx + 1),
                index: idx,
            })
            .collect();
    }
    if is_new_empty && !is_old_empty {
        return old_text
            .split('\n')
            .enumerate()
            .map(|(idx, content)| StructuredDiffLine {
                line_type: "remove",
                content: content.to_string(),
                old_line_number: Some(idx + 1),
                new_line_number: None,
                index: idx,
            })
            .collect();
    }

    let diff = TextDiff::from_lines(old_text, new_text);
    let mut result = Vec::new();
    let mut old_line: usize = 1;
    let mut new_line: usize = 1;

    for (idx, change) in diff.iter_all_changes().enumerate() {
        match change.tag() {
            ChangeTag::Equal => {
                result.push(StructuredDiffLine {
                    line_type: "context",
                    content: change
                        .as_str()
                        .unwrap_or("")
                        .trim_end_matches('\n')
                        .to_string(),
                    old_line_number: Some(old_line),
                    new_line_number: Some(new_line),
                    index: idx,
                });
                old_line += 1;
                new_line += 1;
            }
            ChangeTag::Delete => {
                result.push(StructuredDiffLine {
                    line_type: "remove",
                    content: change
                        .as_str()
                        .unwrap_or("")
                        .trim_end_matches('\n')
                        .to_string(),
                    old_line_number: Some(old_line),
                    new_line_number: None,
                    index: idx,
                });
                old_line += 1;
            }
            ChangeTag::Insert => {
                result.push(StructuredDiffLine {
                    line_type: "add",
                    content: change
                        .as_str()
                        .unwrap_or("")
                        .trim_end_matches('\n')
                        .to_string(),
                    old_line_number: None,
                    new_line_number: Some(new_line),
                    index: idx,
                });
                new_line += 1;
            }
        }
    }
    result
}

/// Internal helper: group diff lines into hunks with context.
pub(super) fn group_into_hunks(
    lines: &[StructuredDiffLine],
    context_lines: usize,
) -> Vec<StructuredDiffHunk> {
    let change_indices: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter_map(|(idx, line)| {
            if line.line_type == "add" || line.line_type == "remove" {
                Some(idx)
            } else {
                None
            }
        })
        .collect();

    if change_indices.is_empty() {
        return Vec::new();
    }

    let mut hunk_ranges: Vec<(usize, usize)> = Vec::new();
    let mut current_start: Option<usize> = None;
    let mut current_end: usize = 0;

    for &idx in &change_indices {
        let range_start = idx.saturating_sub(context_lines);
        let range_end = (idx + context_lines).min(lines.len().saturating_sub(1));

        if let Some(start) = current_start {
            if range_start <= current_end + 1 {
                current_end = current_end.max(range_end);
            } else {
                hunk_ranges.push((start, current_end));
                current_start = Some(range_start);
                current_end = range_end;
            }
        } else {
            current_start = Some(range_start);
            current_end = range_end;
        }
    }

    if let Some(start) = current_start {
        hunk_ranges.push((start, current_end));
    }

    hunk_ranges
        .iter()
        .enumerate()
        .map(|(hunk_index, &(start, end))| {
            let hunk_lines: Vec<StructuredDiffLine> = lines[start..=end].to_vec();

            let first_old = hunk_lines.iter().find_map(|l| l.old_line_number);
            let first_new = hunk_lines.iter().find_map(|l| l.new_line_number);
            let last_old = hunk_lines.iter().rev().find_map(|l| l.old_line_number);
            let last_new = hunk_lines.iter().rev().find_map(|l| l.new_line_number);

            let header = StructuredDiffHunkHeader {
                old_start_line: first_old.unwrap_or(1),
                old_line_count: match (first_old, last_old) {
                    (Some(first), Some(last)) => last - first + 1,
                    _ => 0,
                },
                new_start_line: first_new.unwrap_or(1),
                new_line_count: match (first_new, last_new) {
                    (Some(first), Some(last)) => last - first + 1,
                    _ => 0,
                },
            };

            StructuredDiffHunk {
                header,
                lines: hunk_lines,
                is_expanded: true,
                hunk_index,
            }
        })
        .collect()
}

/// Internal helper: generate split view rows from hunks.
pub(super) fn generate_split_rows(hunks: &[StructuredDiffHunk]) -> Vec<SplitDiffRow> {
    let mut rows: Vec<SplitDiffRow> = Vec::new();

    for hunk in hunks {
        let header_text = format!(
            "@@ -{},{} +{},{} @@",
            hunk.header.old_start_line,
            hunk.header.old_line_count,
            hunk.header.new_start_line,
            hunk.header.new_line_count
        );
        rows.push(SplitDiffRow {
            key: format!("hunk-header-{}", hunk.hunk_index),
            left: SplitDiffCell {
                line_number: None,
                content: header_text.clone(),
                cell_type: "hunk-header",
                is_selected: None,
            },
            right: SplitDiffCell {
                line_number: None,
                content: header_text,
                cell_type: "hunk-header",
                is_selected: None,
            },
            is_hunk_header: Some(true),
            hunk_index: Some(hunk.hunk_index),
        });

        let mut line_queue: VecDeque<&StructuredDiffLine> = hunk.lines.iter().collect();
        let mut row_index = 0;

        while let Some(current) = line_queue.pop_front() {
            match current.line_type {
                "context" => {
                    rows.push(SplitDiffRow {
                        key: format!("{}-{}", hunk.hunk_index, row_index),
                        left: SplitDiffCell {
                            line_number: current.old_line_number,
                            content: current.content.clone(),
                            cell_type: "context",
                            is_selected: None,
                        },
                        right: SplitDiffCell {
                            line_number: current.new_line_number,
                            content: current.content.clone(),
                            cell_type: "context",
                            is_selected: None,
                        },
                        is_hunk_header: None,
                        hunk_index: None,
                    });
                }
                "remove" => {
                    if line_queue
                        .front()
                        .is_some_and(|next| next.line_type == "add")
                    {
                        let addition = line_queue.pop_front().unwrap();
                        rows.push(SplitDiffRow {
                            key: format!("{}-{}", hunk.hunk_index, row_index),
                            left: SplitDiffCell {
                                line_number: current.old_line_number,
                                content: current.content.clone(),
                                cell_type: "remove",
                                is_selected: None,
                            },
                            right: SplitDiffCell {
                                line_number: addition.new_line_number,
                                content: addition.content.clone(),
                                cell_type: "add",
                                is_selected: None,
                            },
                            is_hunk_header: None,
                            hunk_index: None,
                        });
                    } else {
                        rows.push(SplitDiffRow {
                            key: format!("{}-{}", hunk.hunk_index, row_index),
                            left: SplitDiffCell {
                                line_number: current.old_line_number,
                                content: current.content.clone(),
                                cell_type: "remove",
                                is_selected: None,
                            },
                            right: SplitDiffCell {
                                line_number: None,
                                content: String::new(),
                                cell_type: "empty",
                                is_selected: None,
                            },
                            is_hunk_header: None,
                            hunk_index: None,
                        });
                    }
                }
                "add" => {
                    rows.push(SplitDiffRow {
                        key: format!("{}-{}", hunk.hunk_index, row_index),
                        left: SplitDiffCell {
                            line_number: None,
                            content: String::new(),
                            cell_type: "empty",
                            is_selected: None,
                        },
                        right: SplitDiffCell {
                            line_number: current.new_line_number,
                            content: current.content.clone(),
                            cell_type: "add",
                            is_selected: None,
                        },
                        is_hunk_header: None,
                        hunk_index: None,
                    });
                }
                _ => {}
            }
            row_index += 1;
        }
    }

    rows
}
