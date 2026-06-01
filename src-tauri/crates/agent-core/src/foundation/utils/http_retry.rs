//! Shared HTTP retry helper for external registry APIs (ClawHub, MCP Registry,
//! Glama, Smithery, MCP.Bar, npm).
//!
//! Retries on HTTP 429 (Too Many Requests) with exponential backoff, respecting
//! the `Retry-After` header when present.

use reqwest::{Client, RequestBuilder, Response};

const MAX_RETRIES: u32 = 3;
const INITIAL_BACKOFF_MS: u64 = 1000;

/// Extract the `Retry-After` header value (in seconds) from an HTTP response.
///
/// Returns `None` if the header is absent or not a valid integer.
pub fn extract_retry_after_secs(response: &Response) -> Option<u64> {
    response
        .headers()
        .get("retry-after")
        .and_then(|val| val.to_str().ok())
        .and_then(|str_val| str_val.parse::<u64>().ok())
}

/// Send an HTTP request with automatic retry on 429 (Too Many Requests).
///
/// `build_request` is called on each attempt since `RequestBuilder` is consumed by `.send()`.
/// Respects the `Retry-After` header (seconds) with a fallback to exponential backoff.
pub async fn send_with_retry(
    client: &Client,
    build_request: impl Fn(&Client) -> RequestBuilder,
    context: &str,
) -> Result<Response, String> {
    for attempt in 0..=MAX_RETRIES {
        let response = build_request(client)
            .send()
            .await
            .map_err(|err| format!("{context} request failed: {err}"))?;

        if response.status() != reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Ok(response);
        }

        if attempt == MAX_RETRIES {
            return Err(format!(
                "{context} rate-limited after {MAX_RETRIES} retries"
            ));
        }

        let retry_after_ms = extract_retry_after_secs(&response)
            .map(|secs| secs * 1000)
            .unwrap_or(INITIAL_BACKOFF_MS * 2u64.pow(attempt));

        tokio::time::sleep(std::time::Duration::from_millis(retry_after_ms)).await;
    }

    unreachable!()
}
