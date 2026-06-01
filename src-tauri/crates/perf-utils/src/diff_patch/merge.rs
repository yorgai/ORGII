//! Diff merge helpers — collecting and highlighting changed line indices
//!
//! Used by the structured diff engine to determine which lines are
//! additions, deletions, or unchanged context.

use similar::{ChangeTag, TextDiff};
use std::collections::HashSet;

/// Collect indices of changed lines from a diff
pub(super) fn collect_changes<'a>(diff: &TextDiff<'a, 'a, 'a, str>) -> HashSet<usize> {
    let mut changes = HashSet::new();
    let mut idx = 0;

    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Delete | ChangeTag::Insert => {
                changes.insert(idx);
            }
            ChangeTag::Equal => {}
        }
        if change.tag() != ChangeTag::Insert {
            idx += 1;
        }
    }

    changes
}
