//! HTTP error parsing for the Anthropic Messages API.
//!
//! Maps `(status, body)` pairs into a typed `ProviderError` so callers
//! (streaming + non-streaming) can branch on overload / rate-limit / auth
//! / context-too-long etc. rather than parsing strings.

use crate::providers::safe_truncate::safe_truncate_utf8;
use crate::providers::traits::ProviderError;

use reqwest::header::HeaderMap;

use super::types::ApiErrorResponse;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct AnthropicErrorClassification {
    pub error_type: String,
    pub message: String,
    pub retry_after_secs: Option<u64>,
    pub mark_temporary_unavailable: bool,
}

pub(super) fn classify_error(
    status: u16,
    body: &str,
    headers: Option<&HeaderMap>,
    retry_after_secs: Option<u64>,
) -> AnthropicErrorClassification {
    let message =
        extract_error_message(body).unwrap_or_else(|| safe_truncate_utf8(body, 500).to_string());
    let lower = message.to_lowercase();
    let parsed_retry_after =
        retry_after_secs.or_else(|| headers.and_then(parse_anthropic_retry_after));

    let error_type = if status == 401 {
        "auth_error"
    } else if status == 403 {
        "forbidden"
    } else if status == 429 && lower.contains("extra usage") {
        "extra_usage_required"
    } else if status == 429 {
        "rate_limit"
    } else if status == 529 {
        "overloaded"
    } else if status >= 500 {
        "server_error"
    } else {
        "request_error"
    };

    AnthropicErrorClassification {
        error_type: error_type.to_string(),
        message,
        retry_after_secs: parsed_retry_after,
        mark_temporary_unavailable: matches!(status, 401 | 403 | 429 | 500..=599)
            && error_type != "extra_usage_required",
    }
}

fn extract_error_message(body: &str) -> Option<String> {
    serde_json::from_str::<ApiErrorResponse>(body)
        .ok()
        .and_then(|err_resp| err_resp.error)
        .and_then(|err| err.message)
        .filter(|message| !message.trim().is_empty())
}

fn parse_anthropic_retry_after(headers: &HeaderMap) -> Option<u64> {
    headers
        .get("anthropic-ratelimit-unified-reset")
        .and_then(|value| value.to_str().ok())
        .and_then(parse_reset_header_secs)
}

fn parse_reset_header_secs(value: &str) -> Option<u64> {
    if let Ok(epoch_secs) = value.parse::<i64>() {
        let now = chrono::Utc::now().timestamp();
        return (epoch_secs > now).then_some((epoch_secs - now) as u64);
    }

    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|date| date.with_timezone(&chrono::Utc))
        .and_then(|date| {
            let seconds = (date - chrono::Utc::now()).num_seconds();
            (seconds > 0).then_some(seconds as u64)
        })
}

/// Parse an Anthropic error response body and map it to `ProviderError`.
///
/// Falls back to `RequestFailed("HTTP {status}: {prefix}")` when the body
/// is not a recognizable Anthropic error envelope.
///
/// Special cases:
/// - "prompt is too long" / "`max_tokens` exceed context limit" → `ContextTooLong`
/// - 401 → `AuthError`
/// - 404 → `ModelNotFound`
/// - 429 → `RateLimited` (with optional `retry_after_secs` from the header)
/// - 529 → `Overloaded` (with optional `retry_after_secs`)
pub(super) fn parse_error(status: u16, body: &str, retry_after_secs: Option<u64>) -> ProviderError {
    let classification = classify_error(status, body, None, retry_after_secs);
    let lower = classification.message.to_lowercase();

    if lower.contains("prompt is too long") || lower.contains("max_tokens` exceed context limit") {
        return ProviderError::ContextTooLong(classification.message);
    }

    match status {
        401 => ProviderError::AuthError(classification.message),
        429 => ProviderError::RateLimited {
            message: classification.message,
            retry_after_secs: classification.retry_after_secs,
        },
        529 => ProviderError::Overloaded {
            message: classification.message,
            retry_after_secs: classification.retry_after_secs,
        },
        404 => ProviderError::ModelNotFound(classification.message),
        _ => ProviderError::RequestFailed(format!("HTTP {}: {}", status, classification.message)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderMap, HeaderValue};

    #[test]
    fn classifies_401_as_temporary_auth_health_event() {
        let body = r#"{"error":{"type":"authentication_error","message":"Invalid authentication credentials"}}"#;
        let classification = classify_error(401, body, None, None);

        assert_eq!(classification.error_type, "auth_error");
        assert!(classification.mark_temporary_unavailable);
        assert_eq!(classification.message, "Invalid authentication credentials");
    }

    #[test]
    fn parses_anthropic_unified_reset_header_for_429() {
        let mut headers = HeaderMap::new();
        let reset = (chrono::Utc::now() + chrono::Duration::seconds(120))
            .timestamp()
            .to_string();
        headers.insert(
            "anthropic-ratelimit-unified-reset",
            HeaderValue::from_str(&reset).unwrap(),
        );
        let body = r#"{"error":{"type":"rate_limit_error","message":"rate limited"}}"#;

        let classification = classify_error(429, body, Some(&headers), None);

        assert_eq!(classification.error_type, "rate_limit");
        assert!(classification.mark_temporary_unavailable);
        assert!(classification
            .retry_after_secs
            .is_some_and(|secs| secs <= 120 && secs > 0));
    }

    #[test]
    fn extra_usage_429_is_not_account_cooldown() {
        let body = r#"{"error":{"type":"rate_limit_error","message":"Extra usage required"}}"#;
        let classification = classify_error(429, body, None, None);

        assert_eq!(classification.error_type, "extra_usage_required");
        assert!(!classification.mark_temporary_unavailable);
    }
}
