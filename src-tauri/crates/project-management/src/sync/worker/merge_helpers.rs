use tracing::debug;

use crate::projects::types::{WorkItemData, WorkItemPartialUpdate};
use crate::sync::adapter::{EntityField, FieldMap};
use crate::sync::conflict::ResolverDecision;

/// Translate the resolver's adopted fields into a
/// [`WorkItemPartialUpdate`]. Keys are the local field names produced
/// by [`super::adapter::EntityField::as_local_name`].
///
/// Unknown keys (the field map advertises something we don't model
/// in `WorkItemPartialUpdate` yet) are silently dropped — the resolver
/// already proved the field is writable, but the write surface here
/// is the limiting factor.
pub(super) fn build_partial_update(decision: &ResolverDecision) -> WorkItemPartialUpdate {
    partial_update_from_iter(decision.adopted_fields.iter().map(|(k, v)| (k.as_str(), v)))
}

/// Map a `(field name, JSON value)` collection onto a
/// [`WorkItemPartialUpdate`]. Shared between the resolver-driven merge
/// path ([`build_partial_update`]) and the user-facing "Use remote"
/// conflict-resolution command, both of which need the same
/// field-by-field cast logic.
pub fn partial_update_from_map(
    map: &serde_json::Map<String, serde_json::Value>,
) -> WorkItemPartialUpdate {
    partial_update_from_iter(map.iter().map(|(k, v)| (k.as_str(), v)))
}

fn partial_update_from_iter<'a>(
    iter: impl Iterator<Item = (&'a str, &'a serde_json::Value)>,
) -> WorkItemPartialUpdate {
    let mut update = WorkItemPartialUpdate::default();
    for (field, value) in iter {
        match field {
            "title" => {
                if let Some(s) = value.as_str() {
                    update.title = Some(s.to_string());
                }
            }
            "body" => {
                if let Some(s) = value.as_str() {
                    update.body = Some(s.to_string());
                }
            }
            "status" => {
                if let Some(s) = value.as_str() {
                    update.status = Some(s.to_string());
                }
            }
            "priority" => {
                if let Some(s) = value.as_str() {
                    update.priority = Some(s.to_string());
                }
            }
            "milestone" => {
                update.milestone = Some(value.as_str().map(str::to_string));
            }
            "start_date" => {
                update.start_date = Some(value.as_str().map(str::to_string));
            }
            "target_date" => {
                update.target_date = Some(value.as_str().map(str::to_string));
            }
            "labels" => {
                if let Some(arr) = value.as_array() {
                    let labels: Vec<String> = arr
                        .iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect();
                    update.labels = Some(labels);
                }
            }
            // `assignee` resolution requires a member-id lookup the
            // adapter is responsible for; the resolver will only see
            // strings the adapter has already resolved. If the value
            // isn't a string we leave it alone.
            "assignee" => {
                update.assignee = Some(value.as_str().map(str::to_string));
            }
            // Read-only mappings (e.g. `estimate`) reach this arm only
            // if a future adapter declares them writable; today's
            // schema doesn't have a column for them, so drop.
            other => {
                debug!(
                    "[sync::worker] merge: dropped unsupported field '{}' (no partial-update slot)",
                    other
                );
            }
        }
    }
    update
}

/// Map a [`WorkItemData`] down to the `(local_field_name → JSON)`
/// view that [`conflict_log::detect_conflicts`] expects. We only emit
/// the fields the adapter actually mapped — no need to materialize
/// values the resolver never inspects.
///
/// `Option<String>` fields serialize as `null` when absent, matching
/// the convention adapters use when emitting `ExternalChange.fields`.
pub(super) fn local_values_for_field_map(
    item: &WorkItemData,
    field_map: &FieldMap,
) -> serde_json::Map<String, serde_json::Value> {
    use serde_json::{json, Value};
    let fm = &item.frontmatter;
    let mut out = serde_json::Map::new();
    for mapping in field_map.mappings.iter() {
        let key = mapping.local.as_local_name().to_string();
        let value: Value = match mapping.local {
            EntityField::Title => json!(fm.title),
            EntityField::Body => json!(item.body),
            EntityField::Status => json!(fm.status),
            EntityField::Priority => json!(fm.priority),
            EntityField::Assignee => match &fm.assignee {
                Some(s) => json!(s),
                None => Value::Null,
            },
            EntityField::Milestone => match &fm.milestone {
                Some(s) => json!(s),
                None => Value::Null,
            },
            EntityField::StartDate => match &fm.start_date {
                Some(s) => json!(s),
                None => Value::Null,
            },
            EntityField::TargetDate => match &fm.target_date {
                Some(s) => json!(s),
                None => Value::Null,
            },
            EntityField::Estimate => Value::Null,
            EntityField::Labels => json!(fm.labels),
        };
        out.insert(key, value);
    }
    out
}
