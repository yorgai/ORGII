//! Stream-error retry handling for `execute_turn`.
//!
//! Stream errors happen when the upstream provider drops the connection
//! mid-response (per-chunk read timeout, transport-level socket drop,
//! provider 5xx error frame, HTTP 529 overload, etc.). The transport
//! layer surfaces this as `finish_reason = stream_error` with a subtype
//! in `stream_error_kind`, and we retry the whole iteration with an
//! exponential backoff.
//!
//! Two independent budgets:
//!   - `Overloaded` (HTTP 529 / `overloaded_error`): short budget of
//!     `MAX_OVERLOADED_RETRIES = 3`. Capacity cascades recover slowly
//!     and hammering makes them worse.
//!   - Everything else: `MAX_STREAM_ERROR_RETRIES = 10`. Network flaps
//!     and transient 5xx usually recover within a few retries.
//!
//! Broadcast rule (intermediate attempts): NOTHING about the retry is
//! visible as a chat bubble. Handlers get a low-key `on_stream_retry`
//! callback for footer/status indicators only.
//!
//! Broadcast rule (final failure): the handler gets both a
//! `on_stream_error_exhausted` callback (for the error footer) AND we
//! persist a clean user-visible assistant message so the turn history
//! reflects what the user saw.
//!
//! LLM message-history hygiene: we only add synthetic assistant +
//! tool_result rows when tool calls were emitted before the failure,
//! so the next API call stays OpenAI-compliant (assistant with
//! `tool_calls` must be followed by matching `tool` rows). Partial text
//! without tool_calls is discarded — the retry regenerates it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::Value;
use tracing::{info, warn};

use crate::providers::traits::{LLMResponse, StreamErrorKind};

use super::backoff::{
    stream_backoff_ms, BACKOFF_HEARTBEAT_INTERVAL_MS, MAX_OVERLOADED_RETRIES,
    MAX_STREAM_ERROR_RETRIES,
};
use super::helpers::{add_assistant_message, add_tool_result};
use super::TurnEventHandler;

/// Sanity ceiling for `Retry-After` floors so a malicious / misconfigured
/// provider can't pin us on an hour-long wait.
const RETRY_AFTER_SANITY_CEILING_MS: u64 = 10 * 60 * 1000; // 10 minutes

/// Decision returned by [`handle_stream_error`] to the main loop.
pub(super) enum StreamErrorOutcome {
    /// Retry budget exhausted. Caller should set `final_content` to
    /// `Some(user_msg)`, mark `is_stream_error = true`, and break.
    BudgetExhausted { user_message: String },
    /// Cancellation arrived during the backoff sleep. Caller should set
    /// `final_content = None` and break.
    CancelledDuringBackoff,
    /// Backoff completed; caller should `continue` the loop to retry.
    Retry,
}

/// Retry budgets for the two stream-error categories. Both reset every
/// time a non-error iteration succeeds.
#[derive(Default)]
pub(super) struct RetryBudgets {
    /// Generic errors (connection drop, idle timeout, provider 5xx).
    /// Up to `MAX_STREAM_ERROR_RETRIES = 10`.
    pub stream_error: u32,
    /// Explicit upstream capacity exhaustion (`StreamErrorKind::Overloaded`).
    /// Up to `MAX_OVERLOADED_RETRIES = 3` — much shorter leash because
    /// hammering an overloaded provider wastes cache and aggravates the
    /// cascade.
    pub overloaded: u32,
}

impl RetryBudgets {
    /// Reset both budgets after a successful iteration. Logs at info level
    /// when at least one had been incremented.
    pub fn reset_after_success(&mut self, session_id: &str) {
        if self.stream_error > 0 || self.overloaded > 0 {
            info!(
                "[agent-core] Stream recovered after {} connection retry(s) and {} overload retry(s) (session={})",
                self.stream_error, self.overloaded, session_id
            );
            self.stream_error = 0;
            self.overloaded = 0;
        }
    }
}

/// Drive one round of stream-error recovery: classify the kind, increment
/// the right budget, optionally bail, push synthetic tool_result rows for
/// any in-flight tool_calls, append the system continuation prompt, and
/// sleep with heartbeat ticks honoring the cancel flag.
#[allow(clippy::too_many_arguments)]
pub(super) async fn handle_stream_error(
    response: &LLMResponse,
    budgets: &mut RetryBudgets,
    messages: &mut Vec<Value>,
    cancel_flag: Option<&Arc<AtomicBool>>,
    session_id: &str,
    handler: &dyn TurnEventHandler,
) -> StreamErrorOutcome {
    let kind = response
        .stream_error_kind
        .unwrap_or(StreamErrorKind::Unknown);

    let is_overloaded = matches!(kind, StreamErrorKind::Overloaded);
    let (attempt, max_attempts) = if is_overloaded {
        budgets.overloaded += 1;
        (budgets.overloaded, MAX_OVERLOADED_RETRIES)
    } else {
        budgets.stream_error += 1;
        (budgets.stream_error, MAX_STREAM_ERROR_RETRIES)
    };

    if attempt > max_attempts {
        warn!(
            "[agent-core] Stream error retry budget exhausted (session={}, kind={}, attempts={}/{})",
            session_id,
            kind.as_str(),
            attempt - 1,
            max_attempts
        );
        let user_msg = if is_overloaded {
            format!(
                "The model provider is overloaded (upstream {}). \
                 I tried {} times over several seconds and couldn't get a response. \
                 This usually clears within a minute — please retry shortly.",
                kind.as_str(),
                attempt - 1
            )
        } else {
            format!(
                "The connection to the model provider kept failing ({}). \
                 I tried {} times with exponential backoff and couldn't recover. \
                 Please check your network or retry in a moment.",
                kind.as_str(),
                attempt - 1
            )
        };
        handler.on_stream_error_exhausted(session_id, kind.as_str(), attempt - 1, &user_msg);
        return StreamErrorOutcome::BudgetExhausted {
            user_message: user_msg,
        };
    }

    // Backoff policy:
    //   1. Compute our default exponential backoff (per-kind multiplier,
    //      jitter, clamped to `STREAM_BACKOFF_MAX_MS`).
    //   2. If the provider supplied a `retry_after_ms` floor (parsed from
    //      the SSE error frame — see `parse_retry_after_ms` in
    //      `openai_compat/streaming.rs`), honor it as a lower bound:
    //      `max(provider_floor, exponential_default)`.
    //   3. Still clamp to a sanity ceiling.
    let computed_backoff = stream_backoff_ms(attempt, kind);
    let backoff_ms = if let Some(provider_floor) = response.retry_after_ms {
        let clamped_floor = provider_floor.min(RETRY_AFTER_SANITY_CEILING_MS);
        if clamped_floor > computed_backoff {
            info!(
                "[agent-core] Honoring provider retry_after floor: {}ms (exponential default was {}ms, session={}, kind={})",
                clamped_floor, computed_backoff, session_id, kind.as_str()
            );
            clamped_floor
        } else {
            computed_backoff
        }
    } else {
        computed_backoff
    };
    warn!(
        "[agent-core] Stream interrupted mid-response (session={}, kind={}, attempt={}/{}, backoff={}ms, provider_floor={:?}, partial_tool_calls={})",
        session_id,
        kind.as_str(),
        attempt,
        max_attempts,
        backoff_ms,
        response.retry_after_ms,
        response.tool_calls.len()
    );
    handler.on_stream_retry(session_id, kind.as_str(), attempt, max_attempts, backoff_ms);

    if !response.tool_calls.is_empty() {
        let tool_call_values: Vec<Value> = response
            .tool_calls
            .iter()
            .map(|tc| {
                serde_json::json!({
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.name,
                        "arguments": tc.arguments.to_string(),
                    }
                })
            })
            .collect();

        add_assistant_message(
            messages,
            response.content.as_deref(),
            Some(&tool_call_values),
            response.reasoning_content.as_deref(),
        );

        let stream_error_msg =
            "[Error: Stream interrupted before tool execution completed. Please retry.]";
        for tc in &response.tool_calls {
            add_tool_result(messages, &tc.id, &tc.name, stream_error_msg, true);
        }
    }
    // Partial text without tool_calls: discard entirely. The retry will
    // regenerate from scratch, and persisting half a sentence would
    // pollute session history.

    messages.push(serde_json::json!({
        "role": "user",
        "content": "[System: your previous response was cut off by a network error. Please retry your response from the beginning.]"
    }));

    if backoff_ms > 0 {
        if let Some(outcome) = chunked_backoff_with_heartbeat(
            backoff_ms,
            cancel_flag,
            session_id,
            kind.as_str(),
            attempt,
            max_attempts,
            handler,
        )
        .await
        {
            return outcome;
        }
    }

    StreamErrorOutcome::Retry
}

/// Slice the sleep into heartbeat-sized chunks and re-emit `on_stream_retry`
/// every chunk so the frontend footer can animate a live countdown.
///
/// Cancellation is honored inside each chunk, so a stop-button press exits
/// within 50 ms regardless of how much of the backoff remains.
///
/// Returns `Some(StreamErrorOutcome::CancelledDuringBackoff)` if the cancel
/// flag fired mid-sleep, or `None` if the backoff completed naturally.
#[allow(clippy::too_many_arguments)]
async fn chunked_backoff_with_heartbeat(
    backoff_ms: u64,
    cancel_flag: Option<&Arc<AtomicBool>>,
    session_id: &str,
    kind: &str,
    attempt: u32,
    max_attempts: u32,
    handler: &dyn TurnEventHandler,
) -> Option<StreamErrorOutcome> {
    let mut remaining = backoff_ms;
    let sleep_start = std::time::Instant::now();
    let mut cancelled = false;
    while remaining > 0 {
        let chunk = remaining.min(BACKOFF_HEARTBEAT_INTERVAL_MS);
        let sleep_fut = tokio::time::sleep(std::time::Duration::from_millis(chunk));
        match cancel_flag {
            Some(flag) => {
                let flag_for_watch: Arc<AtomicBool> = Arc::clone(flag);
                tokio::select! {
                    _ = sleep_fut => {}
                    _ = async move {
                        loop {
                            if flag_for_watch.load(Ordering::Relaxed) { break; }
                            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                        }
                    } => {}
                }
                if flag.load(Ordering::Relaxed) {
                    info!(
                        "[agent-core] Cancelled during stream-error backoff (session={})",
                        session_id
                    );
                    cancelled = true;
                    break;
                }
            }
            None => sleep_fut.await,
        }
        remaining = remaining.saturating_sub(chunk);

        // Heartbeat tick: re-emit the retry event with an updated
        // `backoffMs` so the frontend countdown stays live. Only when
        // there's still meaningful time left — the last chunk drops us
        // out of the loop naturally without a tick.
        if remaining >= BACKOFF_HEARTBEAT_INTERVAL_MS / 2 {
            handler.on_stream_retry(session_id, kind, attempt, max_attempts, remaining);
        }
    }
    if cancelled {
        return Some(StreamErrorOutcome::CancelledDuringBackoff);
    }
    // Natural drift tracking — if a long backoff took noticeably longer
    // than requested (runtime scheduler delays), log it so we can spot
    // stuck tasks.
    let elapsed = sleep_start.elapsed().as_millis() as u64;
    if elapsed > backoff_ms.saturating_add(1000) {
        warn!(
            "[agent-core] Backoff sleep ran long: requested={}ms, actual={}ms (session={})",
            backoff_ms, elapsed, session_id
        );
    }
    None
}
