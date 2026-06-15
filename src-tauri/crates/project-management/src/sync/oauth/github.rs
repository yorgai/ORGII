//! GitHub OAuth Device Authorization Grant.
//!
//! Two endpoints from <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow>:
//! - `POST https://github.com/login/device/code` — exchange `client_id`
//!   for a `(device_code, user_code, verification_uri, interval, expires_in)`
//!   bundle.
//! - `POST https://github.com/login/oauth/access_token` — poll with the
//!   `device_code` until the user approves or a terminal RFC 8628 error
//!   is returned (`access_denied`, `expired_token`).
//!
//! Endpoints accept JSON when the request includes `Accept:
//! application/json`; we stick to JSON to avoid GitHub's URL-encoded
//! response default which spec-deviates from RFC 8628.
//!
//! ## Cancellation
//!
//! [`poll_for_token`] takes a `tokio_util::sync::CancellationToken` so
//! the Tauri `oauth_cancel` command can abort in-flight polling without
//! waiting for the next sleep tick. Cancellation always returns
//! [`super::PollOutcome::Cancelled`] — never logs a spurious error.

use std::time::Duration;

#[cfg(debug_assertions)]
use std::sync::{LazyLock, RwLock};

use chrono::{TimeZone, Utc};
use reqwest::Client;
use serde::Deserialize;
use serde_json::Value;
use tokio::select;
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;

use super::super::connection_token_store::{ConnectionTokenRecord, SOURCE_OAUTH_DEVICE};
use super::{DeviceFlowDescriptor, PollOutcome};

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const DEVICE_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const USER_AGENT: &str = concat!("orgii-sync-oauth/", env!("CARGO_PKG_VERSION"));
/// Public GitHub OAuth App client id for ORGII's device-flow client.
/// Device-flow apps have no client secret, so this id is safe to ship
/// in an open-source desktop binary. `ORGII_GITHUB_OAUTH_CLIENT_ID`
/// remains available for development builds that point at a different
/// GitHub OAuth App (e.g. staging / a fork).
const DEFAULT_CLIENT_ID: &str = "Ov23liGsB3lDighTSmmO";
/// Space-separated OAuth scopes requested on `/login/device/code`.
/// Sized to cover not just Issues but the wider set of Git surfaces that
/// can reuse this token once we unify GitHub auth (PR view, repo
/// contents, private `git clone`/`push` via the token as HTTPS
/// password). Keep additions intentional: each extra scope widens the
/// consent screen and the blast radius if the token leaks.
///
/// - `repo` — full control of private repos: issues, PRs, contents,
///   HTTPS clone/push.
/// - `workflow` — read/modify `.github/workflows/*` (orthogonal to
///   `repo`; required when an agent edits workflow files).
/// - `read:user` — fetch the authenticated user's login/avatar so the
///   connection card can show "Signed in as @octocat" instead of an opaque
///   token.
const SCOPES: &str = "repo workflow read:user";
/// Default poll interval if the device-code response somehow omits one;
/// GitHub always returns an interval, but the spec allows it to be
/// missing so we pick a conservative default.
const DEFAULT_POLL_INTERVAL_SECS: u64 = 5;

/// What GitHub returns from `/login/device/code`.
#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    interval: Option<u64>,
    expires_in: i64,
}

/// GitHub OAuth client id. The public [`DEFAULT_CLIENT_ID`] identifies
/// ORGII's device-flow OAuth App and is safe to ship in an open-source
/// desktop binary (device-flow apps have no client secret).
/// `ORGII_GITHUB_OAUTH_CLIENT_ID` remains available for development
/// builds that need to point at a different GitHub OAuth App.
pub fn configured_client_id() -> Option<&'static str> {
    match option_env!("ORGII_GITHUB_OAUTH_CLIENT_ID") {
        Some(raw) if !raw.is_empty() => Some(raw),
        _ => Some(DEFAULT_CLIENT_ID),
    }
}

/// Process-local override for [`configured_client_id`], only present
/// in debug builds. Symmetric with `linear::TEST_CLIENT_ID` so e2e
/// scenarios that exercise the device flow can run without the
/// production `ORGII_GITHUB_OAUTH_CLIENT_ID` build env being set.
/// Falls back to [`configured_client_id`] on `None`.
#[cfg(debug_assertions)]
static TEST_CLIENT_ID: LazyLock<RwLock<Option<String>>> = LazyLock::new(|| RwLock::new(None));

/// Install (or clear) the test override for the GitHub OAuth client
/// id. Debug-only — release builds compile this out entirely. Pass
/// `Some(id)` to redirect [`start_device_flow`] /
/// [`effective_client_id`] at the synthetic id; pass `None` to fall
/// back to the env-var value. Symmetric with
/// [`super::linear::set_test_client_id`].
#[cfg(debug_assertions)]
pub fn set_test_client_id(client_id: Option<String>) {
    if let Ok(mut guard) = TEST_CLIENT_ID.write() {
        *guard = client_id;
    }
}

/// Resolve the client id to send on device-flow requests. In release
/// builds this is just [`configured_client_id`]; in debug builds the
/// [`TEST_CLIENT_ID`] override wins so e2e scenarios can run without
/// the production env var set. Symmetric with
/// [`super::linear::effective_client_id`].
pub fn effective_client_id() -> Option<String> {
    #[cfg(debug_assertions)]
    {
        if let Ok(guard) = TEST_CLIENT_ID.read() {
            if let Some(value) = guard.as_ref() {
                return Some(value.clone());
            }
        }
    }
    configured_client_id().map(|raw| raw.to_string())
}

fn http_client() -> Result<Client, String> {
    #[cfg(test)]
    crate::test_support::install_crypto_provider_for_tests();

    Client::builder()
        .user_agent(USER_AGENT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|err| format!("reqwest build failed: {}", err))
}

/// Exchange `client_id` for a fresh device-code bundle. Tests inject
/// alternative endpoints via [`start_device_flow_with_endpoints`]; the
/// public helper hits production URLs.
pub async fn start_device_flow(client_id: &str) -> Result<DeviceFlowDescriptor, String> {
    start_device_flow_with_endpoints(client_id, DEVICE_CODE_URL).await
}

pub async fn start_device_flow_with_endpoints(
    client_id: &str,
    device_code_url: &str,
) -> Result<DeviceFlowDescriptor, String> {
    if client_id.is_empty() {
        return Err("GitHub OAuth client id is empty".to_string());
    }
    let client = http_client()?;
    let response = client
        .post(device_code_url)
        .header("Accept", "application/json")
        .form(&[("client_id", client_id), ("scope", SCOPES)])
        .send()
        .await
        .map_err(|err| format!("device-code request failed: {}", err))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| format!("device-code body read failed: {}", err))?;
    if !status.is_success() {
        return Err(format!(
            "device-code endpoint returned {}: {}",
            status, body
        ));
    }
    let parsed: DeviceCodeResponse = serde_json::from_str(&body)
        .map_err(|err| format!("device-code json parse failed: {}: {}", err, body))?;

    let interval_secs = parsed.interval.unwrap_or(DEFAULT_POLL_INTERVAL_SECS);
    let now = Utc::now();
    let expires_at = Utc
        .timestamp_opt(now.timestamp().saturating_add(parsed.expires_in), 0)
        .single()
        .ok_or_else(|| "device-code expires_in produced an invalid timestamp".to_string())?;

    Ok(DeviceFlowDescriptor {
        device_code: parsed.device_code,
        user_code: parsed.user_code,
        verification_uri: parsed.verification_uri,
        interval_secs,
        expires_at,
    })
}

/// Poll the access-token endpoint until the user approves the grant,
/// the device code expires, the user denies access, or the caller
/// cancels via the provided [`CancellationToken`]. The first sleep
/// happens **before** the first request (per RFC 8628 §3.5) so the
/// user has time to approve.
pub async fn poll_for_token(
    client_id: &str,
    device_code: &str,
    interval_secs: u64,
    cancel: CancellationToken,
) -> PollOutcome {
    poll_for_token_with_endpoints(
        client_id,
        device_code,
        interval_secs,
        cancel,
        ACCESS_TOKEN_URL,
    )
    .await
}

/// Behaviour identical to [`poll_for_token`], but configurable URL for
/// the wiremock-backed unit tests.
pub async fn poll_for_token_with_endpoints(
    client_id: &str,
    device_code: &str,
    interval_secs: u64,
    cancel: CancellationToken,
    access_token_url: &str,
) -> PollOutcome {
    let client = match http_client() {
        Ok(c) => c,
        Err(err) => return PollOutcome::PollFailed(err),
    };
    let mut delay = Duration::from_secs(interval_secs.max(1));

    loop {
        if cancel.is_cancelled() {
            return PollOutcome::Cancelled;
        }
        select! {
            _ = cancel.cancelled() => return PollOutcome::Cancelled,
            _ = sleep(delay) => {}
        }

        let response = match client
            .post(access_token_url)
            .header("Accept", "application/json")
            .form(&[
                ("client_id", client_id),
                ("device_code", device_code),
                ("grant_type", DEVICE_GRANT_TYPE),
            ])
            .send()
            .await
        {
            Ok(r) => r,
            Err(err) => return PollOutcome::PollFailed(format!("token request failed: {}", err)),
        };

        let body_text = match response.text().await {
            Ok(t) => t,
            Err(err) => return PollOutcome::PollFailed(format!("token body read failed: {}", err)),
        };

        let body: Value = match serde_json::from_str(&body_text) {
            Ok(v) => v,
            Err(err) => {
                return PollOutcome::PollFailed(format!(
                    "token json parse failed: {}: {}",
                    err, body_text
                ))
            }
        };

        if let Some(token) = body.get("access_token").and_then(Value::as_str) {
            // GitHub OAuth-device tokens have no expiry and no
            // refresh roundtrip; persist them as a non-expiring
            // record so `ensure_fresh_connection_token` shortcircuits cleanly.
            return PollOutcome::Token(ConnectionTokenRecord {
                access_token: token.to_string(),
                refresh_token: None,
                expires_at_unix: None,
                source: SOURCE_OAUTH_DEVICE.to_string(),
            });
        }

        let error_code = body.get("error").and_then(Value::as_str).unwrap_or("");
        match error_code {
            "authorization_pending" => continue,
            "slow_down" => {
                // RFC 8628 §3.5 — increase polling interval by 5s on
                // every `slow_down` and continue polling.
                delay = delay.checked_add(Duration::from_secs(5)).unwrap_or(delay);
                continue;
            }
            "access_denied" => return PollOutcome::AccessDenied,
            "expired_token" => return PollOutcome::Expired,
            other => {
                return PollOutcome::PollFailed(format!(
                    "unexpected token response: error='{}' body={}",
                    other, body_text
                ));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

    fn json_body(value: serde_json::Value) -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_json(value)
    }

    #[tokio::test]
    async fn start_device_flow_parses_response() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/device/code"))
            .respond_with(json_body(serde_json::json!({
                "device_code": "DEVCODE",
                "user_code": "WDJB-MJHT",
                "verification_uri": "https://example.test/device",
                "interval": 7,
                "expires_in": 900,
            })))
            .mount(&server)
            .await;

        let descriptor =
            start_device_flow_with_endpoints("client", &format!("{}/device/code", server.uri()))
                .await
                .expect("start succeeds");

        assert_eq!(descriptor.device_code, "DEVCODE");
        assert_eq!(descriptor.user_code, "WDJB-MJHT");
        assert_eq!(descriptor.verification_uri, "https://example.test/device");
        assert_eq!(descriptor.interval_secs, 7);
        let now = Utc::now().timestamp();
        let expires = descriptor.expires_at.timestamp();
        assert!(expires - now > 800 && expires - now <= 900);
    }

    #[tokio::test]
    async fn start_device_flow_rejects_empty_client_id() {
        let err = start_device_flow_with_endpoints("", "http://unused.test")
            .await
            .unwrap_err();
        assert!(err.to_lowercase().contains("client id"));
    }

    #[tokio::test]
    async fn start_device_flow_propagates_http_error() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/device/code"))
            .respond_with(ResponseTemplate::new(403).set_body_string("forbidden"))
            .mount(&server)
            .await;

        let err =
            start_device_flow_with_endpoints("client", &format!("{}/device/code", server.uri()))
                .await
                .unwrap_err();
        assert!(err.contains("403"), "got {}", err);
    }

    /// Sequence: first call → `authorization_pending`, second call →
    /// `access_token`. The polling loop should ignore the first response
    /// and return the token on the second.
    #[tokio::test]
    async fn poll_returns_token_after_pending_then_success() {
        struct Sequence {
            counter: Arc<AtomicUsize>,
        }
        impl Respond for Sequence {
            fn respond(&self, _: &Request) -> ResponseTemplate {
                let n = self.counter.fetch_add(1, Ordering::SeqCst);
                if n == 0 {
                    json_body(serde_json::json!({ "error": "authorization_pending" }))
                } else {
                    json_body(serde_json::json!({
                        "access_token": "ghu_secret",
                        "token_type": "bearer",
                    }))
                }
            }
        }

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/access_token"))
            .respond_with(Sequence {
                counter: Arc::new(AtomicUsize::new(0)),
            })
            .mount(&server)
            .await;

        let outcome = poll_for_token_with_endpoints(
            "client",
            "DEVCODE",
            1,
            CancellationToken::new(),
            &format!("{}/access_token", server.uri()),
        )
        .await;
        match outcome {
            PollOutcome::Token(record) => {
                assert_eq!(record.access_token, "ghu_secret");
                assert_eq!(record.source, SOURCE_OAUTH_DEVICE);
                assert!(record.refresh_token.is_none());
                assert!(record.expires_at_unix.is_none());
            }
            other => panic!("expected Token, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn poll_handles_slow_down_and_then_token() {
        struct Sequence {
            counter: Arc<AtomicUsize>,
        }
        impl Respond for Sequence {
            fn respond(&self, _: &Request) -> ResponseTemplate {
                let n = self.counter.fetch_add(1, Ordering::SeqCst);
                if n == 0 {
                    json_body(serde_json::json!({ "error": "slow_down" }))
                } else {
                    json_body(serde_json::json!({ "access_token": "ghu_after_slow" }))
                }
            }
        }
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/access_token"))
            .respond_with(Sequence {
                counter: Arc::new(AtomicUsize::new(0)),
            })
            .mount(&server)
            .await;

        let outcome = poll_for_token_with_endpoints(
            "client",
            "DEVCODE",
            1,
            CancellationToken::new(),
            &format!("{}/access_token", server.uri()),
        )
        .await;
        match outcome {
            PollOutcome::Token(record) => {
                assert_eq!(record.access_token, "ghu_after_slow");
                assert_eq!(record.source, SOURCE_OAUTH_DEVICE);
            }
            other => panic!("expected Token, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn poll_returns_access_denied() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/access_token"))
            .respond_with(json_body(serde_json::json!({ "error": "access_denied" })))
            .mount(&server)
            .await;

        let outcome = poll_for_token_with_endpoints(
            "client",
            "DEVCODE",
            1,
            CancellationToken::new(),
            &format!("{}/access_token", server.uri()),
        )
        .await;
        assert!(
            matches!(outcome, PollOutcome::AccessDenied),
            "got {:?}",
            outcome
        );
    }

    #[tokio::test]
    async fn poll_returns_expired() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/access_token"))
            .respond_with(json_body(serde_json::json!({ "error": "expired_token" })))
            .mount(&server)
            .await;

        let outcome = poll_for_token_with_endpoints(
            "client",
            "DEVCODE",
            1,
            CancellationToken::new(),
            &format!("{}/access_token", server.uri()),
        )
        .await;
        assert!(matches!(outcome, PollOutcome::Expired), "got {:?}", outcome);
    }

    #[tokio::test]
    async fn poll_returns_cancelled_when_token_signalled() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/access_token"))
            .respond_with(json_body(
                serde_json::json!({ "error": "authorization_pending" }),
            ))
            .mount(&server)
            .await;

        let cancel = CancellationToken::new();
        let cancel_clone = cancel.clone();
        // Signal cancel quickly, while the loop is in its first sleep.
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            cancel_clone.cancel();
        });

        let outcome = poll_for_token_with_endpoints(
            "client",
            "DEVCODE",
            10,
            cancel,
            &format!("{}/access_token", server.uri()),
        )
        .await;
        assert!(
            matches!(outcome, PollOutcome::Cancelled),
            "got {:?}",
            outcome
        );
    }
}
