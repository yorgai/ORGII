//! Conflict-resolution E2E scenarios (`--group sync`).
//!
//! Each scenario drives the full conflict-detection + resolution
//! lifecycle:
//!
//!   1. Seed a project + attach the Echo adapter.
//!   2. Seed a work item with per-field local-source `FieldRevision`s
//!      whose `mtime` is strictly greater than the inbound merge's
//!      `remote_updated_at` (the precondition the resolver needs to
//!      verdict "keep local", which is the precondition
//!      `conflict_log::detect_conflicts` needs to record an audit row).
//!   3. Append a `merge_external` outbox row with conflicting remote
//!      fields, then drain it through `merge_cycle`.
//!   4. Read back `conflict_log::list_for_project` and assert one
//!      open row with the expected fields.
//!   5. Resolve via one of `use_local` / `use_remote` / `dismiss` and
//!      assert the resolution's documented effect:
//!        - `use_local`  → row stamped resolved, fresh `Update`
//!          outbox row appended for re-push, local fields unchanged.
//!        - `use_remote` → row stamped resolved, local fields rewritten
//!          to the remote value, no new outbox push row.
//!        - `dismiss`    → row stamped resolved, local fields and
//!          outbox both unchanged.
//!   6. Idempotency: a second call against the same conflict id is a
//!      benign no-op (the resolver's documented "already resolved →
//!      Ok(())" branch).
//!
//! Each scenario uses a freshly-minted slug + `cleanup` finally block
//! so it can interleave with other groups without cross-talk; the
//! cleanup endpoint also wipes `outbox_conflicts` rows, so rerunning
//! a scenario against the same slug starts from a clean slate.

use serde_json::{json, Value};

use super::config::Config;
use super::sync::{
    cleanup, get_json_query, post_json, run_scenario_with_cleanup, seed_project_with_adapter,
    unique_slug,
};

const ADAPTER_ID: &str = "echo";
const SHORT_ID: &str = "WI-1";
const EXTERNAL_ID: &str = "EXT-CONFLICT-1";
const LOCAL_TITLE: &str = "Local Title";
const LOCAL_STATUS: &str = "todo";
const REMOTE_TITLE: &str = "Remote Title";
const REMOTE_STATUS: &str = "in_progress";

/// Wall-clock millis stamp used as the seeded local revision's
/// `mtime`. The injected merge uses this minus an hour, which is
/// well outside the resolver's tie-break tolerance and reliably
/// trips the "keep local" verdict regardless of the adapter's
/// per-field tolerance config.
const LOCAL_MTIME_MS: i64 = 1_730_000_000_000; // 2024-10-27, deterministic
const REMOTE_UPDATED_AT_MS: i64 = LOCAL_MTIME_MS - 3_600_000;

// ============================================================================
// Debug-endpoint wrappers
// ============================================================================

async fn seed_work_item(cfg: &Config, slug: &str) -> Result<(), String> {
    post_json(
        cfg,
        "/agent/test/sync/conflict/seed-work-item",
        &json!({
            "slug": slug,
            "adapter_id": ADAPTER_ID,
            "short_id": SHORT_ID,
            "external_id": EXTERNAL_ID,
            "title": LOCAL_TITLE,
            "status": LOCAL_STATUS,
            "local_mtime_ms": LOCAL_MTIME_MS,
        }),
    )
    .await
    .map(|_| ())
}

async fn inject_merge_external(cfg: &Config, slug: &str) -> Result<(), String> {
    post_json(
        cfg,
        "/agent/test/sync/conflict/inject-merge-external",
        &json!({
            "slug": slug,
            "external_id": EXTERNAL_ID,
            "remote_fields": {
                "title": REMOTE_TITLE,
                "status": REMOTE_STATUS,
            },
            "remote_updated_at_ms": REMOTE_UPDATED_AT_MS,
        }),
    )
    .await
    .map(|_| ())
}

async fn pump_merge(cfg: &Config, slug: &str) -> Result<u64, String> {
    let value = post_json(
        cfg,
        "/agent/test/sync/conflict/pump-merge",
        &json!({ "slug": slug }),
    )
    .await?;
    Ok(value.get("processed").and_then(|v| v.as_u64()).unwrap_or(0))
}

async fn list_conflicts(cfg: &Config, slug: &str) -> Result<Vec<Value>, String> {
    let value = get_json_query(cfg, "/agent/test/sync/conflict/list", &[("slug", slug)]).await?;
    Ok(value
        .get("rows")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default())
}

async fn use_local(cfg: &Config, conflict_id: i64) -> Result<(), String> {
    post_json(
        cfg,
        "/agent/test/sync/conflict/use-local",
        &json!({ "conflict_id": conflict_id }),
    )
    .await
    .map(|_| ())
}

async fn use_remote(cfg: &Config, conflict_id: i64) -> Result<(), String> {
    post_json(
        cfg,
        "/agent/test/sync/conflict/use-remote",
        &json!({ "conflict_id": conflict_id }),
    )
    .await
    .map(|_| ())
}

async fn dismiss(cfg: &Config, conflict_id: i64) -> Result<(), String> {
    post_json(
        cfg,
        "/agent/test/sync/conflict/dismiss",
        &json!({ "conflict_id": conflict_id }),
    )
    .await
    .map(|_| ())
}

async fn read_work_item(cfg: &Config, slug: &str) -> Result<Value, String> {
    let value = get_json_query(
        cfg,
        "/agent/test/sync/conflict/work-item",
        &[("slug", slug), ("short_id", SHORT_ID)],
    )
    .await?;
    value
        .get("item")
        .cloned()
        .ok_or_else(|| "work-item response missing 'item'".to_string())
}

/// Count `merge_external`-free Pending rows on the slug. Pulls the
/// same shape the existing webhook scenarios use for outbox
/// inspection. A fresh `Update` enqueued by `use_local` lands here.
async fn pending_count(cfg: &Config, slug: &str) -> Result<u64, String> {
    let value = get_json_query(cfg, "/agent/test/sync/status", &[("slug", slug)]).await?;
    Ok(value
        .pointer("/report/pending_count")
        .and_then(|n| n.as_u64())
        .unwrap_or(0))
}

// ============================================================================
// Helpers
// ============================================================================

fn first_conflict_id(rows: &[Value]) -> Option<i64> {
    rows.first()
        .and_then(|row| row.get("id"))
        .and_then(|v| v.as_i64())
}

fn read_resolution(row: &Value) -> Option<&str> {
    row.get("resolution").and_then(|v| v.as_str())
}

fn read_resolved_at(row: &Value) -> Option<i64> {
    row.get("resolved_at").and_then(|v| v.as_i64())
}

fn fields_count(row: &Value) -> usize {
    // `fields_json` deserializes as `ConflictFieldsPayload`, which
    // serializes as `{ fields: { <field_name>: ConflictFieldDelta }}`
    // — an Object keyed by field name, not an array.
    row.pointer("/fields/fields")
        .and_then(|v| v.as_object())
        .map(|obj| obj.len())
        .unwrap_or(0)
}

fn row_title(row: &Value) -> Option<String> {
    row.get("title")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

fn row_status(row: &Value) -> Option<String> {
    row.get("status")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

// ============================================================================
// Scenarios
// ============================================================================

/// "Use local": the user keeps their value. The resolver appended
/// no push row of its own (the verdict is "keep local"), so the
/// only signal a re-push is needed is the outbox row this command
/// appends. Local fields stay put.
///
/// Pins:
/// - `detect_conflicts` records a row covering both `title` and
///   `status` (the only two fields Echo's `entity_field_map`
///   advertises).
/// - `project_sync_conflict_use_local` appends exactly one
///   `OutboxOp::Update` row (one row, not one per field — the
///   payload is a single partial update).
/// - The conflict row transitions to `resolution = "use_local"`
///   and gets a non-null `resolved_at`.
/// - Calling `use_local` again is a no-op (idempotency).
pub async fn conflict_use_local_repushes_local(cfg: &Config) -> bool {
    let name = "Sync: Conflict Use Local";
    let slug = unique_slug("conflict-use-local");
    let scenario_slug = slug.clone();
    run_scenario_with_cleanup(
        name,
        || async {
            seed_project_with_adapter(cfg, &slug, ADAPTER_ID).await?;
            seed_work_item(cfg, &slug).await?;
            inject_merge_external(cfg, &slug).await?;

            let pending_pre_pump = pending_count(cfg, &slug).await?;
            let processed = pump_merge(cfg, &slug).await?;

            let rows_after_pump = list_conflicts(cfg, &slug).await?;
            let conflict_id = first_conflict_id(&rows_after_pump)
                .ok_or_else(|| "no conflict row recorded after merge pump".to_string())?;
            let row_after_detect = rows_after_pump[0].clone();

            let pending_after_detect = pending_count(cfg, &slug).await?;
            use_local(cfg, conflict_id).await?;
            let pending_after_use_local = pending_count(cfg, &slug).await?;

            let rows_after_resolve = list_conflicts(cfg, &slug).await?;
            let row_after_resolve = rows_after_resolve
                .iter()
                .find(|r| r.get("id").and_then(|v| v.as_i64()) == Some(conflict_id))
                .cloned()
                .ok_or_else(|| "resolved row vanished from list".to_string())?;

            // Idempotency: second click — should be a benign no-op.
            use_local(cfg, conflict_id).await?;
            let pending_after_idempotent = pending_count(cfg, &slug).await?;

            // Local fields must be unchanged — "use local" never
            // touches the local row, only the outbox.
            let item = read_work_item(cfg, &slug).await?;

            let summary = json!({
                "processed_merge": processed,
                "pending_pre_pump": pending_pre_pump,
                "pending_after_detect": pending_after_detect,
                "pending_after_use_local": pending_after_use_local,
                "pending_after_idempotent": pending_after_idempotent,
                "row_after_detect": row_after_detect,
                "row_after_resolve": row_after_resolve,
                "item": item,
            });

            let checks = vec![
                ("merge_cycle drained the injected row", processed >= 1),
                (
                    "Pre-pump: merge_external row was the only Pending one",
                    pending_pre_pump == 1,
                ),
                (
                    "Conflict row records both Echo-mapped fields",
                    fields_count(&row_after_detect) == 2,
                ),
                (
                    "Detected conflict starts unresolved",
                    read_resolved_at(&row_after_detect).is_none()
                        && read_resolution(&row_after_detect).is_none(),
                ),
                (
                    "After detection: merge_cycle drained the row to Succeeded",
                    pending_after_detect == 0,
                ),
                (
                    "use_local appends exactly one Update outbox row",
                    pending_after_use_local == pending_after_detect + 1,
                ),
                (
                    "Conflict row stamped resolution = 'use_local'",
                    read_resolution(&row_after_resolve) == Some("use_local"),
                ),
                (
                    "Conflict row gained a non-null resolved_at",
                    read_resolved_at(&row_after_resolve).is_some(),
                ),
                (
                    "Idempotent re-click: pending count unchanged",
                    pending_after_idempotent == pending_after_use_local,
                ),
                (
                    "Local title preserved (user kept their version)",
                    row_title(&item).as_deref() == Some(LOCAL_TITLE),
                ),
                (
                    "Local status preserved",
                    row_status(&item).as_deref() == Some(LOCAL_STATUS),
                ),
            ];
            Ok((summary.to_string(), checks))
        },
        || async {
            cleanup(cfg, &scenario_slug).await;
        },
    )
    .await
}

/// "Use remote": adopt the remote values. The resolver overwrites
/// the local fields and stamps the field watermark to the remote
/// mtime/source so the next merge cycle does not re-flag the row.
///
/// Pins:
/// - `project_sync_conflict_use_remote` rewrites local title +
///   status to the remote values.
/// - No new push outbox row is appended (the change came from the
///   remote — re-pushing would loop).
/// - Conflict row transitions to `resolution = "use_remote"`.
pub async fn conflict_use_remote_overwrites_local(cfg: &Config) -> bool {
    let name = "Sync: Conflict Use Remote";
    let slug = unique_slug("conflict-use-remote");
    let scenario_slug = slug.clone();
    run_scenario_with_cleanup(
        name,
        || async {
            seed_project_with_adapter(cfg, &slug, ADAPTER_ID).await?;
            seed_work_item(cfg, &slug).await?;
            inject_merge_external(cfg, &slug).await?;
            pump_merge(cfg, &slug).await?;

            let rows_after_pump = list_conflicts(cfg, &slug).await?;
            let conflict_id = first_conflict_id(&rows_after_pump)
                .ok_or_else(|| "no conflict row recorded after merge pump".to_string())?;

            let pending_before = pending_count(cfg, &slug).await?;
            let item_before = read_work_item(cfg, &slug).await?;
            use_remote(cfg, conflict_id).await?;
            let pending_after = pending_count(cfg, &slug).await?;
            let item_after = read_work_item(cfg, &slug).await?;

            let rows_after_resolve = list_conflicts(cfg, &slug).await?;
            let row_after_resolve = rows_after_resolve
                .iter()
                .find(|r| r.get("id").and_then(|v| v.as_i64()) == Some(conflict_id))
                .cloned()
                .ok_or_else(|| "resolved row vanished from list".to_string())?;

            // Idempotency: second click — no further state change.
            use_remote(cfg, conflict_id).await?;
            let item_after_idempotent = read_work_item(cfg, &slug).await?;
            let pending_after_idempotent = pending_count(cfg, &slug).await?;

            let summary = json!({
                "pending_before": pending_before,
                "pending_after": pending_after,
                "pending_after_idempotent": pending_after_idempotent,
                "item_before": item_before,
                "item_after": item_after,
                "item_after_idempotent": item_after_idempotent,
                "row_after_resolve": row_after_resolve,
            });

            let checks = vec![
                (
                    "Pre-resolve: local fields are still local-side",
                    row_title(&item_before).as_deref() == Some(LOCAL_TITLE)
                        && row_status(&item_before).as_deref() == Some(LOCAL_STATUS),
                ),
                (
                    "use_remote rewrote local title to remote value",
                    row_title(&item_after).as_deref() == Some(REMOTE_TITLE),
                ),
                (
                    "use_remote rewrote local status to remote value",
                    row_status(&item_after).as_deref() == Some(REMOTE_STATUS),
                ),
                (
                    "use_remote did NOT append an outbox push row",
                    pending_after == pending_before,
                ),
                (
                    "Conflict row stamped resolution = 'use_remote'",
                    read_resolution(&row_after_resolve) == Some("use_remote"),
                ),
                (
                    "Conflict row gained a non-null resolved_at",
                    read_resolved_at(&row_after_resolve).is_some(),
                ),
                (
                    "Idempotent re-click: local fields stable",
                    row_title(&item_after_idempotent).as_deref() == Some(REMOTE_TITLE)
                        && row_status(&item_after_idempotent).as_deref() == Some(REMOTE_STATUS),
                ),
                (
                    "Idempotent re-click: pending count stable",
                    pending_after_idempotent == pending_after,
                ),
            ];
            Ok((summary.to_string(), checks))
        },
        || async {
            cleanup(cfg, &scenario_slug).await;
        },
    )
    .await
}

/// "Dismiss": the user accepts the resolver verdict (kept local)
/// and silences the row. Neither the local row nor the outbox
/// changes — only the audit row gets a `resolved_at`.
///
/// Pins:
/// - Local fields unchanged.
/// - No new outbox row.
/// - Conflict row transitions to `resolution = "dismissed"`.
pub async fn conflict_dismiss_keeps_local(cfg: &Config) -> bool {
    let name = "Sync: Conflict Dismiss";
    let slug = unique_slug("conflict-dismiss");
    let scenario_slug = slug.clone();
    run_scenario_with_cleanup(
        name,
        || async {
            seed_project_with_adapter(cfg, &slug, ADAPTER_ID).await?;
            seed_work_item(cfg, &slug).await?;
            inject_merge_external(cfg, &slug).await?;
            pump_merge(cfg, &slug).await?;

            let rows_after_pump = list_conflicts(cfg, &slug).await?;
            let conflict_id = first_conflict_id(&rows_after_pump)
                .ok_or_else(|| "no conflict row recorded after merge pump".to_string())?;

            let pending_before = pending_count(cfg, &slug).await?;
            let item_before = read_work_item(cfg, &slug).await?;
            dismiss(cfg, conflict_id).await?;
            let pending_after = pending_count(cfg, &slug).await?;
            let item_after = read_work_item(cfg, &slug).await?;

            let rows_after_resolve = list_conflicts(cfg, &slug).await?;
            let row_after_resolve = rows_after_resolve
                .iter()
                .find(|r| r.get("id").and_then(|v| v.as_i64()) == Some(conflict_id))
                .cloned()
                .ok_or_else(|| "resolved row vanished from list".to_string())?;

            // Idempotency.
            dismiss(cfg, conflict_id).await?;
            let pending_after_idempotent = pending_count(cfg, &slug).await?;

            let summary = json!({
                "pending_before": pending_before,
                "pending_after": pending_after,
                "pending_after_idempotent": pending_after_idempotent,
                "item_before": item_before,
                "item_after": item_after,
                "row_after_resolve": row_after_resolve,
            });

            let checks = vec![
                (
                    "Local title unchanged after dismiss",
                    row_title(&item_after).as_deref() == Some(LOCAL_TITLE),
                ),
                (
                    "Local status unchanged after dismiss",
                    row_status(&item_after).as_deref() == Some(LOCAL_STATUS),
                ),
                (
                    "dismiss did NOT append an outbox row",
                    pending_after == pending_before,
                ),
                (
                    "Conflict row stamped resolution = 'dismissed'",
                    read_resolution(&row_after_resolve) == Some("dismissed"),
                ),
                (
                    "Conflict row gained a non-null resolved_at",
                    read_resolved_at(&row_after_resolve).is_some(),
                ),
                (
                    "Idempotent re-click: pending count stable",
                    pending_after_idempotent == pending_after,
                ),
            ];
            Ok((summary.to_string(), checks))
        },
        || async {
            cleanup(cfg, &scenario_slug).await;
        },
    )
    .await
}
