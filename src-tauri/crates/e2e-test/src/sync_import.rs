//! Import E2E scenarios (`--group sync`).
//!
//! These scenarios drive the full bulk-historical-import path:
//!
//!   1. Seed a project + attach the Echo adapter (which advertises
//!      `supports_import: true` and exposes a synthetic 2-page
//!      history through `pull_all`).
//!   2. Stamp a `pending` import_progress row via the
//!      `/test/sync/import/ensure-pending` debug endpoint, mirroring
//!      what `project_sync_attach_adapter` does on a real attach.
//!   3. Pump the worker import cycle one page at a time (via
//!      `/test/sync/import/pump`), reading back the status row
//!      after each step and asserting:
//!        - `imported_count` advances by exactly the page size,
//!        - `state` flips `pending` → `running` → `completed`,
//!        - `total_hint` is set on the first page and is stable,
//!        - `merge_external` outbox rows land in the queue.
//!   4. Final state holds — re-pumping a `completed` row is a no-op.
//!
//! The retry-after-failure scenario exercises the user-facing "Retry"
//! button: forces the row into `failed` via
//! `/test/sync/import/force-fail`, calls `/import/retry` to flip it
//! back to `pending`, and asserts the import resumes from the
//! preserved cursor (no duplicate rows).
//!
//! Each scenario uses a freshly-minted slug + `cleanup` finally block
//! so it can interleave with other groups without cross-talk; the
//! cleanup also wipes `import_progress` rows, so rerunning a scenario
//! against the same slug starts from a clean slate.

use serde_json::{json, Value};

use super::config::Config;
use super::sync::{
    cleanup, get_json_query, post_json, run_scenario_with_cleanup, seed_project_with_adapter,
    unique_slug,
};

/// Echo adapter's synthetic two-page total. Mirrors the constant in
/// `EchoAdapter::pull_all` so a regression on either side trips this
/// assertion.
const ECHO_IMPORT_TOTAL: u64 = 4;

async fn import_ensure_pending(cfg: &Config, slug: &str, adapter_id: &str) -> Result<(), String> {
    post_json(
        cfg,
        "/agent/test/sync/import/ensure-pending",
        &json!({ "slug": slug, "adapter_id": adapter_id }),
    )
    .await
    .map(|_| ())
}

/// Read `ImportProgressRow` for `(slug, adapter_id)`. `null` (i.e.
/// `Value::Null`) when no row exists.
async fn import_status(cfg: &Config, slug: &str, adapter_id: &str) -> Result<Value, String> {
    let value = get_json_query(
        cfg,
        "/agent/test/sync/import/status",
        &[("slug", slug), ("adapter_id", adapter_id)],
    )
    .await?;
    Ok(value.get("row").cloned().unwrap_or(Value::Null))
}

/// Drive `cap` pages through the worker import cycle. Returns
/// `Ok(())` on success.
async fn import_pump(cfg: &Config, slug: &str, adapter_id: &str, cap: u32) -> Result<(), String> {
    post_json(
        cfg,
        "/agent/test/sync/import/pump",
        &json!({ "slug": slug, "adapter_id": adapter_id, "max_pages": cap }),
    )
    .await
    .map(|_| ())
}

async fn import_force_fail(cfg: &Config, slug: &str, adapter_id: &str) -> Result<(), String> {
    post_json(
        cfg,
        "/agent/test/sync/import/force-fail",
        &json!({ "slug": slug, "adapter_id": adapter_id }),
    )
    .await
    .map(|_| ())
}

async fn import_retry(cfg: &Config, slug: &str, adapter_id: &str) -> Result<bool, String> {
    let value = post_json(
        cfg,
        "/agent/test/sync/import/retry",
        &json!({ "slug": slug, "adapter_id": adapter_id }),
    )
    .await?;
    Ok(value
        .get("transitioned")
        .and_then(|v| v.as_bool())
        .unwrap_or(false))
}

async fn import_cancel(cfg: &Config, slug: &str, adapter_id: &str) -> Result<(), String> {
    post_json(
        cfg,
        "/agent/test/sync/import/cancel",
        &json!({ "slug": slug, "adapter_id": adapter_id }),
    )
    .await
    .map(|_| ())
}

/// Count `merge_external` outbox rows for `slug`. Reads through the
/// same status endpoint as the existing webhook scenarios (each
/// `merge_external` row lands in `Pending` until the merge cycle
/// claims it — no merge cycle runs in this harness).
async fn pending_outbox_count(cfg: &Config, slug: &str) -> Result<u64, String> {
    let value = get_json_query(cfg, "/agent/test/sync/status", &[("slug", slug)]).await?;
    Ok(value
        .pointer("/report/pending_count")
        .and_then(|n| n.as_u64())
        .unwrap_or(0))
}

fn read_state(row: &Value) -> Option<&str> {
    row.get("state").and_then(|v| v.as_str())
}

fn read_imported(row: &Value) -> u64 {
    row.get("imported_count")
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
}

fn read_total_hint(row: &Value) -> Option<u64> {
    row.get("total_hint").and_then(|v| v.as_u64())
}

fn read_cursor(row: &Value) -> Option<String> {
    row.get("page_cursor")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

// ============================================================================
// Scenarios
// ============================================================================

/// Happy path: stamp a `pending` row, pump the import cycle one page
/// at a time, watch the row walk `pending → running → completed`,
/// and assert each page wrote exactly one `merge_external` row to
/// the outbox.
///
/// Pins the EchoAdapter's wire contract:
/// - 2 pages, 2 entries each → 4 imported_count at completion.
/// - `total_hint` is set on the first page and stable through the
///   second.
/// - `page_cursor` advances `null → "page2" → null` (terminal).
pub async fn import_walks_full_history(cfg: &Config) -> bool {
    let name = "Sync: Import Walks Full History";
    let slug = unique_slug("import-happy");
    let adapter_id = "echo";
    let scenario_slug = slug.clone();
    run_scenario_with_cleanup(
        name,
        || async {
            seed_project_with_adapter(cfg, &slug, adapter_id).await?;
            import_ensure_pending(cfg, &slug, adapter_id).await?;

            let initial = import_status(cfg, &slug, adapter_id).await?;
            let outbox_pre = pending_outbox_count(cfg, &slug).await?;

            // Page 1 — pending → running, total_hint surfaces.
            import_pump(cfg, &slug, adapter_id, 1).await?;
            let after_page_1 = import_status(cfg, &slug, adapter_id).await?;
            let outbox_after_page_1 = pending_outbox_count(cfg, &slug).await?;

            // Page 2 — running → completed, cursor cleared.
            import_pump(cfg, &slug, adapter_id, 1).await?;
            let after_page_2 = import_status(cfg, &slug, adapter_id).await?;
            let outbox_after_page_2 = pending_outbox_count(cfg, &slug).await?;

            // Idempotency: pumping past completion is a no-op.
            import_pump(cfg, &slug, adapter_id, 4).await?;
            let after_idempotency = import_status(cfg, &slug, adapter_id).await?;
            let outbox_after_idempotency = pending_outbox_count(cfg, &slug).await?;

            let summary = json!({
                "initial": initial,
                "after_page_1": after_page_1,
                "after_page_2": after_page_2,
                "after_idempotency": after_idempotency,
                "outbox_pre": outbox_pre,
                "outbox_after_page_1": outbox_after_page_1,
                "outbox_after_page_2": outbox_after_page_2,
                "outbox_after_idempotency": outbox_after_idempotency,
            });

            let checks = vec![
                (
                    "ensure_pending stamped a row in 'pending'",
                    read_state(&initial) == Some("pending"),
                ),
                (
                    "Initial outbox has zero merge_external rows",
                    outbox_pre == 0,
                ),
                (
                    "After page 1: state == 'running'",
                    read_state(&after_page_1) == Some("running"),
                ),
                (
                    "After page 1: imported_count == page size",
                    read_imported(&after_page_1) == 2,
                ),
                (
                    "After page 1: total_hint surfaced",
                    read_total_hint(&after_page_1) == Some(ECHO_IMPORT_TOTAL),
                ),
                (
                    "After page 1: cursor advanced",
                    read_cursor(&after_page_1).as_deref() == Some("page2"),
                ),
                (
                    "After page 1: outbox grew by exactly 2 merge_external rows",
                    outbox_after_page_1 == outbox_pre + 2,
                ),
                (
                    "After page 2: state == 'completed'",
                    read_state(&after_page_2) == Some("completed"),
                ),
                (
                    "After page 2: imported_count == ECHO_IMPORT_TOTAL",
                    read_imported(&after_page_2) == ECHO_IMPORT_TOTAL,
                ),
                (
                    "After page 2: total_hint stable across pages",
                    read_total_hint(&after_page_2) == Some(ECHO_IMPORT_TOTAL),
                ),
                (
                    "After page 2: cursor cleared (terminal)",
                    read_cursor(&after_page_2).is_none(),
                ),
                (
                    "After page 2: outbox grew by another 2 merge_external rows",
                    outbox_after_page_2 == outbox_after_page_1 + 2,
                ),
                (
                    "Idempotency: pumping past completion is a no-op (state stable)",
                    read_state(&after_idempotency) == Some("completed"),
                ),
                (
                    "Idempotency: imported_count not double-counted",
                    read_imported(&after_idempotency) == ECHO_IMPORT_TOTAL,
                ),
                (
                    "Idempotency: outbox not re-populated",
                    outbox_after_idempotency == outbox_after_page_2,
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

/// Retry-after-failure: drive the import past page 1, force the row
/// into `failed`, call `retry`, and assert the worker resumes from
/// the preserved cursor (no duplicate rows).
///
/// Pins:
/// - `mark_failed` preserves `page_cursor` so retry resumes at the
///   right page (the io contract documented on
///   `import::mark_failed`).
/// - `reset_for_retry` clears `last_error` and flips state to
///   `pending`, which lets the worker claim the row on the next
///   `import_cycle` tick.
/// - The total `merge_external` outbox rows after retry equals the
///   full history — the failed page's rows still landed before the
///   failure, and retry doesn't re-emit them (that's by design: the
///   merge cycle is the deduper, not the import cycle).
pub async fn import_retry_resumes_from_cursor(cfg: &Config) -> bool {
    let name = "Sync: Import Retry Resumes From Cursor";
    let slug = unique_slug("import-retry");
    let adapter_id = "echo";
    let scenario_slug = slug.clone();
    run_scenario_with_cleanup(
        name,
        || async {
            seed_project_with_adapter(cfg, &slug, adapter_id).await?;
            import_ensure_pending(cfg, &slug, adapter_id).await?;

            // Page 1 — partial walk through the history, then force a
            // permanent failure to land the row in `failed`.
            import_pump(cfg, &slug, adapter_id, 1).await?;
            let after_page_1 = import_status(cfg, &slug, adapter_id).await?;
            let outbox_after_page_1 = pending_outbox_count(cfg, &slug).await?;

            import_force_fail(cfg, &slug, adapter_id).await?;
            let after_fail = import_status(cfg, &slug, adapter_id).await?;
            let last_error = after_fail
                .get("last_error")
                .and_then(|v| v.as_str())
                .map(str::to_string);

            // Pumping a `failed` row is a no-op: the worker only
            // claims `pending` / `running` rows.
            import_pump(cfg, &slug, adapter_id, 4).await?;
            let after_pump_while_failed = import_status(cfg, &slug, adapter_id).await?;
            let outbox_after_pump_while_failed = pending_outbox_count(cfg, &slug).await?;

            // User clicks Retry → row flips back to `pending` with
            // cursor preserved.
            let transitioned = import_retry(cfg, &slug, adapter_id).await?;
            let after_retry = import_status(cfg, &slug, adapter_id).await?;

            // Page 2 — resumes from the preserved cursor and walks to
            // completion.
            import_pump(cfg, &slug, adapter_id, 1).await?;
            let after_resume = import_status(cfg, &slug, adapter_id).await?;
            let outbox_after_resume = pending_outbox_count(cfg, &slug).await?;

            let summary = json!({
                "after_page_1": after_page_1,
                "after_fail": after_fail,
                "after_pump_while_failed": after_pump_while_failed,
                "transitioned": transitioned,
                "after_retry": after_retry,
                "after_resume": after_resume,
                "outbox_after_page_1": outbox_after_page_1,
                "outbox_after_pump_while_failed": outbox_after_pump_while_failed,
                "outbox_after_resume": outbox_after_resume,
            });

            let checks = vec![
                (
                    "After page 1: state == 'running'",
                    read_state(&after_page_1) == Some("running"),
                ),
                (
                    "After page 1: cursor == 'page2' (mid-stream)",
                    read_cursor(&after_page_1).as_deref() == Some("page2"),
                ),
                (
                    "After force-fail: state == 'failed'",
                    read_state(&after_fail) == Some("failed"),
                ),
                (
                    "After force-fail: cursor preserved (resume target)",
                    read_cursor(&after_fail).as_deref() == Some("page2"),
                ),
                (
                    "After force-fail: last_error populated",
                    last_error.as_deref() == Some("e2e_force_fail"),
                ),
                (
                    "Pumping a 'failed' row is a no-op (state unchanged)",
                    read_state(&after_pump_while_failed) == Some("failed"),
                ),
                (
                    "Pumping a 'failed' row didn't add outbox rows",
                    outbox_after_pump_while_failed == outbox_after_page_1,
                ),
                ("retry transitioned the row (returned true)", transitioned),
                (
                    "After retry: state == 'pending'",
                    read_state(&after_retry) == Some("pending"),
                ),
                (
                    "After retry: cursor preserved",
                    read_cursor(&after_retry).as_deref() == Some("page2"),
                ),
                (
                    "After retry: last_error cleared",
                    after_retry
                        .get("last_error")
                        .and_then(|v| v.as_str())
                        .is_none(),
                ),
                (
                    "After resume: state == 'completed'",
                    read_state(&after_resume) == Some("completed"),
                ),
                (
                    "After resume: imported_count == ECHO_IMPORT_TOTAL",
                    read_imported(&after_resume) == ECHO_IMPORT_TOTAL,
                ),
                (
                    "After resume: outbox holds the full history",
                    outbox_after_resume == ECHO_IMPORT_TOTAL,
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

/// Cancel mid-stream: a user-cancelled import is final in v1 — no
/// retry path. After cancellation the worker must not pick the row
/// back up, and pumping the import cycle must be a no-op.
pub async fn import_cancel_is_final(cfg: &Config) -> bool {
    let name = "Sync: Import Cancel Is Final";
    let slug = unique_slug("import-cancel");
    let adapter_id = "echo";
    let scenario_slug = slug.clone();
    run_scenario_with_cleanup(
        name,
        || async {
            seed_project_with_adapter(cfg, &slug, adapter_id).await?;
            import_ensure_pending(cfg, &slug, adapter_id).await?;

            import_pump(cfg, &slug, adapter_id, 1).await?;
            let after_page_1 = import_status(cfg, &slug, adapter_id).await?;
            let outbox_after_page_1 = pending_outbox_count(cfg, &slug).await?;

            import_cancel(cfg, &slug, adapter_id).await?;
            let after_cancel = import_status(cfg, &slug, adapter_id).await?;

            // Cancelled rows are excluded from `list_runnable`, so a
            // pump must not advance them.
            import_pump(cfg, &slug, adapter_id, 4).await?;
            let after_pump = import_status(cfg, &slug, adapter_id).await?;
            let outbox_after_pump = pending_outbox_count(cfg, &slug).await?;

            // retry must NOT rescue a cancelled row — only `failed`.
            let retry_transitioned = import_retry(cfg, &slug, adapter_id).await?;
            let after_retry_attempt = import_status(cfg, &slug, adapter_id).await?;

            let summary = json!({
                "after_page_1": after_page_1,
                "after_cancel": after_cancel,
                "after_pump": after_pump,
                "after_retry_attempt": after_retry_attempt,
                "retry_transitioned": retry_transitioned,
                "outbox_after_page_1": outbox_after_page_1,
                "outbox_after_pump": outbox_after_pump,
            });

            let checks = vec![
                (
                    "After page 1: row is mid-stream",
                    read_state(&after_page_1) == Some("running"),
                ),
                (
                    "After cancel: state == 'cancelled'",
                    read_state(&after_cancel) == Some("cancelled"),
                ),
                (
                    "After cancel + pump: state stays 'cancelled'",
                    read_state(&after_pump) == Some("cancelled"),
                ),
                (
                    "After cancel + pump: outbox unchanged",
                    outbox_after_pump == outbox_after_page_1,
                ),
                (
                    "retry on a cancelled row is a no-op (returns false)",
                    !retry_transitioned,
                ),
                (
                    "After retry attempt: state still 'cancelled'",
                    read_state(&after_retry_attempt) == Some("cancelled"),
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
