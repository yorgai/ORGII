//! Persistent conflict audit + resolution log.
//!
//! When the merge-cycle resolver decides to **keep local** for a writable
//! field whose existing `FieldRevision.source = "local"` (i.e. the user
//! had written that field locally after the last successful merge), we
//! capture a [`ConflictRow`] in `outbox_conflicts`. The resolver still
//! applies its per-field verdict — the conflict row is the audit handle
//! the user uses afterward to either:
//!
//! - **Use local**  — re-push the local value as a fresh
//!   `OutboxOp::Update` so the next push cycle drives the remote back to
//!   the local writer's intent; or
//! - **Use remote** — overwrite the local value with the kept-local
//!   field's remote-side value, stamping the remote revision so the next
//!   merge cycle does not re-flag the same row; or
//! - **Dismiss**    — accept the resolver verdict as-is. State stays
//!   whatever the resolver wrote.
//!
//! # Why a sibling table, not a new `OutboxStatus`
//!
//! `OutboxStatus` is the lifecycle of a single outbox row. Conflicts
//! span **two** rows (the inbound `merge_external` row that triggered
//! the conflict, and the outbound `Update` row "Use local" produces),
//! plus a user-driven resolution clock that's orthogonal to outbox
//! retry/backoff. Keeping the audit log in its own table avoids
//! overloading `OutboxStatus` with a meaning the worker would have to
//! special-case in three places.
//!
//! # No string literals for resolution
//!
//! [`ConflictResolution`] is a typed enum with `as_db_str` /
//! `from_db_str` round-trip helpers, mirroring the project-store
//! convention. SQL parameters always come through the helpers.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::types::EntityType;

/// One audited conflict — the wire shape returned to the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictRow {
    pub id: i64,
    pub project_slug: String,
    pub adapter_id: String,
    pub entity_type: EntityType,
    /// Local short_id of the work item the conflict targets.
    pub entity_id: String,
    /// Adapter-supplied identifier for the same row on the remote side.
    pub external_id: String,
    /// Per-field local-vs-remote snapshot the UI renders.
    pub fields: ConflictFieldsPayload,
    /// Unix-epoch milliseconds when the resolver flagged the row.
    pub detected_at: i64,
    /// `None` while open; set to `Some(now_ms)` on resolve / dismiss.
    pub resolved_at: Option<i64>,
    /// `None` while open; set when `resolved_at` is set.
    pub resolution: Option<ConflictResolution>,
    /// `merge_external` outbox row id that produced the conflict.
    /// Carried for forensics — the row is GC'd on its own 7d schedule.
    pub source_outbox_id: Option<i64>,
}

/// JSON payload stored in `outbox_conflicts.fields_json`.
///
/// Keyed by **local** field name (matching `FieldMapping.local`'s
/// `as_local_name()`). The order of fields in the rendered UI is the
/// declaration order of `FieldMap.mappings`, derived at render time
/// rather than persisted; serde happily round-trips the underlying
/// `HashMap` regardless.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConflictFieldsPayload {
    pub fields: HashMap<String, ConflictFieldDelta>,
}

/// One field's snapshot at the moment the conflict was detected.
///
/// `applied` records which side the resolver actually wrote to the DB —
/// the UI uses it to label the "currently visible" value vs the "lost
/// side" value, so the user can tell at a glance which way they need to
/// nudge it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConflictFieldDelta {
    /// JSON value the local side held when the merge cycle ran.
    pub local_value: Value,
    /// JSON value the remote side carried in the merge_external payload.
    pub remote_value: Value,
    /// Watermark mtime (unix ms) on the local side.
    pub local_mtime: i64,
    /// `change.remote_updated_at.timestamp_millis()`.
    pub remote_mtime: i64,
    /// `FieldRevision.source` recorded on the local side.
    /// In practice always `"local"` for fields that produce a conflict
    /// — kept verbatim so a future "cross-adapter rewrite" case
    /// (`source = "linear"` losing to `"github_issues"`) is debuggable
    /// from the audit log without further log-spelunking.
    pub local_source: String,
    /// Adapter id of the inbound change.
    pub remote_source: String,
    /// Which side ended up in the local DB after the resolver's
    /// per-field verdict (`local` for kept-local fields, `remote` for
    /// adopted fields). `local` is the only value that produces a
    /// conflict row today, but the field is captured eagerly so a
    /// future "log cross-adapter overwrites too" extension is
    /// schema-compatible.
    pub applied: AppliedSide,
}

/// Which side of the conflict is currently materialized in the local
/// DB after the resolver wrote its verdict.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AppliedSide {
    Local,
    Remote,
}

/// User-driven resolution choice. `Dismissed` is distinct from a missing
/// resolution: the row is closed but no fields were touched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictResolution {
    UseLocal,
    UseRemote,
    Dismissed,
}

impl ConflictResolution {
    pub fn as_db_str(self) -> &'static str {
        match self {
            ConflictResolution::UseLocal => "use_local",
            ConflictResolution::UseRemote => "use_remote",
            ConflictResolution::Dismissed => "dismissed",
        }
    }

    pub fn from_db_str(value: &str) -> Result<Self, String> {
        match value {
            "use_local" => Ok(ConflictResolution::UseLocal),
            "use_remote" => Ok(ConflictResolution::UseRemote),
            "dismissed" => Ok(ConflictResolution::Dismissed),
            other => Err(format!("unknown ConflictResolution: {}", other)),
        }
    }
}

/// Append one detected conflict.
///
/// Returns the assigned row id. Caller must already have decided the
/// row deserves an audit entry — `record_detected` does no detection
/// itself; it is the persistence half of [`detect_conflicts`].
#[allow(clippy::too_many_arguments)]
pub fn record_detected(
    c: &Connection,
    project_slug: &str,
    adapter_id: &str,
    entity_type: EntityType,
    entity_id: &str,
    external_id: &str,
    fields: &ConflictFieldsPayload,
    detected_at_ms: i64,
    source_outbox_id: Option<i64>,
) -> Result<i64, String> {
    let fields_json = serde_json::to_string(fields)
        .map_err(|err| format!("serialize ConflictFieldsPayload: {}", err))?;
    c.execute(
        "INSERT INTO outbox_conflicts
            (project_slug, adapter_id, entity_type, entity_id, external_id,
             fields_json, detected_at, resolved_at, resolution, source_outbox_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, ?8)",
        params![
            project_slug,
            adapter_id,
            entity_type.as_db_str(),
            entity_id,
            external_id,
            fields_json,
            detected_at_ms,
            source_outbox_id,
        ],
    )
    .map_err(|err| format!("DB error (insert outbox_conflicts): {}", err))?;
    Ok(c.last_insert_rowid())
}

/// Read one conflict row by id. Returns `Ok(None)` if absent so
/// resolution commands can distinguish "already-resolved by a
/// concurrent click" from a hard error.
pub fn read_one(c: &Connection, id: i64) -> Result<Option<ConflictRow>, String> {
    c.query_row(
        "SELECT id, project_slug, adapter_id, entity_type, entity_id,
                external_id, fields_json, detected_at, resolved_at,
                resolution, source_outbox_id
           FROM outbox_conflicts
          WHERE id = ?1",
        params![id],
        row_to_conflict,
    )
    .optional()
    .map_err(|err| format!("DB error (read_one outbox_conflicts): {}", err))?
    .transpose()
}

/// List all conflicts for a project, open rows first (newest detected
/// at top), followed by recently-resolved rows. The UI shows the open
/// list inline and offers a "Show recently resolved" toggle for the
/// tail.
///
/// `resolved_limit` caps the resolved-row tail. Open rows are never
/// truncated — the full backlog matters for the user's correctness
/// model and tends to be small (single-digit in healthy projects).
pub fn list_for_project(
    c: &Connection,
    project_slug: &str,
    resolved_limit: usize,
) -> Result<Vec<ConflictRow>, String> {
    let mut stmt = c
        .prepare(
            "SELECT id, project_slug, adapter_id, entity_type, entity_id,
                    external_id, fields_json, detected_at, resolved_at,
                    resolution, source_outbox_id
               FROM outbox_conflicts
              WHERE project_slug = ?1 AND resolved_at IS NULL
              ORDER BY detected_at DESC, id DESC",
        )
        .map_err(|err| format!("DB error (prepare list open): {}", err))?;
    let open_rows = stmt
        .query_map(params![project_slug], row_to_conflict)
        .map_err(|err| format!("DB error (query open): {}", err))?;
    let mut out: Vec<ConflictRow> = Vec::new();
    for row in open_rows {
        out.push(row.map_err(|err| format!("DB error (row open): {}", err))??);
    }

    if resolved_limit == 0 {
        return Ok(out);
    }

    let mut stmt_done = c
        .prepare(
            "SELECT id, project_slug, adapter_id, entity_type, entity_id,
                    external_id, fields_json, detected_at, resolved_at,
                    resolution, source_outbox_id
               FROM outbox_conflicts
              WHERE project_slug = ?1 AND resolved_at IS NOT NULL
              ORDER BY resolved_at DESC, id DESC
              LIMIT ?2",
        )
        .map_err(|err| format!("DB error (prepare list resolved): {}", err))?;
    let resolved_rows = stmt_done
        .query_map(
            params![project_slug, resolved_limit as i64],
            row_to_conflict,
        )
        .map_err(|err| format!("DB error (query resolved): {}", err))?;
    for row in resolved_rows {
        out.push(row.map_err(|err| format!("DB error (row resolved): {}", err))??);
    }

    Ok(out)
}

/// Mark an open conflict resolved. The caller is responsible for any
/// side effects (re-pushing, overwriting local) **before** calling
/// this — `mark_resolved` is the bookkeeping half.
///
/// Returns:
/// - `Ok(true)`  — row existed and was open; transitioned to resolved.
/// - `Ok(false)` — row existed but was already resolved (idempotent
///   second click); no-op.
/// - `Err(_)`    — row id absent or DB error.
pub fn mark_resolved(
    c: &Connection,
    id: i64,
    resolution: ConflictResolution,
    resolved_at_ms: i64,
) -> Result<bool, String> {
    let updated = c
        .execute(
            "UPDATE outbox_conflicts
                SET resolved_at = ?1,
                    resolution  = ?2
              WHERE id = ?3 AND resolved_at IS NULL",
            params![resolved_at_ms, resolution.as_db_str(), id],
        )
        .map_err(|err| format!("DB error (mark_resolved): {}", err))?;
    if updated > 0 {
        return Ok(true);
    }
    // Distinguish "already resolved" from "id does not exist": the
    // commands layer treats the former as a benign no-op and the
    // latter as a user-facing error.
    let exists: bool = c
        .query_row(
            "SELECT 1 FROM outbox_conflicts WHERE id = ?1",
            params![id],
            |_| Ok(true),
        )
        .optional()
        .map_err(|err| format!("DB error (exists check): {}", err))?
        .unwrap_or(false);
    if exists {
        Ok(false)
    } else {
        Err(format!("conflict row {} not found", id))
    }
}

/// Count open conflicts per project. Used by the SyncSection panel
/// header ("Conflicts (3)") and surfaced in `SyncStatusEvent` so the
/// status bar widget can show a chip without a second round-trip.
pub fn count_open(c: &Connection, project_slug: &str) -> Result<i64, String> {
    let count: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM outbox_conflicts
              WHERE project_slug = ?1 AND resolved_at IS NULL",
            params![project_slug],
            |row| row.get(0),
        )
        .map_err(|err| format!("DB error (count_open): {}", err))?;
    Ok(count)
}

/// Detect conflicts in one inbound `merge_external` row.
///
/// Run **after** the resolver has produced its `ResolverDecision` and
/// **before** the worker writes the per-field updates. The returned
/// payload is empty when no conflict exists; callers append a
/// [`record_detected`] row only when `payload.fields` is non-empty.
///
/// Conflict criterion:
/// 1. Local has a `FieldRevision { source, mtime }` recorded for the
///    field; AND
/// 2. `source == "local"` (the user wrote it locally after the last
///    successful merge); AND
/// 3. The remote payload included a value for that field; AND
/// 4. The local mtime is **strictly greater** than `remote_mtime` —
///    i.e. the resolver decided to keep local. The "first sight"
///    branch (`source != "local"` or no revision recorded) is **not**
///    a conflict; remote wins clean and there's nothing for the user
///    to disambiguate.
///
/// `local_values` is the local view of the work item rendered as a
/// JSON object keyed by the same `EntityField::as_local_name()`
/// strings the resolver / change payload use. The caller (worker)
/// builds it once from `WorkItemFrontmatter` so this function can run
/// pure on Values without re-reading the DB.
pub fn detect_conflicts(
    change: &super::adapter::ExternalChange,
    metadata: &crate::projects::io::SyncMetadata,
    field_map: &super::adapter::FieldMap,
    local_values: &serde_json::Map<String, Value>,
    adapter_id: &str,
) -> ConflictFieldsPayload {
    let mut payload = ConflictFieldsPayload::default();

    // Tombstones don't surface as field-level conflicts — the
    // remote-driven delete path handles them whole-entity. Same
    // short-circuit the resolver uses.
    if change.deleted {
        return payload;
    }

    let remote_obj = match change.fields.as_object() {
        Some(obj) => obj,
        None => return payload,
    };
    let remote_mtime = change.remote_updated_at.timestamp_millis();

    for mapping in field_map.mappings.iter() {
        if !mapping.writable {
            continue;
        }
        let local_name = mapping.local.as_local_name();
        let Some(remote_value) = remote_obj.get(local_name) else {
            continue;
        };
        let Some(rev) = metadata.field_revisions.get(local_name) else {
            continue;
        };
        if rev.source != "local" {
            continue;
        }
        if rev.mtime <= remote_mtime {
            continue;
        }
        // Genuine conflict: local user-edit beats fresher-but-stale
        // remote. The resolver will keep local for this field, so
        // `applied = Local`. We capture both sides for the UI.
        let local_value = local_values.get(local_name).cloned().unwrap_or(Value::Null);
        payload.fields.insert(
            local_name.to_string(),
            ConflictFieldDelta {
                local_value,
                remote_value: remote_value.clone(),
                local_mtime: rev.mtime,
                remote_mtime,
                local_source: rev.source.clone(),
                remote_source: adapter_id.to_string(),
                applied: AppliedSide::Local,
            },
        );
    }

    payload
}

/// Resolve "Use local": for every conflicting field, the user wants
/// the local value to overwrite the remote one. Returns the
/// `(field_name, local_value)` pairs the caller should reconstruct
/// into an `OutboxOp::Update` payload.
///
/// Pure helper — does no IO. The caller (commands layer) handles the
/// outbox append + the `mark_resolved` call inside one transaction.
pub fn use_local_payload(row: &ConflictRow) -> serde_json::Map<String, Value> {
    let mut map = serde_json::Map::new();
    for (field, delta) in row.fields.fields.iter() {
        map.insert(field.clone(), delta.local_value.clone());
    }
    map
}

/// Resolve "Use remote": for every conflicting field, the user wants
/// the remote value to overwrite the local one. Returns the
/// `(field_name, remote_value)` pairs the caller should fold into a
/// `WorkItemPartialUpdate`.
pub fn use_remote_payload(row: &ConflictRow) -> serde_json::Map<String, Value> {
    let mut map = serde_json::Map::new();
    for (field, delta) in row.fields.fields.iter() {
        map.insert(field.clone(), delta.remote_value.clone());
    }
    map
}

/// Build the `field → FieldRevision` map the caller stamps when
/// applying "Use remote": each field gets the remote revision
/// (`mtime = remote_mtime`, `source = remote_source`) so the next
/// merge cycle does not re-flag the same row.
pub fn use_remote_revisions(
    row: &ConflictRow,
) -> HashMap<String, crate::projects::io::FieldRevision> {
    use crate::projects::io::FieldRevision;
    let mut map = HashMap::new();
    for (field, delta) in row.fields.fields.iter() {
        map.insert(
            field.clone(),
            FieldRevision {
                mtime: delta.remote_mtime,
                source: delta.remote_source.clone(),
            },
        );
    }
    map
}

fn row_to_conflict(row: &rusqlite::Row<'_>) -> rusqlite::Result<Result<ConflictRow, String>> {
    let id: i64 = row.get(0)?;
    let project_slug: String = row.get(1)?;
    let adapter_id: String = row.get(2)?;
    let entity_type_db: String = row.get(3)?;
    let entity_id: String = row.get(4)?;
    let external_id: String = row.get(5)?;
    let fields_json: String = row.get(6)?;
    let detected_at: i64 = row.get(7)?;
    let resolved_at: Option<i64> = row.get(8)?;
    let resolution_db: Option<String> = row.get(9)?;
    let source_outbox_id: Option<i64> = row.get(10)?;

    let parsed = (|| -> Result<ConflictRow, String> {
        let entity_type = EntityType::from_db_str(&entity_type_db)?;
        let fields: ConflictFieldsPayload = serde_json::from_str(&fields_json)
            .map_err(|err| format!("parse fields_json: {}", err))?;
        let resolution = match resolution_db {
            Some(s) => Some(ConflictResolution::from_db_str(&s)?),
            None => None,
        };
        Ok(ConflictRow {
            id,
            project_slug,
            adapter_id,
            entity_type,
            entity_id,
            external_id,
            fields,
            detected_at,
            resolved_at,
            resolution,
            source_outbox_id,
        })
    })();
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::io::{FieldRevision, SyncMetadata};
    use crate::projects::schema::init_outbox_conflicts_table;
    use crate::sync::adapter::{EntityField, FieldMap, FieldMapping};
    use chrono::{TimeZone, Utc};
    use serde_json::json;

    static TEST_FIELD_MAP: FieldMap = FieldMap {
        mappings: &[
            FieldMapping {
                local: EntityField::Title,
                remote: "title",
                writable: true,
            },
            FieldMapping {
                local: EntityField::Status,
                remote: "state",
                writable: true,
            },
            FieldMapping {
                local: EntityField::Assignee,
                remote: "assignee",
                writable: false, // read-only
            },
        ],
    };

    fn external_change(
        remote_mtime_ms: i64,
        fields: Value,
    ) -> super::super::adapter::ExternalChange {
        super::super::adapter::ExternalChange {
            entity_type: EntityType::WorkItem,
            external_id: "ext-1".to_string(),
            local_entity_id: None,
            fields,
            remote_updated_at: Utc.timestamp_millis_opt(remote_mtime_ms).unwrap(),
            deleted: false,
        }
    }

    fn metadata_with(revisions: &[(&str, i64, &str)]) -> SyncMetadata {
        let mut m = SyncMetadata::default();
        for (name, mtime, source) in revisions {
            m.field_revisions.insert(
                name.to_string(),
                FieldRevision {
                    mtime: *mtime,
                    source: source.to_string(),
                },
            );
        }
        m
    }

    fn local_values(pairs: &[(&str, Value)]) -> serde_json::Map<String, Value> {
        let mut map = serde_json::Map::new();
        for (k, v) in pairs {
            map.insert(k.to_string(), v.clone());
        }
        map
    }

    fn open_in_memory_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-mem");
        init_outbox_conflicts_table(&conn).expect("init schema");
        conn
    }

    #[test]
    fn detect_no_conflict_when_no_local_revision() {
        // First-sight branch: resolver adopts remote; no conflict to log.
        let metadata = SyncMetadata::default();
        let change = external_change(1_700_000_000_000, json!({ "title": "remote" }));
        let payload = detect_conflicts(
            &change,
            &metadata,
            &TEST_FIELD_MAP,
            &local_values(&[("title", json!("local"))]),
            "linear",
        );
        assert!(payload.fields.is_empty());
    }

    #[test]
    fn detect_no_conflict_when_local_source_is_adapter() {
        // Local watermark exists but it came from a previous remote
        // merge — not a user edit. No conflict.
        let metadata = metadata_with(&[("title", 2_000_000_000_000, "linear")]);
        let change = external_change(1_700_000_000_000, json!({ "title": "remote" }));
        let payload = detect_conflicts(
            &change,
            &metadata,
            &TEST_FIELD_MAP,
            &local_values(&[("title", json!("local"))]),
            "linear",
        );
        assert!(payload.fields.is_empty());
    }

    #[test]
    fn detect_no_conflict_when_remote_is_newer() {
        // Local user-edited at t1, remote even fresher at t2 — resolver
        // adopts remote; no conflict.
        let metadata = metadata_with(&[("title", 1_500_000_000_000, "local")]);
        let change = external_change(1_700_000_000_000, json!({ "title": "remote" }));
        let payload = detect_conflicts(
            &change,
            &metadata,
            &TEST_FIELD_MAP,
            &local_values(&[("title", json!("local"))]),
            "linear",
        );
        assert!(payload.fields.is_empty());
    }

    #[test]
    fn detect_conflict_when_local_user_edit_beats_remote() {
        // Local user-edit at t2 beats remote at t1: resolver keeps
        // local; conflict logged with both sides + applied=Local.
        let metadata = metadata_with(&[("title", 2_000_000_000_000, "local")]);
        let change = external_change(1_700_000_000_000, json!({ "title": "remote-stale" }));
        let payload = detect_conflicts(
            &change,
            &metadata,
            &TEST_FIELD_MAP,
            &local_values(&[("title", json!("local-fresh"))]),
            "linear",
        );
        assert_eq!(payload.fields.len(), 1);
        let delta = payload.fields.get("title").expect("title delta");
        assert_eq!(delta.local_value, json!("local-fresh"));
        assert_eq!(delta.remote_value, json!("remote-stale"));
        assert_eq!(delta.local_mtime, 2_000_000_000_000);
        assert_eq!(delta.remote_mtime, 1_700_000_000_000);
        assert_eq!(delta.local_source, "local");
        assert_eq!(delta.remote_source, "linear");
        assert_eq!(delta.applied, AppliedSide::Local);
    }

    #[test]
    fn detect_skips_read_only_fields() {
        // Even a clear conflict on a read-only field doesn't surface —
        // the resolver never writes it, so there's no UI action.
        let metadata = metadata_with(&[("assignee", 2_000_000_000_000, "local")]);
        let change = external_change(
            1_700_000_000_000,
            json!({ "assignee": "alice", "title": "x" }),
        );
        let payload = detect_conflicts(
            &change,
            &metadata,
            &TEST_FIELD_MAP,
            &local_values(&[("assignee", json!("bob")), ("title", json!("x"))]),
            "linear",
        );
        assert!(!payload.fields.contains_key("assignee"));
    }

    #[test]
    fn detect_no_conflict_for_tombstone() {
        let metadata = metadata_with(&[("title", 2_000_000_000_000, "local")]);
        let mut change = external_change(1_700_000_000_000, json!({}));
        change.deleted = true;
        let payload = detect_conflicts(
            &change,
            &metadata,
            &TEST_FIELD_MAP,
            &local_values(&[("title", json!("x"))]),
            "linear",
        );
        assert!(payload.fields.is_empty());
    }

    #[test]
    fn record_and_read_round_trip() {
        let conn = open_in_memory_db();
        let mut payload = ConflictFieldsPayload::default();
        payload.fields.insert(
            "title".into(),
            ConflictFieldDelta {
                local_value: json!("local"),
                remote_value: json!("remote"),
                local_mtime: 2_000_000_000_000,
                remote_mtime: 1_700_000_000_000,
                local_source: "local".into(),
                remote_source: "linear".into(),
                applied: AppliedSide::Local,
            },
        );

        let id = record_detected(
            &conn,
            "alpha",
            "linear",
            EntityType::WorkItem,
            "WI-1",
            "ext-1",
            &payload,
            12345,
            Some(99),
        )
        .expect("record");
        let fetched = read_one(&conn, id).expect("read").expect("present");
        assert_eq!(fetched.id, id);
        assert_eq!(fetched.project_slug, "alpha");
        assert_eq!(fetched.entity_id, "WI-1");
        assert_eq!(fetched.external_id, "ext-1");
        assert_eq!(fetched.detected_at, 12345);
        assert!(fetched.resolved_at.is_none());
        assert!(fetched.resolution.is_none());
        assert_eq!(fetched.source_outbox_id, Some(99));
        assert_eq!(fetched.fields.fields.len(), 1);
    }

    #[test]
    fn list_for_project_orders_open_first_then_resolved() {
        let conn = open_in_memory_db();
        let payload = ConflictFieldsPayload::default();

        // Three open + two resolved across two projects.
        record_detected(
            &conn,
            "alpha",
            "linear",
            EntityType::WorkItem,
            "WI-1",
            "e1",
            &payload,
            100,
            None,
        )
        .unwrap();
        let id_open_2 = record_detected(
            &conn,
            "alpha",
            "linear",
            EntityType::WorkItem,
            "WI-2",
            "e2",
            &payload,
            200,
            None,
        )
        .unwrap();
        record_detected(
            &conn,
            "alpha",
            "linear",
            EntityType::WorkItem,
            "WI-3",
            "e3",
            &payload,
            300,
            None,
        )
        .unwrap();
        // Resolved rows.
        let id_resolved_a = record_detected(
            &conn,
            "alpha",
            "linear",
            EntityType::WorkItem,
            "WI-4",
            "e4",
            &payload,
            50,
            None,
        )
        .unwrap();
        let id_resolved_b = record_detected(
            &conn,
            "alpha",
            "linear",
            EntityType::WorkItem,
            "WI-5",
            "e5",
            &payload,
            60,
            None,
        )
        .unwrap();
        mark_resolved(&conn, id_resolved_a, ConflictResolution::UseLocal, 1000).unwrap();
        mark_resolved(&conn, id_resolved_b, ConflictResolution::UseRemote, 2000).unwrap();
        // Sibling project: should not appear in alpha listing.
        record_detected(
            &conn,
            "beta",
            "linear",
            EntityType::WorkItem,
            "WB-1",
            "e6",
            &payload,
            400,
            None,
        )
        .unwrap();

        let listed = list_for_project(&conn, "alpha", 10).expect("list");
        // Order: 3 open (newest detected first), then 2 resolved (newest resolved first).
        assert_eq!(listed.len(), 5);
        assert_eq!(listed[0].entity_id, "WI-3");
        assert_eq!(listed[1].entity_id, "WI-2");
        assert_eq!(listed[1].id, id_open_2);
        assert_eq!(listed[2].entity_id, "WI-1");
        // Resolved tail: WI-5 resolved at 2000 first, WI-4 at 1000.
        assert_eq!(listed[3].entity_id, "WI-5");
        assert_eq!(listed[4].entity_id, "WI-4");
    }

    #[test]
    fn list_for_project_with_zero_limit_skips_resolved() {
        let conn = open_in_memory_db();
        let payload = ConflictFieldsPayload::default();
        let id = record_detected(
            &conn,
            "alpha",
            "linear",
            EntityType::WorkItem,
            "WI-1",
            "e1",
            &payload,
            100,
            None,
        )
        .unwrap();
        mark_resolved(&conn, id, ConflictResolution::Dismissed, 1000).unwrap();
        let listed = list_for_project(&conn, "alpha", 0).expect("list");
        assert!(listed.is_empty());
    }

    #[test]
    fn mark_resolved_is_idempotent_returns_false_on_second_call() {
        let conn = open_in_memory_db();
        let payload = ConflictFieldsPayload::default();
        let id = record_detected(
            &conn,
            "alpha",
            "linear",
            EntityType::WorkItem,
            "WI-1",
            "e1",
            &payload,
            100,
            None,
        )
        .unwrap();
        let first = mark_resolved(&conn, id, ConflictResolution::UseLocal, 1000).expect("first");
        assert!(first);
        let second = mark_resolved(&conn, id, ConflictResolution::UseRemote, 2000).expect("second");
        assert!(!second);
        // Resolution + resolved_at do NOT change on the second call.
        let row = read_one(&conn, id).unwrap().unwrap();
        assert_eq!(row.resolution, Some(ConflictResolution::UseLocal));
        assert_eq!(row.resolved_at, Some(1000));
    }

    #[test]
    fn mark_resolved_unknown_id_errors() {
        let conn = open_in_memory_db();
        let result = mark_resolved(&conn, 9999, ConflictResolution::UseLocal, 1000);
        assert!(result.is_err());
    }

    #[test]
    fn count_open_only_counts_open_rows() {
        let conn = open_in_memory_db();
        let payload = ConflictFieldsPayload::default();
        let a = record_detected(
            &conn,
            "alpha",
            "linear",
            EntityType::WorkItem,
            "WI-1",
            "e1",
            &payload,
            100,
            None,
        )
        .unwrap();
        record_detected(
            &conn,
            "alpha",
            "linear",
            EntityType::WorkItem,
            "WI-2",
            "e2",
            &payload,
            200,
            None,
        )
        .unwrap();
        record_detected(
            &conn,
            "beta",
            "linear",
            EntityType::WorkItem,
            "WB-1",
            "e3",
            &payload,
            300,
            None,
        )
        .unwrap();
        mark_resolved(&conn, a, ConflictResolution::Dismissed, 1000).unwrap();
        assert_eq!(count_open(&conn, "alpha").unwrap(), 1);
        assert_eq!(count_open(&conn, "beta").unwrap(), 1);
        assert_eq!(count_open(&conn, "gamma").unwrap(), 0);
    }

    #[test]
    fn use_local_and_use_remote_payloads_extract_correct_sides() {
        let mut payload = ConflictFieldsPayload::default();
        payload.fields.insert(
            "title".into(),
            ConflictFieldDelta {
                local_value: json!("local-T"),
                remote_value: json!("remote-T"),
                local_mtime: 200,
                remote_mtime: 100,
                local_source: "local".into(),
                remote_source: "linear".into(),
                applied: AppliedSide::Local,
            },
        );
        payload.fields.insert(
            "status".into(),
            ConflictFieldDelta {
                local_value: json!("in_progress"),
                remote_value: json!("done"),
                local_mtime: 200,
                remote_mtime: 100,
                local_source: "local".into(),
                remote_source: "linear".into(),
                applied: AppliedSide::Local,
            },
        );
        let row = ConflictRow {
            id: 1,
            project_slug: "alpha".into(),
            adapter_id: "linear".into(),
            entity_type: EntityType::WorkItem,
            entity_id: "WI-1".into(),
            external_id: "ext-1".into(),
            fields: payload,
            detected_at: 12345,
            resolved_at: None,
            resolution: None,
            source_outbox_id: None,
        };
        let local = use_local_payload(&row);
        assert_eq!(local["title"], json!("local-T"));
        assert_eq!(local["status"], json!("in_progress"));

        let remote = use_remote_payload(&row);
        assert_eq!(remote["title"], json!("remote-T"));
        assert_eq!(remote["status"], json!("done"));

        let revs = use_remote_revisions(&row);
        assert_eq!(revs["title"].mtime, 100);
        assert_eq!(revs["title"].source, "linear");
        assert_eq!(revs["status"].mtime, 100);
    }

    #[test]
    fn resolution_db_string_round_trip() {
        for r in [
            ConflictResolution::UseLocal,
            ConflictResolution::UseRemote,
            ConflictResolution::Dismissed,
        ] {
            assert_eq!(ConflictResolution::from_db_str(r.as_db_str()).unwrap(), r);
        }
        assert!(ConflictResolution::from_db_str("nope").is_err());
    }
}
