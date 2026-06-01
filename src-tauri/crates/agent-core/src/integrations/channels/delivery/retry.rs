//! Per-chunk retry with exponential backoff and a plain-text fallback.
//!
//! Decision tree:
//! 1. First send succeeds → return Ok
//! 2. Timeout → return error (request may already be delivered)
//! 3. Transient network error → exponential backoff retries with jitter; on
//!    final failure send a delivery-failure notice to the user
//! 4. Permanent / formatting error → strip markdown, send a single plain-text
//!    fallback prefixed with `(Response formatting failed, plain text:)`

use std::time::Duration;
use tracing::{error, info, warn};

use super::markdown_strip::strip_markdown;
use super::splitting::{char_slice, custom_unit_to_cp};
use crate::bus::OutboundMessage;
use crate::channels::traits::{Channel, ChannelError};

/// Error substrings that indicate a transient *connection* failure.
///
/// Timeout errors are intentionally excluded: a read/write timeout on a
/// non-idempotent send means the request may have already reached the
/// server — retrying risks duplicate delivery.
const RETRYABLE_PATTERNS: &[&str] = &[
    "connecterror",
    "connectionerror",
    "connectionreset",
    "connectionrefused",
    "connecttimeout",
    "network",
    "broken pipe",
    "remotedisconnected",
    "eoferror",
];

const TIMEOUT_PATTERNS: &[&str] = &["timed out", "readtimeout", "writetimeout"];

fn is_retryable(err: &ChannelError) -> bool {
    let msg = err.to_string().to_lowercase();
    RETRYABLE_PATTERNS.iter().any(|pat| msg.contains(pat))
}

fn is_timeout(err: &ChannelError) -> bool {
    let msg = err.to_string().to_lowercase();
    TIMEOUT_PATTERNS.iter().any(|pat| msg.contains(pat))
}

/// Send a single message chunk with exponential-backoff retry.
///
/// - Transient network errors → up to `max_retries` attempts with exponential
///   backoff and ±1 s jitter.
/// - Timeout errors → returned as-is (request may already be delivered).
/// - Permanent formatting errors → one plain-text fallback attempt.
/// - All retries exhausted → delivery-failure notice sent to the user.
pub async fn send_with_retry(
    channel: &dyn Channel,
    msg: &OutboundMessage,
    max_retries: u32,
    base_delay_secs: f64,
) -> Result<(), ChannelError> {
    match channel.send(msg).await {
        Ok(()) => Ok(()),
        Err(err) => {
            let network = is_retryable(&err);
            let timeout = is_timeout(&err);

            if timeout {
                return Err(err);
            }

            if network {
                let err_str = err.to_string();
                for attempt in 1..=max_retries {
                    let jitter = (attempt as f64 * 0.1).min(1.0);
                    let delay = base_delay_secs * 2f64.powi(attempt as i32 - 1) + jitter;
                    warn!(
                        "[delivery] Send failed (attempt {}/{}, retrying in {:.1}s): {}",
                        attempt, max_retries, delay, err_str
                    );
                    tokio::time::sleep(Duration::from_secs_f64(delay)).await;
                    match channel.send(msg).await {
                        Ok(()) => {
                            info!("[delivery] Send succeeded on retry {}", attempt);
                            return Ok(());
                        }
                        Err(retry_err) => {
                            if !is_retryable(&retry_err) {
                                break;
                            }
                        }
                    }
                }
                error!(
                    "[delivery] Failed to deliver after {} retries: {}",
                    max_retries, err_str
                );
                let notice = OutboundMessage::new(
                    &msg.channel,
                    &msg.chat_id,
                    "⚠️ Message delivery failed after multiple attempts. Please try again.",
                );
                if let Err(notice_err) = channel.send(&notice).await {
                    warn!(
                        channel = %msg.channel,
                        chat_id = %msg.chat_id,
                        error = %notice_err,
                        "[delivery] Failed to send delivery-failure notice; user is unaware of the original retry failure",
                    );
                }
                return Err(ChannelError::SendFailed(err_str));
            }

            // Non-network / formatting error → plain-text fallback.
            let err_str = err.to_string();
            warn!(
                "[delivery] Send failed: {} — trying plain-text fallback",
                err_str
            );
            let plain_content = strip_markdown(&msg.content);
            // Cap at 3500 codepoints to stay below every channel's limit.
            let cp_budget = 3500usize.min(plain_content.chars().count());
            let cp_offset =
                custom_unit_to_cp(&plain_content, cp_budget, |s: &str| s.chars().count());
            let truncated = char_slice(&plain_content, cp_offset);
            let fallback = OutboundMessage {
                content: format!("(Response formatting failed, plain text:)\n\n{}", truncated),
                ..msg.clone()
            };
            channel.send(&fallback).await.map_err(|fallback_err| {
                error!("[delivery] Fallback send also failed: {}", fallback_err);
                ChannelError::SendFailed(format!(
                    "Original: {}; Fallback: {}",
                    err_str, fallback_err
                ))
            })
        }
    }
}
