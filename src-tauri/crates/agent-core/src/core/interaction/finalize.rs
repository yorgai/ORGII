//! Shared primitives for interactive-tool finalization.
//!
//! All three blocking user-interactions (`ask_user_questions`,
//! `ask_user_permissions`, `suggest_mode_switch`) share the same shape:
//!
//!   1. Tool broadcasts a request event and blocks on a `oneshot::Receiver`
//!      until the user responds via a Tauri command.
//!   2. Historically the wait was a bare `tokio::time::timeout(...)` which
//!      ignored the session `cancel_flag`, so Stop could not interrupt the
//!      tool and queued messages could not flush.
//!   3. The "answered" state only propagated to the UI through the eventual
//!      `agent:tool_result` emitted when `execute()` returns — leaving the
//!      chat panel stuck on "waiting for your answer" until the next turn.
//!
//! This module provides two building blocks to unify the fix:
//!
//! * [`await_with_cancel`] — a cancel-aware wait that also leaves room for a
//!   future auto-timeout policy (e.g. "if the user doesn't answer in N
//!   seconds, auto-select the recommended option").
//! * [`finalize_interaction_event`] — emits an authoritative structured
//!   `agent:tool_result` broadcast at the *moment of user response* so the
//!   UI doesn't have to wait for the tool's `execute()` to return.
//!
//! `ask_user_questions` is the first user; `ask_user_permissions` and
//! `suggest_mode_switch` will migrate to the same primitives.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::json;
use tokio::sync::oneshot;
use tracing::{info, warn};

use crate::bus::broadcast_event;

// ============================================================================
// Await primitive
// ============================================================================

/// Outcome of awaiting a user interaction.
#[derive(Debug)]
pub enum InteractionOutcome<T> {
    /// User responded via the frontend.
    Responded(T),
    /// Session-level cancel flag was set (Stop button).
    Cancelled,
    /// Timeout elapsed with no response and no auto-policy.
    TimedOut,
    /// Auto-timeout policy returned a substituted response.
    AutoResponded(T),
    /// Sender was dropped before responding (request was invalidated).
    Dropped,
}

/// What an [`AutoTimeoutPolicy`] should do when the window elapses.
pub enum AutoTimeoutAction<T> {
    /// Substitute this answer and resume the tool as if the user responded.
    Respond(T),
    /// Surface the timeout to the tool (`InteractionOutcome::TimedOut`).
    Report,
}

/// Optional policy that decides how to act when the wait times out.
///
/// This is the extensibility hook for future auto-respond behaviors (e.g.
/// a per-session "auto-skip after N seconds" setting on `ask_user_questions`,
/// or "auto-deny after N seconds" on permission prompts). Today no tool
/// installs a policy — leave `None` for plain timeout behavior.
pub struct AutoTimeoutPolicy<T> {
    pub timeout: Duration,
    /// Invoked when `timeout` elapses. Runs on the awaiting task; keep it
    /// non-blocking.
    pub on_expire: Box<dyn FnOnce() -> AutoTimeoutAction<T> + Send>,
}

/// Poll interval for the cancel-flag when no timeout policy is active.
///
/// Small enough that a Stop click feels instant, large enough that an idle
/// question doesn't churn the scheduler.
const CANCEL_POLL_INTERVAL: Duration = Duration::from_millis(250);

/// Wait for a user-interaction response while remaining responsive to the
/// session cancel flag.
///
/// * `Responded` — user answered (normal path).
/// * `Cancelled` — `cancel_flag` flipped to `true`; the receiver is dropped,
///   so the corresponding manager's sender sees a broken pipe and cleans up.
/// * `TimedOut` — no policy and the optional timeout elapsed.
/// * `AutoResponded` — policy substituted a response on timeout.
/// * `Dropped` — the sender half was dropped before anyone responded.
pub async fn await_with_cancel<T: Send + 'static>(
    receiver: oneshot::Receiver<T>,
    cancel_flag: Arc<AtomicBool>,
    policy: Option<AutoTimeoutPolicy<T>>,
) -> InteractionOutcome<T> {
    tokio::pin!(receiver);

    // Timer: the policy's timeout, or an effectively-infinite sleep so the
    // `select!` arm still compiles but never fires.
    type OnExpireFn<T> = Box<dyn FnOnce() -> AutoTimeoutAction<T> + Send>;
    let (timeout, on_expire): (Duration, Option<OnExpireFn<T>>) = match policy {
        Some(p) => (p.timeout, Some(p.on_expire)),
        None => (Duration::from_secs(60 * 60 * 24 * 365), None),
    };
    let sleep = tokio::time::sleep(timeout);
    tokio::pin!(sleep);

    loop {
        tokio::select! {
            biased;

            // 1) Cancellation has the highest priority so Stop feels instant.
            _ = tokio::time::sleep(CANCEL_POLL_INTERVAL) => {
                if cancel_flag.load(Ordering::SeqCst) {
                    return InteractionOutcome::Cancelled;
                }
                // Otherwise loop and re-arm the select.
            }

            // 2) User responded.
            received = &mut receiver => {
                return match received {
                    Ok(value) => InteractionOutcome::Responded(value),
                    Err(_) => InteractionOutcome::Dropped,
                };
            }

            // 3) Timeout elapsed.
            _ = &mut sleep => {
                return match on_expire {
                    Some(f) => match f() {
                        AutoTimeoutAction::Respond(value) => InteractionOutcome::AutoResponded(value),
                        AutoTimeoutAction::Report => InteractionOutcome::TimedOut,
                    },
                    None => InteractionOutcome::TimedOut,
                };
            }
        }
    }
}

// ============================================================================
// Authoritative event emission
// ============================================================================

/// Status field written into the finalized event's `result` payload.
///
/// The FE (`resolveDisplayStatus` in `ask-question/index.tsx`) keys off
/// `"answered"` to swap the card from pending → answered immediately.
#[derive(Debug, Clone, Copy)]
pub enum FinalizedStatus {
    Answered,
    Cancelled,
    TimedOut,
    Rejected,
}

impl FinalizedStatus {
    fn as_str(&self) -> &'static str {
        match self {
            FinalizedStatus::Answered => "answered",
            FinalizedStatus::Cancelled => "cancelled",
            FinalizedStatus::TimedOut => "timed_out",
            FinalizedStatus::Rejected => "rejected",
        }
    }
}

/// Emit the authoritative tool_result for an interactive tool at the moment
/// the user acts (not when `execute()` returns).
///
/// `extra` is merged into the broadcast payload's `result` object so the FE
/// event store can overlay structured data (e.g. `answers`, `choice`) on top
/// of the `tool_call` event. The later `agent:tool_result` emitted by
/// `on_tool_result` when `execute()` returns carries `{content, observation}`
/// only; the object-merge performed in `merge_events` keeps both sets.
///
/// Callers must also feed the same `content` back to the LLM via the tool's
/// `Ok(String)` return — that's what the model sees next turn. This function
/// is only responsible for the UI/persistence side of the flow.
pub fn finalize_interaction_event(
    session_id: &str,
    tool_call_id: Option<&str>,
    tool_name: &str,
    status: FinalizedStatus,
    content: &str,
    extra: serde_json::Value,
) {
    let Some(tool_call_id) = tool_call_id else {
        // No tool_call_id means the tool wasn't tracked by the event pipeline
        // (shouldn't happen in the normal agent flow). Skip silently rather
        // than corrupting the event store with an orphan finalize.
        warn!(
            "[interaction] finalize_interaction_event: missing tool_call_id for tool={}",
            tool_name
        );
        return;
    };

    let mut result = json!({
        "status": status.as_str(),
        "content": content,
        "observation": content,
    });
    if let serde_json::Value::Object(ref mut map) = result {
        if let serde_json::Value::Object(extra_map) = extra {
            for (k, v) in extra_map {
                map.insert(k, v);
            }
        }
    }

    let preview: String = crate::utils::safe_truncate_chars(content, 4000).to_string();

    broadcast_event(
        "agent:interaction_finalized",
        json!({
            "sessionId": session_id,
            "toolCallId": tool_call_id,
            "tool": tool_name,
            "status": status.as_str(),
            // Structured payload consumed by the FE handler and written into
            // `SessionEvent.result` via object-merge in `merge_events`.
            "resultObject": result,
            // Plain string preview mirroring `agent:tool_result.result` — kept
            // for parity with the existing tool_result shape and for any
            // listener that only cares about the human-readable blob.
            "resultPreview": preview,
        }),
    );

    info!(
        "[interaction] finalized tool={} call_id={} status={}",
        tool_name,
        tool_call_id,
        status.as_str()
    );
}
