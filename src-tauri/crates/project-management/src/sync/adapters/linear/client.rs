//! Thin GraphQL wrapper around `https://api.linear.app/graphql`.
//!
//! Owns:
//! - reqwest client construction (30s timeout, user-agent, rustls);
//! - bearer-token auth;
//! - HTTP status → [`SyncError`] mapping (401/403 → `AuthFailed`,
//!   429 → `RateLimited`, 5xx → `Transient`, 4xx → `Permanent`);
//! - GraphQL `errors[]` extraction so a 200 OK with `errors: [...]`
//!   surfaces as the right [`SyncError`] variant.
//!
//! Stays free of adapter logic: the only thing it knows about Linear
//! is the endpoint URL. Callers feed it `(query, variables)` and read
//! the `data` field back.

use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde_json::{json, Value};

use crate::sync::types::SyncError;

const LINEAR_GRAPHQL_URL: &str = "https://api.linear.app/graphql";
const USER_AGENT: &str = concat!("orgii-sync/", env!("CARGO_PKG_VERSION"));
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// We treat 0 remaining requests as a full rate-limit; pause for this
/// many seconds in the absence of a `Retry-After` header.
const DEFAULT_RATE_LIMIT_PAUSE_SECS: u64 = 60;

/// HTTP wrapper around Linear's GraphQL endpoint.
///
/// Constructed per-request from the worker thread; `reqwest::Client`
/// already wraps `Arc<>` internally so re-creating it per-call is
/// cheap. We deliberately do **not** cache an instance globally — the
/// auth token differs per `sync_connection_id` and a stale per-process
/// cache would leak across attached projects.
pub struct LinearClient {
    http: Client,
    endpoint: String,
}

impl LinearClient {
    /// Build a client pointed at Linear's production endpoint. Test
    /// code uses [`Self::with_endpoint`] to point at a `wiremock` server.
    pub fn new() -> Result<Self, SyncError> {
        Self::with_endpoint(LINEAR_GRAPHQL_URL)
    }

    pub fn with_endpoint(endpoint: &str) -> Result<Self, SyncError> {
        #[cfg(test)]
        crate::test_support::install_crypto_provider_for_tests();

        let http = Client::builder()
            .user_agent(USER_AGENT)
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|err| SyncError::Permanent(format!("reqwest builder failed: {}", err)))?;
        Ok(Self {
            http,
            endpoint: endpoint.to_string(),
        })
    }

    /// Send one GraphQL request and return the `data` field on success.
    /// Errors are classified into [`SyncError`] variants so the worker
    /// picks the right backoff path.
    pub async fn graphql(
        &self,
        token: &str,
        query: &str,
        variables: Value,
    ) -> Result<Value, SyncError> {
        let body = json!({ "query": query, "variables": variables });
        let response = self
            .http
            .post(&self.endpoint)
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|err| SyncError::Transient(format!("network error: {}", err)))?;

        let status = response.status();

        if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
            return Err(SyncError::AuthFailed(format!(
                "Linear rejected token (HTTP {})",
                status.as_u16()
            )));
        }

        if status == StatusCode::TOO_MANY_REQUESTS {
            let retry_after_secs =
                parse_retry_after(&response).unwrap_or(DEFAULT_RATE_LIMIT_PAUSE_SECS);
            return Err(SyncError::RateLimited {
                message: "Linear rate-limited the request".to_string(),
                retry_after_secs,
            });
        }

        if status.is_server_error() {
            return Err(SyncError::Transient(format!(
                "Linear returned HTTP {}",
                status.as_u16()
            )));
        }

        if !status.is_success() {
            // Read the body for context; on read failure we still surface a
            // permanent error so the worker doesn't loop forever, but we
            // preserve the read failure as the body so the operator sees
            // "(body read failed: <err>)" instead of an empty diagnostic
            // that hides whether the API returned no body or we couldn't
            // read it.
            let body_text = match response.text().await {
                Ok(t) => t,
                Err(err) => format!("(body read failed: {})", err),
            };
            return Err(SyncError::Permanent(format!(
                "Linear returned HTTP {}: {}",
                status.as_u16(),
                truncate(&body_text, 500)
            )));
        }

        // X-RateLimit-Requests-Remaining can read 0 even on a 200; that's
        // a "you're done for the window" signal. Treat the *next* attempt
        // as rate-limited so we sleep instead of pummeling the API.
        if let Some(remaining) = parse_remaining_header(&response) {
            if remaining == 0 {
                let retry_after_secs =
                    parse_retry_after(&response).unwrap_or(DEFAULT_RATE_LIMIT_PAUSE_SECS);
                let payload: Value = response.json().await.map_err(|err| {
                    SyncError::Transient(format!("Linear response not JSON: {}", err))
                })?;
                if let Some(data) = extract_data(&payload)? {
                    // We still got a usable response; surface it but log the
                    // exhaustion so the next call backs off.
                    log::warn!(
                        "[sync::linear] rate-limit window exhausted (next call sleeps ~{}s)",
                        retry_after_secs
                    );
                    return Ok(data);
                }
                return Err(SyncError::RateLimited {
                    message: "Linear rate-limit window exhausted".to_string(),
                    retry_after_secs,
                });
            }
        }

        let payload: Value = response
            .json()
            .await
            .map_err(|err| SyncError::Transient(format!("Linear response not JSON: {}", err)))?;

        extract_data(&payload)?
            .ok_or_else(|| SyncError::Permanent("Linear response missing 'data'".to_string()))
    }
}

/// Extract `data` from a GraphQL response, mapping `errors[]` onto
/// [`SyncError`] variants. Returns `Ok(None)` only when both `data`
/// and `errors` are absent — the caller treats that as a permanent
/// schema mismatch.
fn extract_data(payload: &Value) -> Result<Option<Value>, SyncError> {
    if let Some(errors) = payload.get("errors").and_then(Value::as_array) {
        if !errors.is_empty() {
            let message = errors
                .iter()
                .filter_map(|err| err.get("message").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("; ");
            // GraphQL-level auth errors (token revoked, permission
            // denied) come back inside `errors[].extensions.code` —
            // treat the codes Linear uses for those as auth failures
            // so the worker abandons promptly.
            let auth_kind = errors.iter().any(|err| {
                err.pointer("/extensions/code")
                    .and_then(Value::as_str)
                    .map(|code| matches!(code, "AUTHENTICATION_ERROR" | "FORBIDDEN"))
                    .unwrap_or(false)
            });
            return Err(if auth_kind {
                SyncError::AuthFailed(message)
            } else {
                SyncError::Permanent(message)
            });
        }
    }
    Ok(payload.get("data").cloned())
}

fn parse_retry_after(response: &reqwest::Response) -> Option<u64> {
    response
        .headers()
        .get("Retry-After")
        .and_then(|value| value.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
}

fn parse_remaining_header(response: &reqwest::Response) -> Option<u64> {
    response
        .headers()
        .get("X-RateLimit-Requests-Remaining")
        .and_then(|value| value.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
}

fn truncate(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    // Slice on a char boundary so multi-byte text doesn't panic.
    let cut = text
        .char_indices()
        .nth(max)
        .map(|(i, _)| i)
        .unwrap_or(text.len());
    format!("{}…", &text[..cut])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_data_returns_data_when_no_errors() {
        let payload = json!({ "data": { "issues": [] } });
        let data = extract_data(&payload).unwrap().unwrap();
        assert_eq!(data["issues"], json!([]));
    }

    #[test]
    fn extract_data_classifies_auth_errors() {
        let payload = json!({
            "errors": [{
                "message": "Token revoked",
                "extensions": { "code": "AUTHENTICATION_ERROR" }
            }]
        });
        let err = extract_data(&payload).unwrap_err();
        assert!(matches!(err, SyncError::AuthFailed(_)), "got {:?}", err);
    }

    #[test]
    fn extract_data_classifies_other_errors_as_permanent() {
        let payload = json!({
            "errors": [{ "message": "invalid argument" }]
        });
        let err = extract_data(&payload).unwrap_err();
        assert!(matches!(err, SyncError::Permanent(_)), "got {:?}", err);
    }

    #[test]
    fn extract_data_empty_errors_is_treated_as_no_errors() {
        let payload = json!({ "errors": [], "data": { "x": 1 } });
        let data = extract_data(&payload).unwrap().unwrap();
        assert_eq!(data["x"], 1);
    }
}
