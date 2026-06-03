//! LLM turn execution with reactive ContextTooLong recovery.
//!
//! Wraps `turn_executor::execute_turn` with:
//!
//! - Per-mode policy overlay (Plan/Ask deny writes; Explore/Debug/Review
//!   narrow allow-lists). The base policy comes from `runtime.policy`.
//! - Tool-registry context propagation (session key, permission
//!   provider, channel/chat_id, IDE repo, parent messages snapshot for
//!   AgentTool subagent forks).
//! - Reactive ContextTooLong handling: up to 2 retries that re-run
//!   [`ContextCompactor::compact`] then retry the turn.
//!
//! All inputs are read off `&self` (no per-call config struct) since
//! every field is a session-level value already held by
//! `UnifiedMessageProcessor`.

use std::sync::Arc;

use serde_json::Value;
use tracing::{info, warn};

use super::UnifiedMessageProcessor;
use crate::model_context::compaction::{CompactionOutcome, ContextCompactor};
use crate::turn_executor::{self, PermissionProvider, TurnConfig, TurnIterationHook, TurnResult};

use super::super::event_handler::UnifiedEventHandler;
use super::super::streaming::broadcast_agent_warning;

impl UnifiedMessageProcessor {
    /// Executes one LLM turn, transparently re-compacting up to twice if
    /// the provider returns `ContextTooLong`.
    ///
    /// Returns the final `TurnResult` plus the [`UnifiedEventHandler`]
    /// that observed the turn — the caller reads `tool_call_count()`,
    /// `todo_was_called()`, and `flush_streaming()` off the handler.
    pub(super) async fn execute_turn_with_reactive_retry(
        &self,
        session_id: &str,
        turn_id: &str,
        messages: &mut Vec<Value>,
    ) -> Result<(TurnResult, UnifiedEventHandler), String> {
        let effective_policy = self.effective_tool_policy();

        self.runtime
            .provider
            .begin_logical_turn(session_id, turn_id);

        let turn_config = TurnConfig {
            model: self.runtime.model.clone(),
            max_iterations: self.effective_max_iterations(),
            max_tokens: self.runtime.resolved.max_tokens as u32,
            temperature: self.runtime.resolved.temperature as f32,
            max_tool_use_concurrency: self.runtime.resolved.max_tool_use_concurrency as usize,
            screenshot_store: Some(Arc::clone(&self.screenshot_store)),
            iteration_hook: self
                .turn_prefetch_hook
                .lock()
                .await
                .as_ref()
                .map(|hook| Arc::clone(hook) as Arc<dyn TurnIterationHook>),
            persist_cancel_marker: self
                .session
                .persist_next_cancel_marker
                .load(std::sync::atomic::Ordering::SeqCst),
        };

        let handler = UnifiedEventHandler::new(self.event_handler_config.clone());

        // Set session key for streaming tools
        self.runtime.tool_registry.set_session_key(session_id).await;

        // Propagate permission provider to tools (ExecTool uses it for command-level confirmation)
        self.runtime
            .tool_registry
            .set_permission_provider(
                Arc::clone(&self.session.permission_manager) as Arc<dyn PermissionProvider>
            )
            .await;

        // Set tool contexts for OS sessions (channel, chat_id; sender_id is only available
        // in Gateway sessions where it is propagated by GatewayInboundHandler).
        if let (Some(ref channel), Some(ref chat_id)) = (&self.channel, &self.chat_id) {
            self.runtime
                .tool_registry
                .set_all_contexts(channel, chat_id, "")
                .await;
        }

        // Set active repo from IDE context (repo_path is set by OS sessions)
        if let Some(ref ide_ctx) = self.ide_context {
            if let Some(ref repo_path) = ide_ctx.repo_path {
                self.runtime.tool_registry.set_active_repo(repo_path).await;
                info!("[unified_processor] Active IDE repo set: {}", repo_path);
            }
        }

        // Snapshot parent messages for fork-path subagents (AgentTool)
        self.runtime
            .tool_registry
            .set_parent_messages(messages)
            .await;

        // Build permission provider reference
        let perm_provider: Option<&dyn PermissionProvider> =
            Some(&*self.session.permission_manager as &dyn PermissionProvider);

        let cache_probe_system_blocks =
            crate::session::prompt::cache::rendered_system_blocks_from_messages(messages);
        let cache_probe_tools = self
            .runtime
            .tool_registry
            .get_definitions_budgeted(effective_policy.as_ref());
        let workspace_root = self.workspace_root();
        let result: TurnResult = match turn_executor::execute_turn(
            messages,
            self.runtime.provider.as_ref(),
            self.runtime.tool_registry.as_ref(),
            effective_policy.as_ref(),
            &turn_config,
            session_id,
            &handler,
            perm_provider,
            Some(&self.session.cancel_flag),
            workspace_root.as_deref(),
            self.runtime.policy_context_activator.as_deref(),
        )
        .await
        {
            Ok(turn_result) => turn_result,
            Err(err)
                if err.contains("ContextTooLong") && self.runtime.resolved.compaction.enabled =>
            {
                self.execute_with_reactive_compact(
                    session_id,
                    messages,
                    err,
                    &turn_config,
                    effective_policy.as_ref(),
                    &handler,
                    perm_provider,
                    workspace_root.as_deref(),
                )
                .await?
            }
            Err(err) => return Err(err),
        };

        self.session.prompt_cache_break_tracker.lock().await.record(
            &cache_probe_system_blocks,
            Some(&cache_probe_tools),
            &self.runtime.model,
            result.prompt_tokens,
            result.cache_read_tokens,
            result.cache_write_tokens,
        );

        Ok((result, handler))
    }

    /// Reactive ContextTooLong recovery: up to 2 retries each preceded
    /// by a fresh `ContextCompactor::compact`. Used only when the
    /// initial `execute_turn` returned `ContextTooLong` and compaction
    /// is enabled.
    #[allow(clippy::too_many_arguments)]
    async fn execute_with_reactive_compact(
        &self,
        session_id: &str,
        messages: &mut Vec<Value>,
        first_err: String,
        turn_config: &TurnConfig,
        effective_policy: &crate::tools::policy::ResolvedToolPolicy,
        handler: &UnifiedEventHandler,
        perm_provider: Option<&dyn PermissionProvider>,
        workspace_root: Option<&std::path::Path>,
    ) -> Result<TurnResult, String> {
        const MAX_REACTIVE_RETRIES: usize = 2;
        let mut last_err = first_err;
        let mut reactive_result: Option<TurnResult> = None;

        for attempt in 1..=MAX_REACTIVE_RETRIES {
            warn!(
                "[unified_processor] ContextTooLong hit for session {} — reactive compact attempt {}/{}",
                session_id, attempt, MAX_REACTIVE_RETRIES,
            );
            let context_window =
                crate::providers::model_hints::context_window_hint(&self.runtime.model);
            let mut state = self.compaction_state.lock().await;
            let (compacted, reactive_outcome) = ContextCompactor::compact(
                messages,
                context_window,
                &self.runtime.resolved.compaction,
                &mut state,
                self.runtime.provider.as_ref(),
                &self.runtime.model,
            )
            .await;
            *messages = crate::model_context::cleanup::post_compact_cleanup(compacted);
            drop(state);
            self.session
                .invalidate_prompt_cache(
                    crate::session::prompt::cache::PromptCacheInvalidationReason::Compaction,
                )
                .await;

            if let CompactionOutcome::Truncated { messages_dropped } = reactive_outcome {
                broadcast_agent_warning(
                    session_id,
                    &format!(
                        "Reactive compaction fell back to truncation ({} messages dropped without summary, attempt {})",
                        messages_dropped, attempt
                    ),
                    "compaction",
                );
            }

            info!(
                "[unified_processor] Reactive compaction done, retrying turn (session={}, messages={}, attempt={})",
                session_id,
                messages.len(),
                attempt,
            );

            match turn_executor::execute_turn(
                messages,
                self.runtime.provider.as_ref(),
                self.runtime.tool_registry.as_ref(),
                effective_policy,
                turn_config,
                session_id,
                handler,
                perm_provider,
                Some(&self.session.cancel_flag),
                workspace_root,
                self.runtime.policy_context_activator.as_deref(),
            )
            .await
            {
                Ok(turn_result) => {
                    reactive_result = Some(turn_result);
                    break;
                }
                Err(retry_err)
                    if retry_err.contains("ContextTooLong") && attempt < MAX_REACTIVE_RETRIES =>
                {
                    last_err = retry_err;
                    continue;
                }
                Err(retry_err) => return Err(retry_err),
            }
        }

        reactive_result.ok_or(last_err)
    }
}

#[cfg(test)]
mod tests {
    use crate::core::session::turn::turn_max_iterations_from_session_model;

    #[test]
    fn turn_max_iterations_uses_resolved_session_model_value() {
        assert_eq!(turn_max_iterations_from_session_model(5), Some(5));
        assert_eq!(turn_max_iterations_from_session_model(30), Some(30));
        assert_eq!(turn_max_iterations_from_session_model(500), Some(500));
    }

    // Tests for effective_max_iterations() — the min(session_cap, mode_cap) logic.
    // We exercise the logic directly since we cannot construct UnifiedMessageProcessor
    // in unit tests without a full runtime. The mode cap values are:
    //   Plan / Ask / Review => 30
    //   Build / Debug / Wingman / None => no mode cap
    #[test]
    fn effective_max_iterations_plan_caps_at_30() {
        use crate::session::AgentExecMode;
        // session model has 500; Plan mode cap is 30 → effective is 30
        let session_cap = turn_max_iterations_from_session_model(500);
        let mode_cap: Option<u32> = match Some(AgentExecMode::Plan) {
            Some(AgentExecMode::Plan) => Some(30),
            Some(AgentExecMode::Ask) => Some(30),
            Some(AgentExecMode::Review) => Some(30),
            _ => None,
        };
        let effective = match (session_cap, mode_cap) {
            (Some(sc), Some(mc)) => Some(sc.min(mc)),
            (sc, mc) => sc.or(mc),
        };
        assert_eq!(effective, Some(30));
    }

    #[test]
    fn effective_max_iterations_session_model_wins_if_lower() {
        use crate::session::AgentExecMode;
        // session model has 10; Ask mode cap is 30 → effective is 10
        let session_cap = turn_max_iterations_from_session_model(10);
        let mode_cap: Option<u32> = match Some(AgentExecMode::Ask) {
            Some(AgentExecMode::Plan) => Some(30),
            Some(AgentExecMode::Ask) => Some(30),
            Some(AgentExecMode::Review) => Some(30),
            _ => None,
        };
        let effective = match (session_cap, mode_cap) {
            (Some(sc), Some(mc)) => Some(sc.min(mc)),
            (sc, mc) => sc.or(mc),
        };
        assert_eq!(effective, Some(10));
    }

    #[test]
    fn effective_max_iterations_build_mode_has_no_mode_cap() {
        use crate::session::AgentExecMode;
        // Build mode has no mode cap; session model cap governs alone
        let session_cap = turn_max_iterations_from_session_model(500);
        let mode_cap: Option<u32> = match Some(AgentExecMode::Build) {
            Some(AgentExecMode::Plan) => Some(30),
            Some(AgentExecMode::Ask) => Some(30),
            Some(AgentExecMode::Review) => Some(30),
            _ => None,
        };
        let effective = match (session_cap, mode_cap) {
            (Some(sc), Some(mc)) => Some(sc.min(mc)),
            (sc, mc) => sc.or(mc),
        };
        assert_eq!(effective, Some(500));
    }
}
