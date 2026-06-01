//! `finish_reason = length` recovery strategies.
//!
//! When the model truncates its output because it ran out of `max_tokens`
//! we apply a two-tier recovery, mirroring claude_code's
//! `runPromptCatchingMaxTokensError` in `utils/context.ts`:
//!
//! - **Tier 1 (silent escalation)**: bump `max_tokens` to
//!   `ESCALATED_MAX_TOKENS` once per turn and retry the same iteration with
//!   no user-visible messages. Best for clean re-generation when the model
//!   was simply close to a small ceiling.
//!
//! - **Tier 2 (auto-continue)**: append a `Continue.` user prompt that
//!   tells the model to pick up mid-thought, with a visible-to-the-user
//!   `[Output truncated — auto-continuing...]` delta. Capped at
//!   `MAX_OUTPUT_RECOVERY_ATTEMPTS`.

use serde_json::Value;
use tracing::warn;

use crate::providers::traits::LLMResponse;

use super::backoff::{ESCALATED_MAX_TOKENS, MAX_OUTPUT_RECOVERY_ATTEMPTS};
use super::helpers::add_assistant_message;
use super::TurnEventHandler;

/// Decision returned by [`maybe_recover_from_length`] to the main loop.
pub(super) enum LengthRecoveryOutcome {
    /// No recovery available — caller should treat the response as terminal
    /// (set `final_content = response.content` and break).
    Terminal,
    /// Recovery applied — caller should `continue` the loop. `effective_max_tokens`
    /// reflects the (possibly bumped) ceiling for the retry.
    Continue { effective_max_tokens: u32 },
}

/// Apply Tier-1 silent escalation if eligible, otherwise Tier-2
/// auto-continue, otherwise return [`LengthRecoveryOutcome::Terminal`].
///
/// `tier1_escalated` is consumed (set to true on Tier-1 fire); pass back in
/// the new value so the main loop knows escalation has been used.
/// `output_recovery_count` is incremented inside the function on Tier-2 fire.
#[allow(clippy::too_many_arguments)]
pub(super) fn maybe_recover_from_length(
    response: &LLMResponse,
    messages: &mut Vec<Value>,
    tier1_escalated: &mut bool,
    effective_max_tokens: u32,
    configured_max_tokens: u32,
    output_recovery_count: &mut u32,
    session_id: &str,
    model: &str,
    handler: &dyn TurnEventHandler,
) -> LengthRecoveryOutcome {
    if !*tier1_escalated && effective_max_tokens < ESCALATED_MAX_TOKENS {
        *tier1_escalated = true;
        warn!(
            "[agent-core] Output truncated (finish_reason=length), Tier-1 silent escalation \
             {} → {} max_tokens (session={})",
            configured_max_tokens, ESCALATED_MAX_TOKENS, session_id
        );

        // Roll back the partial assistant message so the escalated retry
        // starts clean (no duplicate partial content in the transcript).
        add_assistant_message(
            messages,
            response.content.as_deref(),
            None,
            response.reasoning_content.as_deref(),
        );
        handler.on_assistant_iteration_complete(
            session_id,
            response.content.as_deref(),
            false,
            model,
        );
        // Re-inject an empty continuation prompt so the model picks up
        // from where it was cut, but no user-visible banner is emitted.
        messages.push(serde_json::json!({
            "role": "user",
            "content": "Continue."
        }));
        return LengthRecoveryOutcome::Continue {
            effective_max_tokens: ESCALATED_MAX_TOKENS,
        };
    }

    if *output_recovery_count < MAX_OUTPUT_RECOVERY_ATTEMPTS {
        *output_recovery_count += 1;
        warn!(
            "[agent-core] Output truncated (finish_reason=length), auto-continue {}/{} (session={})",
            output_recovery_count, MAX_OUTPUT_RECOVERY_ATTEMPTS, session_id
        );

        add_assistant_message(
            messages,
            response.content.as_deref(),
            None,
            response.reasoning_content.as_deref(),
        );
        handler.on_assistant_iteration_complete(
            session_id,
            response.content.as_deref(),
            false,
            model,
        );
        messages.push(serde_json::json!({
            "role": "user",
            "content": "Output token limit hit. Resume directly — no apology, no recap of what you were doing. \
                         Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces."
        }));
        handler.on_message_delta(
            session_id,
            "\n\n[Output truncated — auto-continuing...]\n\n",
        );
        return LengthRecoveryOutcome::Continue {
            effective_max_tokens,
        };
    }

    LengthRecoveryOutcome::Terminal
}
