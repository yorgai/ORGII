//! Sync E2E scenarios (`--group sync`).
//!
//! End-to-end coverage for the pluggable sync framework. Every
//! scenario exercises the full `outbox -> adapter -> DB` chain via
//! the debug HTTP surface in `api/agent/test/sync.rs`; the worker
//! pump and the Echo adapter flag toggles are wired through the same
//! endpoints the production Tauri commands use, so a regression in
//! `sync::io` or `sync::worker` surfaces here without spinning up a
//! real adapter.
//!
//! Each scenario operates on a freshly-minted throwaway slug
//! (`e2e-sync-<scenario>-<nanos>`) so runs can interleave with other
//! tests without cross-contamination, and each finishes with a
//! `cleanup` call so a re-run starts from the same blank slate.
//!
//! Linear OAuth scenarios live in the sibling `sync_oauth.rs` module
//! (kept separate to respect the 600-line per-file budget); they
//! reuse the `pub(super)` helpers exported below.

use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use super::config::Config;
use super::harness;

// ============================================================================
// Wire-format constants (Rule: typed-over-strings on the e2e side too)
// ============================================================================

pub(super) const ENTITY_TYPE_WORK_ITEM: &str = "work_item";
pub(super) const OP_CREATE: &str = "create";
const OP_UPDATE: &str = "update";

const STATUS_PENDING: &str = "pending";
const STATUS_FAILED: &str = "failed";
pub(super) const STATUS_ABANDONED: &str = "abandoned";

/// Mirror of `sync::io::MAX_RETRY_COUNT`. We pump one extra time
/// past this to assert the row stays put once it lands in `Abandoned`
/// rather than oscillating back to pending on a stray claim.
pub(super) const MAX_RETRY_COUNT: u32 = 5;
pub(super) const PUMP_OVERSHOOT: u32 = MAX_RETRY_COUNT + 1;

/// Documented field set for `OutboxProblemRow` (mirrors the TS
/// interface in `src/api/http/project/sync.ts`). Kept here so the
/// shape integrity scenario can compare against a single source of
/// truth and refuse silent additions on either side of the wire.
const PROBLEM_ROW_FIELDS: &[&str] = &[
    "id",
    "entity_type",
    "entity_id",
    "op",
    "field_path",
    "created_at",
    "last_attempted_at",
    "retry_count",
    "last_error",
    "status",
    "payload_json",
];

// ============================================================================
// HTTP helpers
// ============================================================================

pub(super) fn unique_slug(scenario: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("e2e-sync-{}-{}", scenario, nanos)
}

pub(super) fn client(cfg: &Config) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(cfg.timeout_secs))
        .build()
        .expect("failed to build reqwest client")
}

pub(super) async fn post_json(cfg: &Config, path: &str, body: &Value) -> Result<Value, String> {
    let url = format!("{}{}", cfg.base_url, path);
    let resp = client(cfg)
        .post(&url)
        .json(body)
        .send()
        .await
        .map_err(|err| format!("HTTP error ({}): {}", path, err))?;
    let json: Value = resp
        .json()
        .await
        .map_err(|err| format!("JSON parse error ({}): {}", path, err))?;
    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        return Err(format!("{} returned error: {}", path, err));
    }
    Ok(json)
}

async fn get_json(cfg: &Config, path: &str, slug: &str) -> Result<Value, String> {
    let url = format!("{}{}?slug={}", cfg.base_url, path, slug);
    let resp = client(cfg)
        .get(&url)
        .send()
        .await
        .map_err(|err| format!("HTTP error ({}): {}", path, err))?;
    let json: Value = resp
        .json()
        .await
        .map_err(|err| format!("JSON parse error ({}): {}", path, err))?;
    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        return Err(format!("{} returned error: {}", path, err));
    }
    Ok(json)
}

pub(super) async fn get_json_query(
    cfg: &Config,
    path: &str,
    query: &[(&str, &str)],
) -> Result<Value, String> {
    let mut url = format!("{}{}", cfg.base_url, path);
    if !query.is_empty() {
        url.push('?');
        for (idx, (key, value)) in query.iter().enumerate() {
            if idx > 0 {
                url.push('&');
            }
            url.push_str(key);
            url.push('=');
            url.push_str(&urlencoding::encode(value));
        }
    }
    let resp = client(cfg)
        .get(&url)
        .send()
        .await
        .map_err(|err| format!("HTTP error ({}): {}", path, err))?;
    let json: Value = resp
        .json()
        .await
        .map_err(|err| format!("JSON parse error ({}): {}", path, err))?;
    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        return Err(format!("{} returned error: {}", path, err));
    }
    Ok(json)
}

pub(super) async fn run_scenario_with_cleanup<F, Fut, C, CFut>(
    name: &str,
    body: F,
    cleanup: C,
) -> bool
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<(String, Vec<(&'static str, bool)>), String>>,
    C: FnOnce() -> CFut,
    CFut: std::future::Future<Output = ()>,
{
    let outcome = body().await;
    let result = match outcome {
        Ok((content, checks)) => harness::print_result(name, &content, &checks),
        Err(err) => harness::print_error(name, &err),
    };
    cleanup().await;
    result
}

pub(super) async fn seed_project(cfg: &Config, slug: &str) -> Result<(), String> {
    post_json(
        cfg,
        "/agent/test/sync/seed-project",
        &json!({ "slug": slug }),
    )
    .await
    .map(|_| ())
}

pub(super) async fn seed_project_with_adapter(
    cfg: &Config,
    slug: &str,
    adapter_id: &str,
) -> Result<String, String> {
    let value = post_json(
        cfg,
        "/agent/test/sync/seed-project",
        &json!({ "slug": slug, "adapter_id": adapter_id }),
    )
    .await?;
    value
        .get("sync_connection_id")
        .and_then(|entry| entry.as_str())
        .map(str::to_string)
        .ok_or_else(|| "seed-project response missing 'sync_connection_id'".to_string())
}

pub(super) async fn enqueue(
    cfg: &Config,
    slug: &str,
    entity_id: &str,
    op: &str,
) -> Result<i64, String> {
    let body = json!({
        "slug": slug,
        "entity_type": ENTITY_TYPE_WORK_ITEM,
        "op": op,
        "entity_id": entity_id,
        "payload": { "title": format!("seed for {}", entity_id) },
    });
    let value = post_json(cfg, "/agent/test/sync/enqueue", &body).await?;
    value
        .get("id")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| "enqueue response missing 'id'".to_string())
}

pub(super) async fn pump(cfg: &Config, slug: &str) -> Result<u64, String> {
    let value = post_json(cfg, "/agent/test/sync/pump", &json!({ "slug": slug })).await?;
    value
        .get("processed")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| "pump response missing 'processed'".to_string())
}

async fn echo_flag(
    cfg: &Config,
    slug: &str,
    next: Option<bool>,
    persistent: Option<bool>,
) -> Result<(), String> {
    let mut body = serde_json::Map::new();
    body.insert("slug".to_string(), json!(slug));
    if let Some(value) = next {
        body.insert("force_next_failure".to_string(), json!(value));
    }
    if let Some(value) = persistent {
        body.insert("force_persistent_failure".to_string(), json!(value));
    }
    post_json(cfg, "/agent/test/sync/echo-flag", &Value::Object(body))
        .await
        .map(|_| ())
}

async fn status(cfg: &Config, slug: &str) -> Result<Value, String> {
    let value = get_json(cfg, "/agent/test/sync/status", slug).await?;
    value
        .get("report")
        .cloned()
        .ok_or_else(|| "status response missing 'report'".to_string())
}

pub(super) async fn problems(cfg: &Config, slug: &str) -> Result<Vec<Value>, String> {
    let value = get_json(cfg, "/agent/test/sync/problems", slug).await?;
    value
        .get("rows")
        .and_then(|v| v.as_array())
        .cloned()
        .ok_or_else(|| "problems response missing 'rows' array".to_string())
}

/// Single-row `OutboxEntry` snapshot by `entry_id`. Wraps the
/// `/agent/test/sync/inspect-entry` debug endpoint so scenarios can
/// observe rows in any state — including `Pending` and `Succeeded`,
/// which the problems-list endpoint hides.
async fn inspect_entry(cfg: &Config, entry_id: i64) -> Result<Value, String> {
    let value = get_json_query(
        cfg,
        "/agent/test/sync/inspect-entry",
        &[("entry_id", &entry_id.to_string())],
    )
    .await?;
    value
        .get("entry")
        .cloned()
        .ok_or_else(|| "inspect-entry response missing 'entry' object".to_string())
}

/// Convenience wrapper: read just `retry_count` from a row. Used by
/// scenarios that pin retry-budget arithmetic across the auto-retry
/// path (where rows live in `Pending` and so don't surface in the
/// problems list).
async fn retry_count_for_entry(cfg: &Config, entry_id: i64) -> Result<u64, String> {
    let entry = inspect_entry(cfg, entry_id).await?;
    entry
        .get("retry_count")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| "inspect-entry row missing numeric 'retry_count'".to_string())
}

async fn requeue(cfg: &Config, slug: &str, entry_id: i64) -> Result<(), String> {
    post_json(
        cfg,
        "/agent/test/sync/requeue",
        &json!({ "slug": slug, "entry_id": entry_id }),
    )
    .await
    .map(|_| ())
}

async fn discard(cfg: &Config, slug: &str, entry_id: i64) -> Result<(), String> {
    post_json(
        cfg,
        "/agent/test/sync/discard",
        &json!({ "slug": slug, "entry_id": entry_id }),
    )
    .await
    .map(|_| ())
}

async fn force_push(cfg: &Config, slug: &str) -> Result<u64, String> {
    let value = post_json(cfg, "/agent/test/sync/force-push", &json!({ "slug": slug })).await?;
    value
        .get("requeued")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| "force-push response missing 'requeued'".to_string())
}

/// Best-effort cleanup. Logs but does not fail the scenario when the
/// cleanup itself errors — the scenario's pass/fail is decided by
/// the assertions earlier in the body.
pub(super) async fn cleanup(cfg: &Config, slug: &str) {
    let _ = echo_flag(cfg, slug, Some(false), Some(false)).await;
    let _ = post_json(cfg, "/agent/test/sync/cleanup", &json!({ "slug": slug })).await;
}

fn cnt(report: &Value, key: &str) -> u64 {
    report.get(key).and_then(|v| v.as_u64()).unwrap_or(0)
}

/// Wrap a scenario body so `?` can short-circuit into `print_error`,
/// and `cleanup` always runs regardless of success/failure. The body
/// returns `(content_for_dump, [(check_name, check_pass)])`.
async fn run_scenario<F, Fut>(cfg: &Config, name: &str, slug: &str, body: F) -> bool
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<(String, Vec<(&'static str, bool)>), String>>,
{
    let outcome = body().await;
    let result = match outcome {
        Ok((content, checks)) => harness::print_result(name, &content, &checks),
        Err(err) => harness::print_error(name, &err),
    };
    cleanup(cfg, slug).await;
    result
}

// ============================================================================
// Scenarios
// ============================================================================

/// Happy path: enqueue one outbox row, pump the worker once, assert
/// `pending -> succeeded`. Negative assertion: failed/abandoned
/// counters did not move.
pub async fn outbox_roundtrip(cfg: &Config) -> bool {
    let name = "Sync: Outbox Roundtrip";
    let slug = unique_slug("roundtrip");
    run_scenario(cfg, name, &slug, || async {
        seed_project(cfg, &slug).await?;
        let pre = status(cfg, &slug).await?;
        let entry_id = enqueue(cfg, &slug, "WI-1", OP_CREATE).await?;
        let after_enqueue = status(cfg, &slug).await?;
        let processed = pump(cfg, &slug).await?;
        let post = status(cfg, &slug).await?;
        let adapter_ok = post.get("adapter_id").and_then(|v| v.as_str()) == Some("echo");
        let checks = vec![
            ("Enqueue assigned positive id", entry_id > 0),
            (
                "Enqueue moved row to pending",
                cnt(&after_enqueue, "pending_count") == cnt(&pre, "pending_count") + 1,
            ),
            ("Pump processed exactly one row", processed == 1),
            (
                "Pending count returned to baseline",
                cnt(&post, "pending_count") == cnt(&pre, "pending_count"),
            ),
            (
                "Succeeded count incremented",
                cnt(&post, "succeeded_count") == cnt(&pre, "succeeded_count") + 1,
            ),
            ("Failed count is zero", cnt(&post, "failed_count") == 0),
            (
                "Abandoned count is zero",
                cnt(&post, "abandoned_count") == 0,
            ),
            ("Echo adapter is bound", adapter_ok),
        ];
        Ok((post.to_string(), checks))
    })
    .await
}

/// Transient failure auto-recovery: a one-shot push failure leaves
/// the row in `Pending` (with backoff) — **not** `Failed` — and the
/// next pump cycle naturally drains it to `Succeeded` with no manual
/// `requeue` involved. Pins the io-layer contract that
/// [`crate::project_management::sync::io::mark_failed_with_backoff`]
/// only emits `Pending` (retry-budget remaining) or `Abandoned`
/// (retry-budget exhausted). `Failed` is reserved for the manual /
/// external escalation path covered by [`requeue_after_abandon`].
///
/// Negative assertions:
/// - `failed_count` never increments through this lifecycle.
/// - The row stays out of the problems list (which scopes to
///   `Failed | Abandoned`) for the whole transient-fail → recover
///   trajectory.
/// - `retry_count` advances by exactly one across the failed pump,
///   then halts (no double-counting on the recovery pump).
pub async fn transient_failure_auto_recovers(cfg: &Config) -> bool {
    let name = "Sync: Transient Failure Auto-Recovers";
    let slug = unique_slug("transient");
    run_scenario(cfg, name, &slug, || async {
        seed_project(cfg, &slug).await?;
        let entry_id = enqueue(cfg, &slug, "WI-1", OP_UPDATE).await?;

        echo_flag(cfg, &slug, Some(true), None).await?;
        let processed_first = pump(cfg, &slug).await?;
        let after_fail = status(cfg, &slug).await?;
        let problems_after_fail = problems(cfg, &slug).await?;
        let retry_after_fail = retry_count_for_entry(cfg, entry_id).await?;

        let processed_second = pump(cfg, &slug).await?;
        let after_success = status(cfg, &slug).await?;
        let problems_after_success = problems(cfg, &slug).await?;
        let retry_after_success = retry_count_for_entry(cfg, entry_id).await?;

        let last_error_present = after_fail
            .get("last_error")
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false);

        let checks = vec![
            ("Enqueue assigned positive id", entry_id > 0),
            ("First pump processed one row", processed_first == 1),
            (
                "After fail: row stays in pending (backoff retry)",
                cnt(&after_fail, "pending_count") == 1,
            ),
            (
                "After fail: failed_count stays 0 (auto-retry, not stuck)",
                cnt(&after_fail, "failed_count") == 0,
            ),
            (
                "After fail: abandoned_count stays 0 (budget remaining)",
                cnt(&after_fail, "abandoned_count") == 0,
            ),
            (
                "After fail: succeeded_count stays 0",
                cnt(&after_fail, "succeeded_count") == 0,
            ),
            ("After fail: last_error populated", last_error_present),
            (
                "After fail: retry_count advanced to 1",
                retry_after_fail == 1,
            ),
            (
                "After fail: row absent from problems list",
                problems_after_fail.is_empty(),
            ),
            ("Second pump processed the same row", processed_second == 1),
            (
                "After recovery: succeeded_count == 1",
                cnt(&after_success, "succeeded_count") == 1,
            ),
            (
                "After recovery: pending_count == 0",
                cnt(&after_success, "pending_count") == 0,
            ),
            (
                "After recovery: failed_count still 0",
                cnt(&after_success, "failed_count") == 0,
            ),
            (
                "After recovery: retry_count did not double-count (==1)",
                retry_after_success == 1,
            ),
            (
                "Problems list still empty after recovery",
                problems_after_success.is_empty(),
            ),
        ];
        Ok((after_success.to_string(), checks))
    })
    .await
}

/// Manual recovery from `Abandoned`: drive a row to retry exhaustion
/// (`abandoned_count == 1`, row visible in the problems list),
/// release the failure flag, then `requeue_one` to flip it back to
/// `Pending` with `last_error` and `last_attempted_at` cleared. The
/// next pump cycle drains it to `Succeeded`. This is the canonical
/// lifecycle for the user's "Retry" button on a problem row, and the
/// only e2e probe that actually exercises
/// [`crate::project_management::sync::io::requeue_one`].
///
/// Pin (matches `requeue_one`'s docstring): `retry_count` is
/// **intentionally not reset** so the backoff schedule on the next
/// genuine failure picks up where the previous attempt left off.
/// Asserting `retry_count` is preserved across requeue locks that
/// invariant against silent regressions.
///
/// Negative assertions:
/// - Before requeue, the row is the only entry in the problems list
///   and carries `status == "abandoned"`.
/// - After requeue, `last_error` is cleared and `last_attempted_at`
///   is cleared (so the next pump claims it immediately).
/// - After successful pump, the row is gone from the problems list.
pub async fn requeue_after_abandon(cfg: &Config) -> bool {
    let name = "Sync: Requeue After Abandon";
    let slug = unique_slug("requeue");
    run_scenario(cfg, name, &slug, || async {
        seed_project(cfg, &slug).await?;
        let entry_id = enqueue(cfg, &slug, "WI-1", OP_UPDATE).await?;

        echo_flag(cfg, &slug, None, Some(true)).await?;
        for _ in 0..PUMP_OVERSHOOT {
            let _ = pump(cfg, &slug).await?;
        }
        let after_abandon = status(cfg, &slug).await?;
        let problems_after_abandon = problems(cfg, &slug).await?;
        let abandoned_row = problems_after_abandon.first();
        let abandoned_status = abandoned_row
            .and_then(|row| row.get("status").and_then(|v| v.as_str()))
            .unwrap_or("")
            .to_string();
        let abandoned_id = abandoned_row
            .and_then(|row| row.get("id").and_then(|v| v.as_i64()))
            .unwrap_or(-1);
        let abandoned_retry = abandoned_row
            .and_then(|row| row.get("retry_count").and_then(|v| v.as_u64()))
            .unwrap_or(0);

        echo_flag(cfg, &slug, None, Some(false)).await?;
        requeue(cfg, &slug, entry_id).await?;
        let after_requeue = status(cfg, &slug).await?;
        let problems_after_requeue = problems(cfg, &slug).await?;
        let entry_after_requeue = inspect_entry(cfg, entry_id).await?;
        let retry_after_requeue = entry_after_requeue
            .get("retry_count")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let last_attempted_after_requeue = entry_after_requeue
            .get("last_attempted_at")
            .cloned()
            .unwrap_or(Value::Null);
        let last_error_after_requeue = after_requeue
            .get("last_error")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let processed_recovery = pump(cfg, &slug).await?;
        let after_success = status(cfg, &slug).await?;
        let problems_after_success = problems(cfg, &slug).await?;

        let checks = vec![
            ("Enqueue assigned positive id", entry_id > 0),
            (
                "After exhaustion: abandoned_count == 1",
                cnt(&after_abandon, "abandoned_count") == 1,
            ),
            (
                "Problems list contains exactly the abandoned row",
                problems_after_abandon.len() == 1 && abandoned_id == entry_id,
            ),
            (
                "Abandoned row's status is 'abandoned'",
                abandoned_status == STATUS_ABANDONED,
            ),
            (
                "Abandoned row's retry_count >= MAX_RETRY_COUNT",
                abandoned_retry >= u64::from(MAX_RETRY_COUNT),
            ),
            (
                "After requeue: pending_count == 1",
                cnt(&after_requeue, "pending_count") == 1,
            ),
            (
                "After requeue: abandoned_count == 0",
                cnt(&after_requeue, "abandoned_count") == 0,
            ),
            (
                "After requeue: retry_count preserved (cumulative budget)",
                retry_after_requeue == abandoned_retry,
            ),
            (
                "After requeue: last_error cleared",
                last_error_after_requeue.as_deref().unwrap_or("").is_empty(),
            ),
            (
                "After requeue: last_attempted_at cleared (claimable next tick)",
                last_attempted_after_requeue.is_null(),
            ),
            (
                "After requeue: row gone from problems list",
                problems_after_requeue.is_empty(),
            ),
            ("Recovery pump processed one row", processed_recovery == 1),
            (
                "After recovery: succeeded_count == 1",
                cnt(&after_success, "succeeded_count") == 1,
            ),
            (
                "After recovery: abandoned_count still 0",
                cnt(&after_success, "abandoned_count") == 0,
            ),
            (
                "Problems list empty after recovery",
                problems_after_success.is_empty(),
            ),
        ];
        Ok((after_success.to_string(), checks))
    })
    .await
}

/// Exhaustion: persistent failure flag drives retry_count from 0 to
/// `MAX_RETRY_COUNT`, after which the row lands in `Abandoned`.
/// Discarding the abandoned row hard-deletes it (status report goes
/// to all zeros). Negative assertion: extra pumps beyond the abandon
/// transition do not bump abandoned_count or resurrect the row.
pub async fn abandon_after_max_attempts(cfg: &Config) -> bool {
    let name = "Sync: Abandon After Max Attempts";
    let slug = unique_slug("abandon");
    run_scenario(cfg, name, &slug, || async {
        seed_project(cfg, &slug).await?;
        let entry_id = enqueue(cfg, &slug, "WI-1", OP_UPDATE).await?;
        echo_flag(cfg, &slug, None, Some(true)).await?;

        let mut landed_at: Option<u32> = None;
        for attempt in 0..PUMP_OVERSHOOT {
            let _ = pump(cfg, &slug).await?;
            let report = status(cfg, &slug).await?;
            if cnt(&report, "abandoned_count") == 1 && landed_at.is_none() {
                landed_at = Some(attempt + 1);
            }
        }

        let after_pumps = status(cfg, &slug).await?;
        let problems_after_abandon = problems(cfg, &slug).await?;
        let abandoned_row = problems_after_abandon.iter().find(|row| {
            row.get("status").and_then(|v| v.as_str()) == Some(STATUS_ABANDONED)
                && row.get("id").and_then(|v| v.as_i64()) == Some(entry_id)
        });
        let abandoned_attempts = abandoned_row
            .and_then(|row| row.get("retry_count").and_then(|v| v.as_u64()))
            .unwrap_or(0);
        let abandoned_present = abandoned_row.is_some();

        echo_flag(cfg, &slug, None, Some(false)).await?;
        discard(cfg, &slug, entry_id).await?;
        let after_discard = status(cfg, &slug).await?;
        let problems_after_discard = problems(cfg, &slug).await?;

        let landed_within_budget =
            matches!(landed_at, Some(n) if u64::from(n) <= u64::from(MAX_RETRY_COUNT) + 1);

        let checks = vec![
            (
                "Row reached abandoned within MAX_RETRY_COUNT pumps",
                landed_within_budget,
            ),
            (
                "After pumps: abandoned_count == 1",
                cnt(&after_pumps, "abandoned_count") == 1,
            ),
            (
                "After pumps: pending_count == 0",
                cnt(&after_pumps, "pending_count") == 0,
            ),
            (
                "After pumps: failed_count == 0",
                cnt(&after_pumps, "failed_count") == 0,
            ),
            ("Abandoned row visible in problems list", abandoned_present),
            (
                "Abandoned row's retry_count >= MAX_RETRY_COUNT",
                abandoned_attempts >= u64::from(MAX_RETRY_COUNT),
            ),
            (
                "After discard: abandoned_count == 0",
                cnt(&after_discard, "abandoned_count") == 0,
            ),
            (
                "After discard: failed_count == 0",
                cnt(&after_discard, "failed_count") == 0,
            ),
            (
                "After discard: problems list is empty",
                problems_after_discard.is_empty(),
            ),
        ];
        Ok((after_discard.to_string(), checks))
    })
    .await
}

/// Regression pin for `io::discard_one`'s docstring contract: a
/// discarded row must NOT come back when `force_push` requeues
/// problem rows. Drives an entry to abandoned, discards it, then
/// calls force_push and asserts the row stays gone (status report
/// still zero, and the row id is not in the problems list).
pub async fn discard_blocks_force_push_resurrection(cfg: &Config) -> bool {
    let name = "Sync: Discard Blocks Force Push Resurrection";
    let slug = unique_slug("discard-block");
    run_scenario(cfg, name, &slug, || async {
        seed_project(cfg, &slug).await?;
        let entry_id = enqueue(cfg, &slug, "WI-1", OP_UPDATE).await?;
        echo_flag(cfg, &slug, None, Some(true)).await?;
        for _ in 0..PUMP_OVERSHOOT {
            let _ = pump(cfg, &slug).await?;
        }
        let after_abandon = status(cfg, &slug).await?;

        echo_flag(cfg, &slug, None, Some(false)).await?;
        discard(cfg, &slug, entry_id).await?;
        let after_discard = status(cfg, &slug).await?;

        let requeued = force_push(cfg, &slug).await?;
        let after_force_push = status(cfg, &slug).await?;
        let problems_after = problems(cfg, &slug).await?;
        let id_present = problems_after
            .iter()
            .any(|row| row.get("id").and_then(|v| v.as_i64()) == Some(entry_id));

        let checks = vec![
            (
                "Setup landed row in abandoned",
                cnt(&after_abandon, "abandoned_count") == 1,
            ),
            (
                "Discard cleared the abandoned counter",
                cnt(&after_discard, "abandoned_count") == 0,
            ),
            ("force_push touched zero rows after discard", requeued == 0),
            (
                "After force_push: pending_count == 0 (no resurrection)",
                cnt(&after_force_push, "pending_count") == 0,
            ),
            (
                "After force_push: failed_count == 0",
                cnt(&after_force_push, "failed_count") == 0,
            ),
            (
                "After force_push: abandoned_count == 0",
                cnt(&after_force_push, "abandoned_count") == 0,
            ),
            (
                "Problems list still empty post force_push",
                problems_after.is_empty(),
            ),
            ("Discarded id absent from problems list", !id_present),
        ];
        Ok((after_force_push.to_string(), checks))
    })
    .await
}

/// Wire-format integrity for `OutboxProblemRow`. Seeds two rows
/// targeting distinct work items, drives them both to `Abandoned`
/// via persistent failure (the only path through which the io layer
/// ever stops touching a row, see `mark_failed_with_backoff`), reads
/// the problems list, and compares the field set against the
/// documented TS interface.
///
/// Negative assertions:
/// - Rows must not carry any field outside `PROBLEM_ROW_FIELDS`.
/// - No row carries `status == "pending" | "in_flight" | "succeeded"`
///   (the IO layer pre-filters problems to `Failed | Abandoned`).
pub async fn list_problems_shape(cfg: &Config) -> bool {
    let name = "Sync: List Problems Shape";
    let slug = unique_slug("problems-shape");
    run_scenario(cfg, name, &slug, || async {
        seed_project(cfg, &slug).await?;
        let id_a = enqueue(cfg, &slug, "WI-A", OP_UPDATE).await?;
        let id_b = enqueue(cfg, &slug, "WI-B", OP_UPDATE).await?;

        echo_flag(cfg, &slug, None, Some(true)).await?;
        // Two enqueued rows × `PUMP_OVERSHOOT` push attempts each:
        // one cycle pumps both rows in `MAX_PUSHES_PER_TICK` before
        // bailing. `2 * PUMP_OVERSHOOT` cycles guarantees each row's
        // `retry_count` clears `MAX_RETRY_COUNT` regardless of
        // claim ordering, so both land in `Abandoned` deterministically.
        for _ in 0..(2 * PUMP_OVERSHOOT) {
            let _ = pump(cfg, &slug).await?;
        }
        echo_flag(cfg, &slug, None, Some(false)).await?;

        let rows = problems(cfg, &slug).await?;
        let mut all_fields_present = true;
        let mut no_extra_fields = true;
        let mut all_failed_or_abandoned = true;
        let mut all_abandoned = true;
        let mut all_have_error = true;
        let mut all_attempts_at_budget = true;
        let mut all_have_created_at = true;
        let mut entity_ids: Vec<String> = Vec::new();

        for row in &rows {
            let object = match row.as_object() {
                Some(obj) => obj,
                None => {
                    all_fields_present = false;
                    continue;
                }
            };
            for required in PROBLEM_ROW_FIELDS {
                if !object.contains_key(*required) {
                    all_fields_present = false;
                }
            }
            for key in object.keys() {
                if !PROBLEM_ROW_FIELDS.iter().any(|expected| expected == key) {
                    no_extra_fields = false;
                }
            }
            let row_status = object.get("status").and_then(|v| v.as_str()).unwrap_or("");
            if row_status != STATUS_FAILED && row_status != STATUS_ABANDONED {
                all_failed_or_abandoned = false;
            }
            if row_status != STATUS_ABANDONED {
                all_abandoned = false;
            }
            let last_error = object.get("last_error").and_then(|v| v.as_str());
            if last_error.map(|s| s.is_empty()).unwrap_or(true) {
                all_have_error = false;
            }
            let retry_count = object
                .get("retry_count")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            if retry_count < u64::from(MAX_RETRY_COUNT) {
                all_attempts_at_budget = false;
            }
            if object
                .get("created_at")
                .and_then(|v| v.as_i64())
                .unwrap_or(0)
                <= 0
            {
                all_have_created_at = false;
            }
            if let Some(value) = object.get("entity_id").and_then(|v| v.as_str()) {
                entity_ids.push(value.to_string());
            }
        }

        entity_ids.sort();
        let distinct_entities = entity_ids == vec!["WI-A".to_string(), "WI-B".to_string()];
        let no_pending_status = rows.iter().all(|row| {
            row.get("status")
                .and_then(|v| v.as_str())
                .map(|s| s != STATUS_PENDING)
                .unwrap_or(true)
        });
        let summary =
            serde_json::to_string(&rows).unwrap_or_else(|_| "<unserializable>".to_string());

        let checks = vec![
            ("Both seeded entries got distinct ids", id_a != id_b),
            ("Problems list contains exactly two rows", rows.len() == 2),
            (
                "Every documented field is present on every row",
                all_fields_present,
            ),
            ("No extra fields beyond documented set", no_extra_fields),
            (
                "Every row's status is in {failed, abandoned} (wire union)",
                all_failed_or_abandoned,
            ),
            (
                "Every row landed specifically in 'abandoned' (auto-retry path)",
                all_abandoned,
            ),
            (
                "No 'pending' status leaked into problems wire",
                no_pending_status,
            ),
            ("Every row carries non-empty last_error", all_have_error),
            (
                "Every row's retry_count >= MAX_RETRY_COUNT (budget exhausted)",
                all_attempts_at_budget,
            ),
            ("Every row's created_at is positive", all_have_created_at),
            (
                "Both targeted entity_ids appear (WI-A + WI-B)",
                distinct_entities,
            ),
        ];
        Ok((summary, checks))
    })
    .await
}
