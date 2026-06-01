//! Webhook E2E scenarios (`--group sync`).
//!
//! These scenarios drive the full inbound webhook path:
//!
//!   1. Seed a project + attach the Echo adapter (so the worker
//!      poll-cycle scheduler has an adapter binding to honour).
//!   2. Install a webhook secret via the `/test/sync/webhook/install`
//!      debug endpoint, which both stamps `webhook_secrets` and
//!      surfaces the plaintext secret to the e2e binary so it can
//!      compute valid HMAC-SHA256 signatures.
//!   3. POST a signed (or deliberately-mis-signed) payload to the
//!      production listener path `POST /sync/webhook/:adapter/:slug`
//!      mounted by `webhook_listener::router()`.
//!   4. Read back outbox state + the `sync_last_webhook_at` clock to
//!      assert what should and should not have happened.
//!
//! Webhook listener responses are HTTP-status-driven (200 on accept,
//! 401 on bad signature, 404 on missing setup); the helpers below
//! return the status code so scenarios can pin the negative case.
//!
//! Each scenario uses a freshly-minted slug + `cleanup` finally block
//! so it can interleave with other groups without cross-talk.

use std::time::{SystemTime, UNIX_EPOCH};

use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;

use super::config::Config;
use super::sync::{cleanup, post_json, run_scenario_with_cleanup, seed_project, unique_slug};

/// Echo adapter signature header — matches
/// `EchoAdapter::ECHO_SIGNATURE_HEADER` Rust-side. Kept inline so a
/// rename on the adapter trips a compile error here via the
/// integration tests, not just the e2e harness.
const ECHO_SIGNATURE_HEADER: &str = "x-echo-signature";

/// HMAC-SHA256 signature in the format the EchoAdapter expects.
/// Mirrors `webhook_signature_for` in
/// `project_management/sync/adapters/echo.rs::tests`.
fn echo_signature(body: &[u8], secret_hex: &str) -> String {
    let key = hex::decode(secret_hex).expect("hex secret from install endpoint");
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&key).expect("hmac key");
    mac.update(body);
    format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
}

/// Mint a webhook secret for `(slug, adapter_id)` via the debug
/// install endpoint. Returns the plaintext secret so the scenario
/// can compute signatures.
async fn install_webhook(cfg: &Config, slug: &str, adapter_id: &str) -> Result<String, String> {
    let value = post_json(
        cfg,
        "/agent/test/sync/webhook/install",
        &json!({ "slug": slug, "adapter_id": adapter_id }),
    )
    .await?;
    value
        .get("secret_hex")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| "webhook install response missing 'secret_hex'".to_string())
}

/// Read `projects.sync_last_webhook_at` for `slug`. `None` when no
/// delivery has landed (or the project doesn't exist yet — caller
/// should have seeded by now).
async fn last_webhook_at(cfg: &Config, slug: &str) -> Result<Option<i64>, String> {
    let url = format!(
        "{}/agent/test/sync/webhook/status?slug={}",
        cfg.base_url, slug
    );
    let resp = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(cfg.timeout_secs))
        .build()
        .expect("reqwest client")
        .get(&url)
        .send()
        .await
        .map_err(|err| format!("HTTP error (webhook/status): {}", err))?;
    let value: Value = resp
        .json()
        .await
        .map_err(|err| format!("JSON parse error (webhook/status): {}", err))?;
    if let Some(err) = value.get("error").and_then(|v| v.as_str()) {
        return Err(format!("webhook/status returned error: {}", err));
    }
    Ok(value.get("last_webhook_at").and_then(|v| v.as_i64()))
}

async fn clear_webhook_stamp(cfg: &Config, slug: &str) -> Result<(), String> {
    post_json(
        cfg,
        "/agent/test/sync/webhook/clear-stamp",
        &json!({ "slug": slug }),
    )
    .await
    .map(|_| ())
}

/// POST a body to the production listener route and return the HTTP
/// status code + parsed body (best-effort). The listener returns
/// plain-text on errors and `"ok"` on success, so we capture the body
/// as a `String` instead of forcing a JSON parse.
async fn deliver_webhook(
    cfg: &Config,
    slug: &str,
    adapter_id: &str,
    body: &[u8],
    signature: Option<&str>,
) -> Result<(u16, String), String> {
    let url = format!("{}/sync/webhook/{}/{}", cfg.base_url, adapter_id, slug);
    let mut request = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(cfg.timeout_secs))
        .build()
        .expect("reqwest client")
        .post(&url)
        .header("content-type", "application/json")
        .body(body.to_vec());
    if let Some(sig) = signature {
        request = request.header(ECHO_SIGNATURE_HEADER, sig);
    }
    let resp = request
        .send()
        .await
        .map_err(|err| format!("HTTP error (webhook deliver): {}", err))?;
    let status = resp.status().as_u16();
    let body = resp
        .text()
        .await
        .map_err(|err| format!("body read error: {}", err))?;
    Ok((status, body))
}

/// Outbox row count for `slug` filtered by `op`. Reads through the
/// debug status endpoint so we don't need a separate "count
/// merge_external rows" surface — `pending_count` post-delivery is
/// the right signal because the listener writes `merge_external`
/// rows in `Pending` state and the e2e harness never pumps them.
async fn pending_count(cfg: &Config, slug: &str) -> Result<u64, String> {
    let value = post_json(cfg, "/agent/test/sync/status", &json!({ "slug": slug }))
        .await
        .ok();
    if let Some(v) = value {
        if let Some(report) = v.get("report") {
            return Ok(report
                .get("pending_count")
                .and_then(|n| n.as_u64())
                .unwrap_or(0));
        }
    }
    // Fall back to GET — the test surface uses GET for status.
    let url = format!("{}/agent/test/sync/status?slug={}", cfg.base_url, slug);
    let resp = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(cfg.timeout_secs))
        .build()
        .expect("reqwest client")
        .get(&url)
        .send()
        .await
        .map_err(|err| format!("HTTP error (status): {}", err))?;
    let value: Value = resp
        .json()
        .await
        .map_err(|err| format!("JSON parse error (status): {}", err))?;
    Ok(value
        .pointer("/report/pending_count")
        .and_then(|n| n.as_u64())
        .unwrap_or(0))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ============================================================================
// Scenarios
// ============================================================================

/// Happy path: install the webhook secret, deliver one signed payload
/// carrying a single `ExternalChange`, and assert the listener:
///
///   - returned 200,
///   - wrote one `merge_external` outbox row for the slug, and
///   - stamped `projects.sync_last_webhook_at` so the worker knows
///     it can skip the next poll.
pub async fn webhook_delivers_inbound_change(cfg: &Config) -> bool {
    let name = "Sync: Webhook Delivers Inbound Change";
    let slug = unique_slug("webhook-delivers");
    let adapter_id = "echo";
    let scenario_slug = slug.clone();
    run_scenario_with_cleanup(
        name,
        || async {
            seed_project(cfg, &slug).await?;
            let secret = install_webhook(cfg, &slug, adapter_id).await?;

            let pending_pre = pending_count(cfg, &slug).await?;

            let body = r#"{"changes":[{"entity_type":"work_item","external_id":"WI-WHK-1","fields":{"title":"webhook seeded"},"updated_at":"2026-01-01T00:00:00Z","deleted":false}]}"#.to_string();
            let signature = echo_signature(body.as_bytes(), &secret);
            let started = now_ms();
            let (status, response_body) =
                deliver_webhook(cfg, &slug, adapter_id, body.as_bytes(), Some(&signature)).await?;

            let pending_post = pending_count(cfg, &slug).await?;
            let stamp = last_webhook_at(cfg, &slug).await?;

            let stamp_inside_window = matches!(stamp, Some(ts) if (ts - started).abs() < 60_000);

            let summary = json!({
                "status": status,
                "response": response_body,
                "pending_pre": pending_pre,
                "pending_post": pending_post,
                "stamp": stamp,
            });

            let checks = vec![
                ("Listener returned 200", status == 200),
                (
                    "Listener wrote one merge_external outbox row",
                    pending_post == pending_pre + 1,
                ),
                ("sync_last_webhook_at was stamped", stamp.is_some()),
                (
                    "Stamp falls inside a sane freshness window",
                    stamp_inside_window,
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

/// Negative path: deliver a payload signed with the wrong secret and
/// assert the listener:
///
///   - returned 401,
///   - did **not** write an outbox row, and
///   - did **not** stamp the freshness clock.
///
/// Pins the listener's "rejected delivery is observationally a no-op"
/// invariant. A regression that swapped HMAC for a constant-time
/// compare bug would surface here as the 200 case, the outbox
/// mutation case, or the stamp case — all three are checked
/// explicitly so the failure mode is always classifiable.
pub async fn webhook_bad_signature_rejected(cfg: &Config) -> bool {
    let name = "Sync: Webhook Bad Signature Rejected";
    let slug = unique_slug("webhook-bad-sig");
    let adapter_id = "echo";
    let scenario_slug = slug.clone();
    run_scenario_with_cleanup(
        name,
        || async {
            seed_project(cfg, &slug).await?;
            let _real_secret = install_webhook(cfg, &slug, adapter_id).await?;

            let pending_pre = pending_count(cfg, &slug).await?;

            let body = br#"{"changes":[]}"#;
            // Sign with a different secret — caller must reject.
            let bogus_secret = "ff".repeat(32);
            let bogus_signature = echo_signature(body, &bogus_secret);
            let (status, response_body) =
                deliver_webhook(cfg, &slug, adapter_id, body, Some(&bogus_signature)).await?;

            let pending_post = pending_count(cfg, &slug).await?;
            let stamp = last_webhook_at(cfg, &slug).await?;

            let summary = json!({
                "status": status,
                "response": response_body,
                "pending_pre": pending_pre,
                "pending_post": pending_post,
                "stamp": stamp,
            });

            let checks = vec![
                ("Listener returned 401", status == 401),
                ("No outbox row was written", pending_post == pending_pre),
                ("sync_last_webhook_at not stamped", stamp.is_none()),
            ];
            Ok((summary.to_string(), checks))
        },
        || async {
            cleanup(cfg, &scenario_slug).await;
        },
    )
    .await
}

/// Freshness fall-back: the worker's poll scheduler skips a poll if a
/// webhook landed inside `WEBHOOK_FRESHNESS_WINDOW_MS`. This scenario
/// exercises the negative case — when the freshness clock is cleared
/// (simulating "webhook hasn't fired in 10 minutes"), the poll path
/// is **not** suppressed.
///
/// We can't fast-forward `Instant`-driven worker timers from the e2e
/// harness, so this scenario instead pins the **state**: after
/// installing a webhook, delivering a signed payload, and then
/// clearing the stamp, the project's `sync_last_webhook_at` reverts
/// to `null` — which is the exact column the worker reads to decide
/// whether to suppress polls. The pull-cycle scheduler unit tests in
/// `worker.rs` already cover the suppression logic itself; this
/// scenario locks the wire-level state-mutation contract that drives
/// it.
pub async fn webhook_fall_back_to_poll_when_stale(cfg: &Config) -> bool {
    let name = "Sync: Webhook Falls Back to Poll When Stale";
    let slug = unique_slug("webhook-stale");
    let adapter_id = "echo";
    let scenario_slug = slug.clone();
    run_scenario_with_cleanup(
        name,
        || async {
            seed_project(cfg, &slug).await?;
            let secret = install_webhook(cfg, &slug, adapter_id).await?;

            // Step 1: deliver a signed delivery so the freshness
            // clock starts ticking.
            let body = br#"{"changes":[]}"#;
            let signature = echo_signature(body, &secret);
            let (status_post, _) =
                deliver_webhook(cfg, &slug, adapter_id, body, Some(&signature)).await?;
            let stamp_after_delivery = last_webhook_at(cfg, &slug).await?;

            // Step 2: simulate "10 minutes elapsed without another
            // delivery" by clearing the stamp directly. The worker
            // would re-arm polling at this point.
            clear_webhook_stamp(cfg, &slug).await?;
            let stamp_after_clear = last_webhook_at(cfg, &slug).await?;

            let summary = json!({
                "status_post": status_post,
                "stamp_after_delivery": stamp_after_delivery,
                "stamp_after_clear": stamp_after_clear,
            });

            let checks = vec![
                ("Initial signed delivery returned 200", status_post == 200),
                (
                    "Stamp was set immediately after delivery",
                    stamp_after_delivery.is_some(),
                ),
                (
                    "Cleared stamp returns to null (poll path re-enabled)",
                    stamp_after_clear.is_none(),
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
