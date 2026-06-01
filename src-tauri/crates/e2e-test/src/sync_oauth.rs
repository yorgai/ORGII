//! Sync OAuth + token-refresh E2E scenarios.
//!
//! Each scenario: (1) bring up the in-process axum mock for
//! `POST /oauth/token` via `mock-token-server/start`, (2) install
//! the override via `oauth/set-token-endpoint`, (3) drive the flow
//! (start + simulate-callback + ensure-fresh-token, or pump the
//! worker for the refresh-failure path), (4) inspect side effects
//! via `oauth/token` (non-secret projection) or `problems`, (5) tear
//! everything down via `oauth_cleanup`. Cleanup is best-effort.

use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use super::config::Config;
use super::sync;

const ADAPTER_LINEAR: &str = "linear";
const TOKEN_SOURCE_OAUTH_REDIRECT: &str = "oauth_redirect";

const STATUS_ABANDONED: &str = "abandoned";
const REFRESH_FAILURE_FRAGMENT: &str = "token refresh failed";

/// Stand up the in-process mock and install the override on the
/// production code. Returns the bound mock URL.
async fn oauth_mock_start(cfg: &Config, status_code: u16, body: &Value) -> Result<String, String> {
    let response = sync::post_json(
        cfg,
        "/agent/test/sync/oauth/mock-token-server/start",
        &json!({ "status": status_code, "body": body }),
    )
    .await?;
    let url = response
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "mock-token-server/start response missing 'url'".to_string())?
        .to_string();
    sync::post_json(
        cfg,
        "/agent/test/sync/oauth/set-token-endpoint",
        &json!({ "url": url.clone() }),
    )
    .await?;
    Ok(url)
}

async fn oauth_start(cfg: &Config, connection_id: &str) -> Result<Value, String> {
    sync::post_json(
        cfg,
        "/agent/test/sync/oauth/start",
        &json!({ "connection_id": connection_id, "adapter_id": ADAPTER_LINEAR }),
    )
    .await
}

async fn oauth_simulate_callback(
    cfg: &Config,
    connection_id: &str,
    code: &str,
    state: &str,
) -> Result<Value, String> {
    sync::post_json(
        cfg,
        "/agent/test/sync/oauth/simulate-callback",
        &json!({
            "connection_id": connection_id,
            "adapter_id": ADAPTER_LINEAR,
            "code": code,
            "state": state,
        }),
    )
    .await
}

async fn oauth_token_status(cfg: &Config, connection_id: &str) -> Result<Value, String> {
    sync::get_json_query(
        cfg,
        "/agent/test/sync/oauth/token",
        &[("connection_id", connection_id)],
    )
    .await
}

async fn oauth_seed_token(
    cfg: &Config,
    connection_id: &str,
    access_token: &str,
    refresh_token: Option<&str>,
    expires_at_unix: Option<i64>,
    source: &str,
) -> Result<(), String> {
    let mut body = serde_json::Map::new();
    body.insert("connection_id".to_string(), json!(connection_id));
    body.insert("access_token".to_string(), json!(access_token));
    body.insert("source".to_string(), json!(source));
    if let Some(refresh) = refresh_token {
        body.insert("refresh_token".to_string(), json!(refresh));
    }
    if let Some(expires) = expires_at_unix {
        body.insert("expires_at_unix".to_string(), json!(expires));
    }
    sync::post_json(
        cfg,
        "/agent/test/sync/oauth/seed-token",
        &Value::Object(body),
    )
    .await
    .map(|_| ())
}

async fn oauth_ensure_fresh_connection_token(
    cfg: &Config,
    connection_id: &str,
) -> Result<Value, String> {
    sync::post_json(
        cfg,
        "/agent/test/sync/oauth/ensure-fresh-token",
        &json!({ "connection_id": connection_id, "adapter_id": ADAPTER_LINEAR }),
    )
    .await
}

/// Install the process-local Linear OAuth client-id override that
/// `oauth::linear::effective_client_id` consults in debug builds.
/// Required before any code path that hits `effective_client_id`
/// directly — i.e. `ensure_fresh_connection_token`'s refresh branch (the
/// happy-path scenario goes through `oauth/start` which takes the
/// client id as a request body parameter and bypasses
/// `effective_client_id`). Pass `None` to clear.
async fn oauth_set_client_id(cfg: &Config, client_id: Option<&str>) -> Result<(), String> {
    let body = match client_id {
        Some(id) => json!({ "client_id": id }),
        None => json!({ "client_id": Value::Null }),
    };
    sync::post_json(cfg, "/agent/test/sync/oauth/set-client-id", &body)
        .await
        .map(|_| ())
}

async fn oauth_mock_status(cfg: &Config) -> Option<Value> {
    // Endpoint is registered as GET in `api/agent/mod.rs`; using POST
    // here returned 405 and silently flattened to None, which made the
    // refresh-on-expired-token scenario's "mock was hit" check fail
    // even though refresh was actually succeeding.
    sync::get_json_query(cfg, "/agent/test/sync/oauth/mock-token-server/status", &[])
        .await
        .ok()
}

/// Best-effort teardown for OAuth scenarios. Order matters: stop the
/// mock first so the production code can never make a successful
/// follow-up call; then clear the override and the stored token; then
/// run the standard `cleanup` to drop the project + outbox rows.
async fn oauth_cleanup(cfg: &Config, slug: &str, connection_id: &str) {
    let _ = sync::post_json(
        cfg,
        "/agent/test/sync/oauth/mock-token-server/stop",
        &json!({}),
    )
    .await;
    let _ = sync::post_json(
        cfg,
        "/agent/test/sync/oauth/set-token-endpoint",
        &json!({ "url": Value::Null }),
    )
    .await;
    let _ = sync::post_json(
        cfg,
        "/agent/test/sync/oauth/clear-token",
        &json!({ "connection_id": connection_id, "adapter_id": ADAPTER_LINEAR }),
    )
    .await;
    let _ = oauth_set_client_id(cfg, None).await;
    sync::cleanup(cfg, slug).await;
}

/// Extract the `state` query parameter from an authorize URL, e.g.
/// `https://linear.app/oauth/authorize?...&state=abcdef&...`.
fn parse_state_from_authorize_url(url: &str) -> Option<String> {
    let query = url.split_once('?')?.1;
    for pair in query.split('&') {
        if let Some(value) = pair.strip_prefix("state=") {
            return Some(value.to_string());
        }
    }
    None
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// `linear-oauth-redirect-happy-path` — the headline scenario.
/// Drives the full PKCE redirect flow against the mock token endpoint
/// and asserts the resulting `ConnectionTokenRecord` has the shape Linear's
/// real response would produce.
pub async fn linear_oauth_redirect_happy_path(cfg: &Config) -> bool {
    let name = "Sync: Linear OAuth Redirect Happy Path";
    let slug = sync::unique_slug("linear-oauth-happy");
    let cleanup_slug = slug.clone();
    sync::run_scenario_with_cleanup(
        name,
        || async {
            let mock_url = oauth_mock_start(
                cfg,
                200,
                &json!({
                    "access_token": "lin_access_x",
                    "refresh_token": "lin_refresh_x",
                    "expires_in": 86400,
                    "token_type": "Bearer",
                    "scope": "read,write",
                }),
            )
            .await?;
            let connection_id = sync::seed_project_with_adapter(cfg, &slug, ADAPTER_LINEAR).await?;

            let start_response = oauth_start(cfg, &connection_id).await?;
            let kind_is_redirect =
                start_response.get("kind").and_then(|v| v.as_str()) == Some("redirect");
            let authorize_url = start_response
                .get("authorize_url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let port = start_response
                .get("port")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);

            let pkce_in_url = authorize_url.contains("code_challenge=")
                && authorize_url.contains("code_challenge_method=S256");

            let state = parse_state_from_authorize_url(&authorize_url)
                .ok_or_else(|| format!("authorize_url missing state param: {}", authorize_url))?;

            oauth_simulate_callback(cfg, &connection_id, "test_code", &state).await?;

            let after_callback = oauth_token_status(cfg, &connection_id).await?;
            let has_token = after_callback
                .get("has_token")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let source_is_oauth = after_callback.get("source").and_then(|v| v.as_str())
                == Some(TOKEN_SOURCE_OAUTH_REDIRECT);
            let has_refresh = after_callback
                .get("has_refresh_token")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let now = now_unix();
            let expires_at = after_callback
                .get("expires_at_unix")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let expiry_in_future = expires_at > now;
            let expiry_within_a_day = expires_at <= now + 86_500;

            let summary = format!(
                "mock_url={} authorize_url={} port={} state={} after_callback={}",
                mock_url, authorize_url, port, state, after_callback
            );
            let checks = vec![
                ("oauth/start returned kind=redirect", kind_is_redirect),
                ("authorize_url includes PKCE challenge + S256", pkce_in_url),
                ("oauth/start exposed a non-zero loopback port", port > 0),
                (
                    "authorize_url echoed a parseable state param",
                    !state.is_empty(),
                ),
                ("Token persisted after simulate-callback", has_token),
                ("Token source is oauth_redirect", source_is_oauth),
                (
                    "Refresh token persisted alongside access token",
                    has_refresh,
                ),
                ("expires_at is in the future", expiry_in_future),
                ("expires_at is within 24h horizon", expiry_within_a_day),
            ];
            Ok((summary, checks))
        },
        || async { oauth_cleanup(cfg, &cleanup_slug, &format!("connection-{cleanup_slug}")).await },
    )
    .await
}

/// `linear-oauth-refresh-on-expired-token` — pre-stash an expired
/// `ConnectionTokenRecord`, point the mock at a refresh response, and drive
/// `ensure_fresh_connection_token`. Asserts the side effects via the non-secret
/// `oauth/token` projection: `expires_at_unix` flipped from the past
/// to the future, `has_refresh_token` stayed true (rotation
/// persisted), and the source tag did not change.
pub async fn linear_oauth_refresh_on_expired_token(cfg: &Config) -> bool {
    let name = "Sync: Linear OAuth Refresh On Expired Token";
    let slug = sync::unique_slug("linear-oauth-refresh");
    let cleanup_slug = slug.clone();
    sync::run_scenario_with_cleanup(
        name,
        || async {
            let now = now_unix();
            let already_expired = now - 300;

            oauth_mock_start(
                cfg,
                200,
                &json!({
                    "access_token": "lin_fresh_after_refresh",
                    "refresh_token": "lin_refresh_rotated",
                    "expires_in": 86400,
                    "token_type": "Bearer",
                    "scope": "read,write",
                }),
            )
            .await?;
            // Refresh path goes through `effective_client_id`, which
            // reads `option_env!("ORGII_LINEAR_OAUTH_CLIENT_ID")` when no
            // process-local override is installed. Dev builds rarely
            // have that env set, so install one explicitly.
            oauth_set_client_id(cfg, Some("e2e_test_client")).await?;
            let connection_id = sync::seed_project_with_adapter(cfg, &slug, ADAPTER_LINEAR).await?;
            oauth_seed_token(
                cfg,
                &connection_id,
                "expired_access",
                Some("expired_refresh"),
                Some(already_expired),
                TOKEN_SOURCE_OAUTH_REDIRECT,
            )
            .await?;

            let pre = oauth_token_status(cfg, &connection_id).await?;
            let pre_expires = pre
                .get("expires_at_unix")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let pre_was_expired = pre_expires < now;

            oauth_ensure_fresh_connection_token(cfg, &connection_id).await?;

            let post = oauth_token_status(cfg, &connection_id).await?;
            let post_expires = post
                .get("expires_at_unix")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let refreshed = post_expires > now;
            let still_has_refresh =
                post.get("has_refresh_token").and_then(|v| v.as_bool()) == Some(true);
            let source_unchanged =
                post.get("source").and_then(|v| v.as_str()) == Some(TOKEN_SOURCE_OAUTH_REDIRECT);

            let mock_state = oauth_mock_status(cfg).await;
            let mock_was_called = mock_state
                .as_ref()
                .and_then(|v| v.get("hits").and_then(|h| h.as_u64()))
                .unwrap_or(0)
                >= 1;

            let summary = format!("pre={} post={}", pre, post);
            let checks = vec![
                ("Pre-state: token was expired", pre_was_expired),
                (
                    "Mock token endpoint received the refresh request",
                    mock_was_called,
                ),
                ("Post-state: token expiry is in the future", refreshed),
                (
                    "Post-state: refresh token still present (rotation persisted)",
                    still_has_refresh,
                ),
                (
                    "Post-state: source is unchanged (oauth_redirect)",
                    source_unchanged,
                ),
            ];
            Ok((summary, checks))
        },
        || async { oauth_cleanup(cfg, &cleanup_slug, &format!("connection-{cleanup_slug}")).await },
    )
    .await
}

/// `linear-oauth-refresh-failure-walks-to-abandoned` — pre-stash an
/// expired `ConnectionTokenRecord`, point the refresh endpoint at a 401, run
/// the worker pump `MAX_RETRY_COUNT + 1` times, and assert the
/// outbox row ends in `abandoned` with `last_error` containing
/// `"token refresh failed"`. Defends the worker's refusal to keep
/// retrying once the refresh contract is broken.
pub async fn linear_oauth_refresh_failure_walks_to_abandoned(cfg: &Config) -> bool {
    let name = "Sync: Linear OAuth Refresh Failure Walks To Abandoned";
    let slug = sync::unique_slug("linear-oauth-refresh-fail");
    let cleanup_slug = slug.clone();
    sync::run_scenario_with_cleanup(
        name,
        || async {
            let already_expired = now_unix() - 300;

            oauth_mock_start(
                cfg,
                401,
                &json!({
                    "error": "invalid_grant",
                    "error_description": "refresh token expired",
                }),
            )
            .await?;
            // Worker push path eventually calls `ensure_fresh_token` →
            // `effective_client_id`. Without an override the dev build
            // bails out with "client id not configured" *before* hitting
            // the mock, which makes `mock_hits >= 1` impossible.
            oauth_set_client_id(cfg, Some("e2e_test_client")).await?;
            let connection_id = sync::seed_project_with_adapter(cfg, &slug, ADAPTER_LINEAR).await?;
            oauth_seed_token(
                cfg,
                &connection_id,
                "expired_access",
                Some("expired_refresh"),
                Some(already_expired),
                TOKEN_SOURCE_OAUTH_REDIRECT,
            )
            .await?;

            sync::enqueue(cfg, &slug, "WI-REFRESH-FAIL", sync::OP_CREATE).await?;

            for _ in 0..sync::PUMP_OVERSHOOT {
                let _ = sync::pump(cfg, &slug).await?;
            }

            let rows = sync::problems(cfg, &slug).await?;
            let row = rows
                .iter()
                .find(|row| {
                    row.get("entity_id").and_then(|v| v.as_str()) == Some("WI-REFRESH-FAIL")
                })
                .cloned()
                .ok_or_else(|| {
                    "problems list missing the seeded WI-REFRESH-FAIL row".to_string()
                })?;

            let row_status = row
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let last_error = row
                .get("last_error")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let retry_count = row.get("retry_count").and_then(|v| v.as_u64()).unwrap_or(0);

            let mock_state = oauth_mock_status(cfg).await;
            let mock_hits = mock_state
                .as_ref()
                .and_then(|v| v.get("hits").and_then(|h| h.as_u64()))
                .unwrap_or(0);

            let token_after = oauth_token_status(cfg, &connection_id).await?;
            let still_has_token =
                token_after.get("has_token").and_then(|v| v.as_bool()) == Some(true);
            let token_still_expired = token_after
                .get("expires_at_unix")
                .and_then(|v| v.as_i64())
                .map(|expiry| expiry < now_unix())
                .unwrap_or(false);

            let summary = format!(
                "row_status={} last_error={} retry_count={} mock_hits={} token_after={}",
                row_status, last_error, retry_count, mock_hits, token_after
            );
            let checks = vec![
                (
                    "Outbox row landed in abandoned status",
                    row_status == STATUS_ABANDONED,
                ),
                (
                    "last_error mentions 'token refresh failed'",
                    last_error.to_lowercase().contains(REFRESH_FAILURE_FRAGMENT),
                ),
                (
                    "retry_count >= MAX_RETRY_COUNT",
                    retry_count >= u64::from(sync::MAX_RETRY_COUNT),
                ),
                (
                    "Mock /oauth/token was hit at least once during the pump loop",
                    mock_hits >= 1,
                ),
                (
                    "Stored token survives the failed refresh (no destructive clear)",
                    still_has_token,
                ),
                (
                    "Stored token's expires_at_unix is still in the past",
                    token_still_expired,
                ),
            ];
            Ok((summary, checks))
        },
        || async { oauth_cleanup(cfg, &cleanup_slug, &format!("connection-{cleanup_slug}")).await },
    )
    .await
}

/// `linear-oauth-state-mismatch` — supplying the wrong `state` on the
/// callback must reject the exchange and leave the token store
/// untouched. Defends against the CSRF attack OAuth redirect flows
/// are designed to prevent.
pub async fn linear_oauth_state_mismatch_rejects_token(cfg: &Config) -> bool {
    let name = "Sync: Linear OAuth State Mismatch Rejects Token";
    let slug = sync::unique_slug("linear-oauth-state");
    let cleanup_slug = slug.clone();
    sync::run_scenario_with_cleanup(
        name,
        || async {
            oauth_mock_start(
                cfg,
                200,
                &json!({
                    "access_token": "should_not_persist",
                    "expires_in": 86400,
                    "token_type": "Bearer",
                }),
            )
            .await?;
            let connection_id = sync::seed_project_with_adapter(cfg, &slug, ADAPTER_LINEAR).await?;
            let start = oauth_start(cfg, &connection_id).await?;
            let authorize_url = start
                .get("authorize_url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let real_state = parse_state_from_authorize_url(&authorize_url).unwrap_or_default();

            let mismatch = oauth_simulate_callback(cfg, &connection_id, "test_code", "WRONG_STATE")
                .await
                .err()
                .unwrap_or_default();
            let mismatched_was_rejected = mismatch.to_lowercase().contains("state_mismatch");

            let after = oauth_token_status(cfg, &connection_id).await?;
            let still_no_token = after.get("has_token").and_then(|v| v.as_bool()) == Some(false);

            let summary = format!(
                "real_state={} rejection={} after={}",
                real_state, mismatch, after
            );
            let checks = vec![
                (
                    "real authorize_url state was non-empty",
                    !real_state.is_empty(),
                ),
                (
                    "simulate-callback with wrong state was rejected with state_mismatch",
                    mismatched_was_rejected,
                ),
                (
                    "Token store was NOT populated by the rejected callback",
                    still_no_token,
                ),
            ];
            Ok((summary, checks))
        },
        || async { oauth_cleanup(cfg, &cleanup_slug, &format!("connection-{cleanup_slug}")).await },
    )
    .await
}
