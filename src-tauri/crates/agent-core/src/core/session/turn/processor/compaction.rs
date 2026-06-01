//! Pre-turn message-list compaction.
//!
//! Three layers, applied in order to the in-memory `messages` vec:
//!
//! 1. **Microcompact** — time-based clear of old large tool results once
//!    the prompt cache has expired. Often drops enough tokens to skip
//!    the expensive LLM compaction below entirely.
//! 2. **Aggregate budget** — hard cap (200K chars) of tool results per
//!    assistant message group. Uses sticky [`ReplacementState`] for
//!    cache stability across turns.
//! 3. **Context compaction** — only when the message list still exceeds
//!    the model's context window. Tries SM-compact first (zero API
//!    calls, requires session-memory state); falls back to LLM-driven
//!    [`ContextCompactor::compact`] otherwise. After compaction we run
//!    `post_compact_cleanup` and `reinject_files_after_compaction`, and
//!    for channel-attached sessions attempt a compact-fork that
//!    redirects the caller to a fresh session id.
//!
//! Returns `CompactionPhaseOutcome::ForkRedirect` when the compact-fork
//! short-circuits the turn; the caller (`process()`) then returns that
//! redirect to the dispatcher without executing the LLM turn at all.

use serde_json::Value;
use tracing::{info, warn};

use super::super::streaming::broadcast_agent_warning;
use super::UnifiedMessageProcessor;
use crate::core::session::types::ProcessingResult;
use crate::model_context::compaction::{CompactionOutcome, ContextCompactor};
use crate::model_context::microcompact::ReplacementState;
use crate::model_context::session_memory;

/// Outcome of [`UnifiedMessageProcessor::run_pre_turn_compaction`].
pub(super) enum CompactionPhaseOutcome {
    /// Continue with the current `messages` list — execute the LLM turn.
    Continue,
    /// Compact-fork was triggered for a channel-attached session. The
    /// caller should return this `ProcessingResult` to the dispatcher
    /// which will re-dispatch the original message against the new
    /// session id.
    ForkRedirect(ProcessingResult),
}

impl UnifiedMessageProcessor {
    /// Runs all three pre-turn compaction layers (microcompact →
    /// aggregate budget → context compaction). Mutates `messages` in
    /// place.
    pub(super) async fn run_pre_turn_compaction(
        &self,
        session_id: &str,
        messages: &mut Vec<Value>,
    ) -> CompactionPhaseOutcome {
        // 5. Pre-compaction microcompact — time-based clear of old large tool
        // results once the prompt cache has expired. Often drops enough tokens
        // to skip the expensive LLM compaction below entirely.
        {
            use crate::model_context::microcompact::{self, MicrocompactConfig};
            let mc_config = MicrocompactConfig::default();
            let stats = microcompact::microcompact_messages(messages, &mc_config);
            if stats.trimmed_count > 0 {
                info!(
                    "[unified_processor] Pre-compaction microcompact: cleared {} result(s), saved ~{} chars (session={})",
                    stats.trimmed_count, stats.chars_saved, session_id
                );
            }
        }

        // 5b. Aggregate budget — hard cap of 200K chars of tool results per
        // assistant message group. Uses sticky ReplacementState for cache stability.
        {
            use crate::model_context::microcompact;
            let mut rs: tokio::sync::MutexGuard<'_, ReplacementState> =
                self.replacement_state.lock().await;
            let budget_cleared = microcompact::enforce_aggregate_budget(messages, &mut rs);
            if budget_cleared > 0 {
                info!(
                    "[unified_processor] Aggregate budget: cleared {} result(s) (session={})",
                    budget_cleared, session_id
                );
            }
        }

        // 6. Context compaction
        let context_window = if self.runtime.resolved.context_window > 0 {
            self.runtime.resolved.context_window as usize
        } else {
            crate::providers::model_hints::context_window_hint(&self.runtime.model)
        };

        if !(self.runtime.resolved.compaction.enabled
            && ContextCompactor::needs_compaction(
                messages,
                context_window,
                &self.runtime.resolved.compaction,
            ))
        {
            return CompactionPhaseOutcome::Continue;
        }

        info!(
            "[unified_processor] Compacting context for session {} ({} messages, window={})",
            session_id,
            messages.len(),
            context_window
        );

        let pre_compact_messages = messages.clone();

        // Try SM-compact first (zero API calls)
        let sm_compacted = {
            let sm_state = self.sm_state.lock().await;
            if self.sm_config.enabled {
                session_memory::try_sm_compact(
                    messages,
                    &sm_state,
                    &self.sm_compact_config,
                    context_window,
                )
            } else {
                None
            }
        };

        let mut need_llm_compact = true;

        if let Some(compacted) = sm_compacted {
            let cleaned = crate::model_context::cleanup::post_compact_cleanup(compacted);

            if ContextCompactor::needs_compaction(
                &cleaned,
                context_window,
                &self.runtime.resolved.compaction,
            ) {
                warn!(
                    "[unified_processor] SM-compact still over budget for session {} ({} messages, ~{} tokens), falling back to LLM compaction",
                    session_id,
                    cleaned.len(),
                    ContextCompactor::estimate_messages_tokens(&cleaned),
                );
                *messages = cleaned;
            } else {
                info!(
                    "[unified_processor] SM-compact succeeded for session {} ({} → {} messages)",
                    session_id,
                    messages.len(),
                    cleaned.len()
                );
                *messages = cleaned;
                need_llm_compact = false;

                let mut sm_state = self.sm_state.lock().await;
                sm_state.last_summarized_msg_idx = None;
            }
        }

        if need_llm_compact {
            let mut state = self.compaction_state.lock().await;
            let (compacted, outcome) = ContextCompactor::compact(
                messages,
                context_window,
                &self.runtime.resolved.compaction,
                &mut state,
                self.runtime.provider.as_ref(),
                &self.runtime.model,
            )
            .await;
            *messages = crate::model_context::cleanup::post_compact_cleanup(compacted);

            if let CompactionOutcome::Truncated { messages_dropped } = outcome {
                broadcast_agent_warning(
                    session_id,
                    &format!(
                        "Context compaction fell back to truncation ({} messages dropped without summary)",
                        messages_dropped
                    ),
                    "compaction",
                );
            }

            let mut sm_state = self.sm_state.lock().await;
            sm_state.last_summarized_msg_idx = None;
        }

        // Post-compact file re-injection
        crate::model_context::file_reinjection::reinject_files_after_compaction(
            &pre_compact_messages,
            messages,
        );

        // 6b. Compact-fork — for channel-attached sessions only, persist the
        // compacted transcript as a new session id and return `fork_redirect`
        // so the caller re-dispatches the original message against it.
        // App-side sessions (no gateway binding) fall through to in-place execution.
        if let Some(handle) = self.app_handle.as_ref() {
            use tauri::Manager;
            let state = handle.state::<crate::state::AgentAppState>();
            let reset_policy = state
                .integrations
                .snapshot()
                .channels
                .gateway
                .reset_policy
                .clone();
            let outcome = super::super::super::compaction::fork::attempt_fork(
                super::super::super::compaction::fork::ForkInputs {
                    state: state.inner(),
                    compacted_messages: messages,
                    old_session_id: session_id,
                    reset_policy: &reset_policy,
                },
            )
            .await;
            match outcome {
                super::super::super::compaction::fork::ForkOutcome::Forked { new_session_id } => {
                    info!(
                        "[unified_processor] Compact-fork: redirecting session {} → {}",
                        session_id, new_session_id
                    );
                    return CompactionPhaseOutcome::ForkRedirect(ProcessingResult {
                        turn_id: String::new(),
                        content: String::new(),
                        total_tokens: 0,
                        prompt_tokens: 0,
                        completion_tokens: 0,
                        tool_calls_count: 0,
                        truncated: false,
                        turn_summary: None,
                        fork_redirect: Some(new_session_id),
                    });
                }
                super::super::super::compaction::fork::ForkOutcome::NotChannelAttached => {
                    // App-side session — fall through to in-place turn execution.
                }
                super::super::super::compaction::fork::ForkOutcome::Failed(reason) => {
                    warn!(
                        "[unified_processor] Compact-fork failed for session {} ({}) — \
                         continuing in-place",
                        session_id, reason
                    );
                }
            }
        }

        CompactionPhaseOutcome::Continue
    }
}
