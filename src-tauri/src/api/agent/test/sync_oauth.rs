//! `/agent/test/sync/oauth/*` endpoints (debug-only).
//!
//! OAuth + token-refresh E2E surface. Drives Linear's
//! authorization-code + PKCE flow and the `ensure_fresh_connection_token`
//! refresh contract end-to-end without ever hitting the real Linear endpoints.
//!
//! Three families of handlers live here:
//!
//! 1. **Mock token endpoint control** — the e2e binary cannot import
//!    `wiremock` (it's a `[dev-dependencies]` member of the `app`
//!    crate, so only `cargo test` targets see it). Instead, the
//!    backend itself stands up an axum-served mock for `POST
//!    /oauth/token` and lets the e2e binary configure the canned
//!    response via `mock-token-server/*` endpoints. Combined with
//!    `oauth/set-token-endpoint` (which threads the mock URL into the
//!    production [`oauth::linear::exchange_code`] / [`oauth::linear::refresh`]
//!    code paths), the production flow runs unchanged against a fake
//!    server we own.
//! 2. **Flow control** — `oauth/set-token-endpoint`,
//!    `oauth/set-client-id`, `oauth/start`, `oauth/simulate-callback`,
//!    `oauth/cancel`, `oauth/ensure-fresh-token`. These wrap the
//!    `oauth/{linear,mod}` and `commands/sync` debug seams the
//!    backend exposes specifically for the e2e harness.
//! 3. **Connection token inspection / seeding** — `oauth/token`
//!    (non-secret projection), `oauth/seed-token`, and `oauth/clear-token`.
//!    Lets scenarios pre-stage `ConnectionTokenRecord`s and assert what
//!    the store contains without ever leaking bearer plaintext over HTTP.
//!
//! All handlers are gated by the parent `mod test`'s
//! `#[cfg(debug_assertions)]`; release builds compile the entire file
//! out.

#![cfg(debug_assertions)]

use std::net::SocketAddr;
use std::sync::{LazyLock, Mutex};

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post as axum_post;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use project_management::projects::commands::sync as commands_sync;
use project_management::sync::connection_token_store::{self, ConnectionTokenRecord};
use project_management::sync::oauth;

// ============================================================================
// Mock OAuth token endpoint (in-process axum server)
// ============================================================================

/// Canned response a [`MockTokenServer`] returns for `POST /oauth/token`.
/// The e2e binary configures this through the `mock-token-server/start`
/// endpoint before pointing the production code at the mock via
/// [`oauth::linear::set_test_token_endpoint`].
#[derive(Debug, Clone)]
struct MockResponse {
    status: u16,
    body: String,
    /// Capped count of handled requests so scenarios can assert the
    /// production code actually called the mock (rather than
    /// returning a cached value).
    hits: u32,
}

/// Live mock server tracked by [`MOCK_SERVER`]. Carries the bound
/// `local_addr` so the start handler can echo the URL back to the
/// e2e binary, and a `CancellationToken` + [`JoinHandle`] so
/// `mock-token-server/stop` can shut it down cleanly.
struct MockTokenServer {
    url: String,
    cancel: CancellationToken,
    handle: JoinHandle<()>,
    response: std::sync::Arc<Mutex<MockResponse>>,
}

static MOCK_SERVER: LazyLock<Mutex<Option<MockTokenServer>>> = LazyLock::new(|| Mutex::new(None));

/// Stop and drop any prior live mock server. Idempotent.
async fn stop_mock_server_inner() {
    let prior = {
        let mut guard = match MOCK_SERVER.lock() {
            Ok(guard) => guard,
            Err(err) => {
                tracing::warn!("[test/sync/oauth] mock server lock poisoned: {}", err);
                return;
            }
        };
        guard.take()
    };
    if let Some(server) = prior {
        server.cancel.cancel();
        let _ = server.handle.await;
    }
}

#[derive(Debug, Deserialize)]
pub struct MockServerStartRequest {
    /// HTTP status the mock returns for `POST /oauth/token`. Use 200
    /// for the happy-path / refresh scenarios; 401 for the
    /// refresh-walks-to-abandoned scenario.
    status: u16,
    /// Pre-rendered JSON body returned verbatim. The e2e binary
    /// builds this with `serde_json::json!` so the keys / values
    /// match Linear's actual response shape.
    body: Value,
}

/// Bring up a fresh mock server bound to an ephemeral loopback port.
/// Idempotent: any prior server is torn down first.
///
/// Returns `{ url }` — the absolute URL the e2e scenario should pass
/// to `oauth/set-token-endpoint`.
pub async fn test_oauth_mock_server_start(
    Json(request): Json<MockServerStartRequest>,
) -> Json<Value> {
    stop_mock_server_inner().await;

    let body_str = serde_json::to_string(&request.body)
        .expect("request.body is serde_json::Value, must serialize");
    let response_state = std::sync::Arc::new(Mutex::new(MockResponse {
        status: request.status,
        body: body_str,
        hits: 0,
    }));

    let listener = match TcpListener::bind("127.0.0.1:0").await {
        Ok(listener) => listener,
        Err(err) => return err_json(format!("mock bind failed: {}", err)),
    };
    let addr: SocketAddr = match listener.local_addr() {
        Ok(addr) => addr,
        Err(err) => return err_json(format!("mock local_addr failed: {}", err)),
    };
    let url = format!("http://{}/oauth/token", addr);

    let cancel = CancellationToken::new();
    let server_cancel = cancel.clone();
    let app = Router::new()
        .route("/oauth/token", axum_post(mock_token_handler))
        .with_state(response_state.clone());

    let (ready_tx, ready_rx) = oneshot::channel::<()>();
    let handle = tokio::spawn(async move {
        let _ = ready_tx.send(());
        tokio::select! {
            _ = axum::serve(listener, app) => {}
            _ = server_cancel.cancelled() => {}
        }
    });
    let _ = ready_rx.await;

    let server = MockTokenServer {
        url: url.clone(),
        cancel,
        handle,
        response: response_state,
    };
    if let Ok(mut guard) = MOCK_SERVER.lock() {
        *guard = Some(server);
    } else {
        return err_json("mock server lock poisoned at install");
    }

    Json(json!({ "ok": true, "url": url }))
}

/// Tear down the live mock server, if any. Idempotent.
pub async fn test_oauth_mock_server_stop() -> Json<Value> {
    stop_mock_server_inner().await;
    Json(json!({ "ok": true }))
}

/// Snapshot of the live mock server: bound `url` + how many `POST
/// /oauth/token` requests have hit it. Lets scenarios assert the
/// production code actually called through to the mock (and didn't
/// short-circuit on a cached token).
pub async fn test_oauth_mock_server_status() -> Json<Value> {
    let guard = match MOCK_SERVER.lock() {
        Ok(guard) => guard,
        Err(_) => return err_json("mock server lock poisoned"),
    };
    let snapshot = guard.as_ref().map(|server| {
        let hits = server.response.lock().map(|state| state.hits).unwrap_or(0);
        (server.url.clone(), hits)
    });
    drop(guard);
    match snapshot {
        Some((url, hits)) => Json(json!({ "ok": true, "running": true, "url": url, "hits": hits })),
        None => Json(json!({ "ok": true, "running": false })),
    }
}

async fn mock_token_handler(
    State(state): State<std::sync::Arc<Mutex<MockResponse>>>,
) -> impl IntoResponse {
    let snapshot = {
        let mut guard = match state.lock() {
            Ok(guard) => guard,
            Err(_) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    [("content-type", "application/json")],
                    "{\"error\":\"mock state poisoned\"}".to_string(),
                )
                    .into_response();
            }
        };
        guard.hits = guard.hits.saturating_add(1);
        (guard.status, guard.body.clone())
    };
    let status = StatusCode::from_u16(snapshot.0).unwrap_or(StatusCode::OK);
    (status, [("content-type", "application/json")], snapshot.1).into_response()
}

// ============================================================================
// Flow control
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct SetTokenEndpointRequest {
    /// Absolute URL to override `https://api.linear.app/oauth/token`
    /// with. `null` clears the override and restores production
    /// behaviour for subsequent calls.
    #[serde(default)]
    url: Option<String>,
}

/// Install (or clear) the Linear `/oauth/token` URL override. Backed
/// by [`oauth::linear::set_test_token_endpoint`]. Used by every OAuth
/// scenario to redirect the production code at the in-process mock.
pub async fn test_oauth_set_token_endpoint(
    Json(request): Json<SetTokenEndpointRequest>,
) -> Json<Value> {
    oauth::linear::set_test_token_endpoint(request.url.clone());
    Json(json!({ "ok": true, "url": request.url }))
}

#[derive(Debug, Deserialize)]
pub struct SetClientIdRequest {
    /// Synthetic Linear OAuth client id, e.g. `"e2e_test_client"`.
    /// `null` clears the override and falls back to
    /// [`oauth::linear::configured_client_id`] (which itself returns
    /// `None` unless the production env var was baked into the
    /// build).
    #[serde(default)]
    client_id: Option<String>,
}

/// Install (or clear) the test override for the Linear OAuth client
/// id. Backed by [`oauth::linear::set_test_client_id`]. Required so
/// the `ensure-fresh-token` and `start` paths can run without
/// depending on `ORGII_LINEAR_OAUTH_CLIENT_ID` being set at build time
/// on dev / CI machines.
pub async fn test_oauth_set_client_id(Json(request): Json<SetClientIdRequest>) -> Json<Value> {
    oauth::linear::set_test_client_id(request.client_id.clone());
    Json(json!({ "ok": true, "client_id": request.client_id }))
}

#[derive(Debug, Deserialize)]
pub struct OAuthStartRequest {
    connection_id: String,
    adapter_id: String,
    /// Synthetic client id to install via
    /// [`oauth::linear::set_test_client_id`] before driving the
    /// shared start path. Optional — scenarios that already called
    /// `oauth/set-client-id` separately can omit this and rely on
    /// the existing override.
    #[serde(default)]
    client_id: Option<String>,
}

/// Drive the shared
/// [`commands_sync::start_oauth_flow_inner`] code path with
/// `skip_browser=true` so the e2e harness exercises the same
/// descriptor + `PENDING_FLOWS` registration logic the production
/// connection OAuth start command runs. The only short-circuit is the
/// `tauri_plugin_opener::open_url` call (no-op browser would block
/// headless runs).
///
/// Pre-installs the supplied `client_id` via
/// [`oauth::linear::set_test_client_id`] so the inner function's
/// `effective_client_id()` resolver can return a non-empty id without
/// the production `ORGII_LINEAR_OAUTH_CLIENT_ID` env being baked in.
pub async fn test_oauth_start(Json(request): Json<OAuthStartRequest>) -> Json<Value> {
    // Mirror Linear's debug-override seam (scenarios use it
    // unconditionally before starting). GitHub goes through its own
    // `set_test_client_id` if the scenario needs it.
    if request.adapter_id == "linear" {
        let id = request
            .client_id
            .clone()
            .unwrap_or_else(|| "e2e_test_client".to_string());
        oauth::linear::set_test_client_id(Some(id));
    }

    let started = match commands_sync::start_oauth_flow_inner(
        commands_sync::PendingFlowScope::ConnectionId(request.connection_id.clone()),
        &request.adapter_id,
        commands_sync::StartOauthOptions::test_skip_browser(),
    )
    .await
    {
        Ok(started) => started,
        Err(err) => return err_json(format!("start failed: {}", err)),
    };

    // Project the public wire shape back into the loose JSON the
    // existing scenarios expect (kind / authorize_url / expires /
    // port for redirect; kind / verification_uri / user_code /
    // expires_at_unix / interval for device). `loopback_port` is
    // `Some(_)` only for redirect flows, mirrored back so scenarios
    // can assert "the listener actually bound a port".
    let body = match started.public {
        oauth::OAuthFlowStart::Redirect {
            authorize_url,
            expires_at_unix,
        } => json!({
            "ok": true,
            "kind": "redirect",
            "authorize_url": authorize_url,
            "expires_at_unix": expires_at_unix,
            "port": started.loopback_port.unwrap_or(0),
        }),
        oauth::OAuthFlowStart::Device {
            verification_uri,
            user_code,
            expires_at_unix,
            interval_secs,
        } => json!({
            "ok": true,
            "kind": "device",
            "verification_uri": verification_uri,
            "user_code": user_code,
            "expires_at_unix": expires_at_unix,
            "interval_secs": interval_secs,
        }),
    };
    Json(body)
}

#[derive(Debug, Deserialize)]
pub struct SimulateCallbackRequest {
    connection_id: String,
    adapter_id: String,
    /// Authorization code the simulated browser would have appended
    /// to the redirect URI. Forwarded verbatim to the mock token
    /// endpoint via [`oauth::linear::exchange_code`].
    code: String,
    /// State value the simulated browser would have echoed back.
    /// Used by the simulated callback to assert the pending flow's
    /// expected state matched.
    state: String,
}

/// Simulate the browser's redirect to
/// `http://127.0.0.1:{port}/callback?code=…&state=…` without binding
/// a real port.
///
/// Returns `{ ok: true }` when the exchange succeeded and the token
/// landed in the store. Returns an error string containing
/// `"state_mismatch"` when the caller-supplied `state` does not match
/// the pending flow's recorded value (no token persisted).
pub async fn test_oauth_simulate_callback(
    Json(request): Json<SimulateCallbackRequest>,
) -> Json<Value> {
    match simulate_connection_redirect_callback(
        &request.connection_id,
        &request.adapter_id,
        &request.code,
        &request.state,
    )
    .await
    {
        Ok(()) => Json(json!({ "ok": true })),
        Err(err) => err_json(err),
    }
}

#[derive(Debug, Deserialize)]
pub struct ConnectionAdapterRequest {
    connection_id: String,
    adapter_id: String,
}

/// Cancel the pending flow for `(connection_id, adapter_id)` and drop
/// it from the registry.
pub async fn test_oauth_cancel(Json(request): Json<ConnectionAdapterRequest>) -> Json<Value> {
    commands_sync::debug_drop_connection_pending(&request.connection_id, &request.adapter_id);
    Json(json!({ "ok": true }))
}

/// Force a refresh through [`oauth::ensure_fresh_connection_token`]. Returns
/// `{ ok: true, refreshed: true }` if the call succeeded, or
/// `{ ok: false, error }` if it failed. The bearer is **never**
/// echoed back — the scenario asserts refresh side effects via
/// `oauth/token` instead.
pub async fn test_oauth_ensure_fresh_token(
    Json(request): Json<ConnectionAdapterRequest>,
) -> Json<Value> {
    match oauth::ensure_fresh_connection_token(&request.connection_id, &request.adapter_id).await {
        Ok(_bearer) => Json(json!({ "ok": true, "refreshed": true })),
        Err(err) => err_json(err),
    }
}

async fn simulate_connection_redirect_callback(
    connection_id: &str,
    adapter_id: &str,
    code: &str,
    state: &str,
) -> Result<(), String> {
    let snapshot = commands_sync::debug_peek_connection_redirect_flow(connection_id, adapter_id)
        .ok_or_else(|| "no pending redirect flow".to_string())?;
    if snapshot.adapter_id != adapter_id {
        return Err(format!(
            "pending flow adapter mismatch: expected '{}' got '{}'",
            adapter_id, snapshot.adapter_id
        ));
    }
    if state != snapshot.state {
        return Err("state_mismatch".to_string());
    }

    let outcome = match adapter_id {
        "linear" => {
            oauth::linear::exchange_code(
                &snapshot.client_id,
                code,
                &snapshot.code_verifier,
                &snapshot.redirect_uri,
            )
            .await
        }
        other => {
            commands_sync::debug_drop_connection_pending(connection_id, adapter_id);
            return Err(format!(
                "simulate_redirect_callback not implemented for adapter '{}'",
                other
            ));
        }
    };

    commands_sync::debug_drop_connection_pending(connection_id, adapter_id);

    match outcome {
        oauth::PollOutcome::Token(record) => {
            connection_token_store::save(connection_id, record)?;
            Ok(())
        }
        oauth::PollOutcome::AccessDenied => Err("oauth_access_denied".to_string()),
        oauth::PollOutcome::Expired => Err("oauth_expired".to_string()),
        oauth::PollOutcome::Cancelled => Err("oauth_cancelled".to_string()),
        oauth::PollOutcome::PollFailed(detail) => Err(format!("oauth_poll_failed: {}", detail)),
    }
}

// ============================================================================
// Connection token inspection / seeding
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct TokenQuery {
    connection_id: String,
}

/// Non-secret projection of the stored [`ConnectionTokenRecord`] for
/// `connection_id`. NEVER returns the access token or refresh
/// token plaintext — scenarios assert presence + expiry +
/// source, never the bearer bytes themselves.
pub async fn test_oauth_token(Query(query): Query<TokenQuery>) -> Json<Value> {
    let record = connection_token_store::get(&query.connection_id).unwrap_or(None);
    match record {
        Some(record) => Json(json!({
            "ok": true,
            "has_token": true,
            "source": record.source,
            "expires_at_unix": record.expires_at_unix,
            "has_refresh_token": record.refresh_token.is_some(),
        })),
        None => Json(json!({
            "ok": true,
            "has_token": false,
            "source": Value::Null,
            "expires_at_unix": Value::Null,
            "has_refresh_token": false,
        })),
    }
}

#[derive(Debug, Deserialize)]
pub struct SeedTokenRequest {
    connection_id: String,
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_at_unix: Option<i64>,
    /// `pat` / `oauth_redirect` / `oauth_device`. Use the constants
    /// in [`project_management::sync::connection_token_store`].
    source: String,
}

/// Pre-stash a typed [`ConnectionTokenRecord`] for `connection_id`. Used
/// by the refresh scenarios to seed an expired bearer + refresh token
/// before driving the worker.
pub async fn test_oauth_seed_token(Json(request): Json<SeedTokenRequest>) -> Json<Value> {
    let record = ConnectionTokenRecord {
        access_token: request.access_token,
        refresh_token: request.refresh_token,
        expires_at_unix: request.expires_at_unix,
        source: request.source,
    };
    match connection_token_store::save(&request.connection_id, record) {
        Ok(()) => Json(json!({ "ok": true })),
        Err(err) => err_json(err),
    }
}

/// Forget the stored token for `connection_id`. Idempotent.
/// Wraps [`connection_token_store::clear`]; called by every OAuth
/// scenario in the cleanup tail.
pub async fn test_oauth_clear_token(Json(request): Json<ConnectionAdapterRequest>) -> Json<Value> {
    match connection_token_store::clear(&request.connection_id) {
        Ok(()) => Json(json!({ "ok": true })),
        Err(err) => err_json(err),
    }
}

// ============================================================================
// Helpers
// ============================================================================

/// Same shape the sibling `sync.rs` handlers use: a JSON object with
/// a single `"error"` field. The scenario harness's `post_json` /
/// `get_json` helpers detect `"error"` and propagate it as a
/// `Result::Err`.
fn err_json(message: impl Into<String>) -> Json<Value> {
    Json(json!({ "error": message.into() }))
}
