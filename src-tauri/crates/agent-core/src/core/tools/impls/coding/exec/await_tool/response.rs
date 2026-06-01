//! Build the canonical text/meta response body for `wait_for` / `monitor`
//! and the table response for `list`.

use serde_json::Value;

use super::super::registry;
use super::body::tail;
use super::snapshot::{resolve_status, HandleSnapshot};

/// Aggregate one-or-many snapshots into the canonical response shape:
///
///   [<h1>: <label>] [<h2>: <label>] ...
///   awaitMeta::{count, items: [...]}
///   --- [<h1>] last N lines ---
///   <tail body>
///   --- [<h2>] last N lines ---
///   <tail body>
///
/// Single-handle calls still emit the `items: [one]` array so the frontend
/// only has to parse one shape.
pub(super) fn build_response(snapshots: &[HandleSnapshot], tail_count: usize) -> String {
    let header = snapshots
        .iter()
        .map(|s| format!("[{}: {}]", s.handle, s.header_label()))
        .collect::<Vec<_>>()
        .join(" ");

    let items: Vec<Value> = snapshots.iter().map(HandleSnapshot::to_meta_item).collect();
    let meta = serde_json::json!({
        "count": items.len(),
        "items": items,
    });
    let meta_line = format!("awaitMeta::{}", meta);

    let mut out = String::new();
    out.push_str(&header);
    out.push('\n');
    out.push_str(&meta_line);
    out.push('\n');

    for snap in snapshots {
        out.push_str(&format!(
            "--- [{}] last {} lines ---\n{}\n",
            snap.handle,
            tail_count,
            tail(&snap.body, tail_count)
        ));
    }
    // Drop the trailing newline to keep diffs tidy.
    if out.ends_with('\n') {
        out.pop();
    }
    out
}

pub(super) fn build_list_response(snapshots: &[registry::JobSnapshot]) -> String {
    let items: Vec<Value> = snapshots
        .iter()
        .map(|snap| {
            let resolved = resolve_status(&snap.status);
            serde_json::json!({
                "handle": snap.handle,
                "kind": snap.kind_label,
                "status": resolved.status,
                "ageMs": snap.age_ms,
                "label": snap.label,
            })
        })
        .collect();

    let meta = serde_json::json!({
        "command": "list",
        "status": "succeeded",
        "count": items.len(),
        "items": items,
    });
    let meta_line = format!("awaitMeta::{}", meta);

    let mut table = String::from("HANDLE          KIND              STATUS      AGE       LABEL\n");
    for snap in snapshots {
        let resolved = resolve_status(&snap.status);
        let age_secs = snap.age_ms / 1000;
        table.push_str(&format!(
            "{:<15} {:<17} {:<11} {}s        {}\n",
            snap.handle, snap.kind_label, resolved.status, age_secs, snap.label
        ));
    }
    if snapshots.is_empty() {
        table.push_str("(no background jobs)\n");
    }

    format!("[background jobs]\n{}\n{}", meta_line, table)
}
