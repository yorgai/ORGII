//! Thin REST wrapper around `https://api.github.com`.
//!
//! Owns:
//! - reqwest client construction (30s timeout, `User-Agent`, JSON `Accept`);
//! - bearer-token auth;
//! - HTTP status → [`SyncError`] mapping (401/403 with auth context →
//!   `AuthFailed`, 429 / 403-rate-limit → `RateLimited`, 5xx →
//!   `Transient`, 304 → "no changes" sentinel, other 4xx → `Permanent`);
//! - `If-Modified-Since` request header for conditional pulls.
//!
//! Stays free of adapter logic: the only thing it knows about GitHub
//! is the endpoint URL. Callers feed it `(method, path, body, headers)`
//! and read the JSON response back.

use std::time::Duration;

use reqwest::{Client, Method, StatusCode};
use serde_json::Value;

use crate::sync::types::SyncError;

const GITHUB_API_URL: &str = "https://api.github.com";
const USER_AGENT: &str = concat!("orgii-sync/", env!("CARGO_PKG_VERSION"));
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Used when GitHub indicates rate-limit exhaustion but doesn't ship a
/// `Retry-After` (e.g. `X-RateLimit-Remaining: 0` on a 200 response).
/// 60s is well below GitHub's 1-hour primary window — the worker will
/// re-poll and pick up the next batch.
const DEFAULT_RATE_LIMIT_PAUSE_SECS: u64 = 60;

/// What [`GitHubClient::request`] returns: the parsed body, plus the
/// `Last-Modified` header so callers can persist it as the cursor for
/// the next conditional pull.
#[derive(Debug, Clone)]
pub struct GitHubResponse {
    pub body: Value,
    pub last_modified: Option<String>,
}

/// `304 Not Modified` is a valid pull outcome (the caller's
/// `If-Modified-Since` matched the server's last-modified). We surface
/// it as an `Ok` variant so the adapter can short-circuit instead of
/// classifying it as an error.
#[derive(Debug, Clone)]
pub enum GitHubResult {
    NotModified,
    Ok(GitHubResponse),
}

/// HTTP wrapper around GitHub's REST API.
///
/// Constructed per-request from the worker thread; `reqwest::Client`
/// already wraps `Arc<>` internally so re-creating it per-call is
/// cheap. We deliberately do **not** cache an instance globally — the
/// auth token differs per `sync_connection_id` and a stale per-process
/// cache would leak across attached projects.
pub struct GitHubClient {
    http: Client,
    base_url: String,
}

impl GitHubClient {
    /// Build a client pointed at GitHub's production endpoint. Test
    /// code uses [`Self::with_base_url`] to point at a wiremock server.
    pub fn new() -> Result<Self, SyncError> {
        Self::with_base_url(GITHUB_API_URL)
    }

    pub fn with_base_url(base_url: &str) -> Result<Self, SyncError> {
        #[cfg(test)]
        crate::test_support::install_crypto_provider_for_tests();

        let http = Client::builder()
            .user_agent(USER_AGENT)
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|err| SyncError::Permanent(format!("reqwest builder failed: {}", err)))?;
        Ok(Self {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
        })
    }

    /// Send one REST request and return the parsed body + header
    /// snapshot. On network failure surfaces `Transient`; on
    /// auth/4xx/5xx surfaces the appropriate [`SyncError`].
    ///
    /// `if_modified_since` is forwarded as the corresponding HTTP
    /// header when present. A 304 response surfaces as
    /// [`GitHubResult::NotModified`] so the caller can short-circuit.
    pub async fn request(
        &self,
        token: &str,
        method: Method,
        path: &str,
        body: Option<Value>,
        if_modified_since: Option<&str>,
    ) -> Result<GitHubResult, SyncError> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self
            .http
            .request(method, &url)
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28");
        if let Some(stamp) = if_modified_since {
            req = req.header("If-Modified-Since", stamp);
        }
        if let Some(json_body) = body {
            req = req.json(&json_body);
        }

        let response = req
            .send()
            .await
            .map_err(|err| SyncError::Transient(format!("network error: {}", err)))?;

        let status = response.status();

        if status == StatusCode::NOT_MODIFIED {
            return Ok(GitHubResult::NotModified);
        }

        // 401 is always auth. 403 is *usually* auth but GitHub also
        // uses it for primary rate limiting — distinguish by header.
        if status == StatusCode::UNAUTHORIZED {
            return Err(SyncError::AuthFailed(format!(
                "GitHub rejected token (HTTP {})",
                status.as_u16()
            )));
        }
        if status == StatusCode::FORBIDDEN {
            if let Some(rate_limit) = parse_rate_limit_exhausted(&response) {
                return Err(SyncError::RateLimited {
                    message: "GitHub primary rate limit exhausted".to_string(),
                    retry_after_secs: rate_limit,
                });
            }
            return Err(SyncError::AuthFailed(format!(
                "GitHub rejected token (HTTP {})",
                status.as_u16()
            )));
        }

        if status == StatusCode::TOO_MANY_REQUESTS {
            let retry_after_secs =
                parse_retry_after(&response).unwrap_or(DEFAULT_RATE_LIMIT_PAUSE_SECS);
            return Err(SyncError::RateLimited {
                message: "GitHub secondary rate limit hit".to_string(),
                retry_after_secs,
            });
        }

        if status.is_server_error() {
            return Err(SyncError::Transient(format!(
                "GitHub returned HTTP {}",
                status.as_u16()
            )));
        }

        if !status.is_success() {
            // Preserve a body-read failure so the diagnostic shows
            // "(body read failed: <err>)" instead of an empty preview
            // that conflates "GitHub returned no body" with "we
            // couldn't read GitHub's body".
            let body_text = match response.text().await {
                Ok(t) => t,
                Err(err) => format!("(body read failed: {})", err),
            };
            return Err(SyncError::Permanent(format!(
                "GitHub returned HTTP {}: {}",
                status.as_u16(),
                truncate(&body_text, 500)
            )));
        }

        let last_modified = response
            .headers()
            .get("Last-Modified")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        let body_text = response
            .text()
            .await
            .map_err(|err| SyncError::Transient(format!("GitHub response read error: {}", err)))?;
        let body = if body_text.is_empty() {
            Value::Null
        } else {
            serde_json::from_str(&body_text)
                .map_err(|err| SyncError::Transient(format!("GitHub response not JSON: {}", err)))?
        };

        Ok(GitHubResult::Ok(GitHubResponse {
            body,
            last_modified,
        }))
    }
}

/// GitHub returns 403 with `X-RateLimit-Remaining: 0` to signal
/// primary rate-limit exhaustion. Returns the suggested pause in
/// seconds when those headers are present, `None` otherwise (let the
/// caller treat it as auth failure).
fn parse_rate_limit_exhausted(response: &reqwest::Response) -> Option<u64> {
    let remaining: u64 = response
        .headers()
        .get("X-RateLimit-Remaining")
        .and_then(|value| value.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())?;
    if remaining > 0 {
        return None;
    }
    let reset: u64 = response
        .headers()
        .get("X-RateLimit-Reset")
        .and_then(|value| value.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|dur| dur.as_secs())
        .unwrap_or(0);
    Some(reset.saturating_sub(now).max(1))
}

fn parse_retry_after(response: &reqwest::Response) -> Option<u64> {
    response
        .headers()
        .get("Retry-After")
        .and_then(|value| value.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
}

fn truncate(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
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
    use serde_json::json;
    use wiremock::matchers::{header, header_regex, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn ok_response_returns_body_and_last_modified() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/repos/o/r/issues"))
            .and(header("Authorization", "Bearer tok"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("Last-Modified", "Wed, 29 Apr 2026 02:00:00 GMT")
                    .set_body_json(json!([{ "number": 1 }])),
            )
            .mount(&server)
            .await;

        let client = GitHubClient::with_base_url(&server.uri()).unwrap();
        let result = client
            .request("tok", Method::GET, "/repos/o/r/issues", None, None)
            .await
            .unwrap();
        match result {
            GitHubResult::Ok(resp) => {
                assert_eq!(resp.body, json!([{ "number": 1 }]));
                assert_eq!(
                    resp.last_modified.as_deref(),
                    Some("Wed, 29 Apr 2026 02:00:00 GMT")
                );
            }
            GitHubResult::NotModified => panic!("expected Ok variant"),
        }
    }

    #[tokio::test]
    async fn forwards_if_modified_since_header() {
        let server = MockServer::start().await;
        // Match path + header. We use `header_regex` rather than
        // `header(name, value)` because wiremock 0.6 splits the
        // expected header value on commas (treating it as a
        // multi-value list); HTTP-date values legitimately contain a
        // comma after the day name, which would otherwise never match.
        Mock::given(method("GET"))
            .and(path("/repos/o/r/issues"))
            .and(header_regex(
                "if-modified-since",
                r"^Wed, 29 Apr 2026 02:00:00 GMT$",
            ))
            .respond_with(ResponseTemplate::new(304))
            .mount(&server)
            .await;

        let client = GitHubClient::with_base_url(&server.uri()).unwrap();
        let result = client
            .request(
                "tok",
                Method::GET,
                "/repos/o/r/issues",
                None,
                Some("Wed, 29 Apr 2026 02:00:00 GMT"),
            )
            .await
            .unwrap();
        assert!(matches!(result, GitHubResult::NotModified));
    }

    #[tokio::test]
    async fn classifies_401_as_auth_failed() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;
        let client = GitHubClient::with_base_url(&server.uri()).unwrap();
        let err = client
            .request("bad", Method::GET, "/x", None, None)
            .await
            .unwrap_err();
        assert!(matches!(err, SyncError::AuthFailed(_)), "got {:?}", err);
    }

    /// 403 + `X-RateLimit-Remaining: 0` is GitHub's primary-rate-limit
    /// signal, distinct from auth failure.
    #[tokio::test]
    async fn classifies_403_with_rate_headers_as_rate_limited() {
        let reset_in = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + 30;
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(
                ResponseTemplate::new(403)
                    .insert_header("X-RateLimit-Remaining", "0")
                    .insert_header("X-RateLimit-Reset", &reset_in.to_string()),
            )
            .mount(&server)
            .await;
        let client = GitHubClient::with_base_url(&server.uri()).unwrap();
        let err = client
            .request("tok", Method::GET, "/x", None, None)
            .await
            .unwrap_err();
        match err {
            SyncError::RateLimited {
                retry_after_secs, ..
            } => {
                assert!(
                    retry_after_secs > 0 && retry_after_secs <= 31,
                    "got {}s",
                    retry_after_secs
                );
            }
            other => panic!("expected RateLimited, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn classifies_429_with_retry_after() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "17"))
            .mount(&server)
            .await;
        let client = GitHubClient::with_base_url(&server.uri()).unwrap();
        let err = client
            .request("tok", Method::GET, "/x", None, None)
            .await
            .unwrap_err();
        match err {
            SyncError::RateLimited {
                retry_after_secs, ..
            } => {
                assert_eq!(retry_after_secs, 17);
            }
            other => panic!("expected RateLimited, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn classifies_5xx_as_transient() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;
        let client = GitHubClient::with_base_url(&server.uri()).unwrap();
        let err = client
            .request("tok", Method::GET, "/x", None, None)
            .await
            .unwrap_err();
        assert!(matches!(err, SyncError::Transient(_)), "got {:?}", err);
    }

    #[tokio::test]
    async fn classifies_other_4xx_as_permanent() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(422).set_body_string("validation failed"))
            .mount(&server)
            .await;
        let client = GitHubClient::with_base_url(&server.uri()).unwrap();
        let err = client
            .request("tok", Method::GET, "/x", None, None)
            .await
            .unwrap_err();
        assert!(matches!(err, SyncError::Permanent(_)), "got {:?}", err);
    }
}
