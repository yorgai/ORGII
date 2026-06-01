//! HTTP error parsing for the Anthropic Messages API.
//!
//! Maps `(status, body)` pairs into a typed `ProviderError` so callers
//! (streaming + non-streaming) can branch on overload / rate-limit / auth
//! / context-too-long etc. rather than parsing strings.

use crate::providers::safe_truncate::safe_truncate_utf8;
use crate::providers::traits::ProviderError;

use super::types::ApiErrorResponse;

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
    if let Ok(err_resp) = serde_json::from_str::<ApiErrorResponse>(body) {
        if let Some(err) = err_resp.error {
            let message = err.message.unwrap_or_else(|| "Unknown error".to_string());
            let lower = message.to_lowercase();

            if lower.contains("prompt is too long")
                || lower.contains("max_tokens` exceed context limit")
            {
                return ProviderError::ContextTooLong(message);
            }

            return match status {
                401 => ProviderError::AuthError(message),
                429 => ProviderError::RateLimited {
                    message,
                    retry_after_secs,
                },
                529 => ProviderError::Overloaded {
                    message,
                    retry_after_secs,
                },
                404 => ProviderError::ModelNotFound(message),
                _ => ProviderError::RequestFailed(format!("HTTP {}: {}", status, message)),
            };
        }
    }
    ProviderError::RequestFailed(format!(
        "HTTP {}: {}",
        status,
        safe_truncate_utf8(body, 500)
    ))
}
