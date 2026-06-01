//! Foreground-mode subagent execution — block until the turn loop returns,
//! persist the transcript, update LinkedSession, and surface the result back
//! to the parent's `agent` tool call.

use std::path::Path;
use std::sync::Arc;

use serde_json::Value;
use tracing::{info, warn};

use super::AgentTool;
use crate::definitions::AgentDefinition;
use crate::providers::traits::LLMProvider;
use crate::tools::impls::orchestration::subagent_handler::UnifiedSubagentHandler;
use crate::tools::policy::ResolvedToolPolicy;
use crate::tools::registry::ToolRegistry;
use crate::tools::traits::ToolError;
use crate::turn_executor::{self, TurnConfig};
use core_types::workflow::LinkedSessionStatus;

/// Inputs for `run_foreground_subagent`. Bundled to keep the call site
/// readable and avoid clippy `too_many_arguments`.
pub(super) struct ForegroundRunArgs<'a> {
    pub agent: &'a AgentDefinition,
    pub messages: Vec<Value>,
    pub turn_config: TurnConfig,
    pub effective_registry: &'a ToolRegistry,
    pub effective_policy: ResolvedToolPolicy,
    pub workspace: &'a Path,
    pub subagent_session_id: String,
    pub handler: UnifiedSubagentHandler,
    pub instance_number: u32,
    pub model: String,
    /// Provider bound to the sub-agent's own primary model + reliability
    /// chain. See `helpers::resolve_subagent_model` for the precedence
    /// rules. Inherits from the parent only as a degraded fallback when
    /// the sub-agent definition has no model and no overrides.
    pub provider: Arc<dyn LLMProvider>,
}

impl AgentTool {
    /// Run the subagent's turn loop synchronously and return the assistant
    /// response (or a structured error) for inclusion in the parent's tool
    /// result.
    pub(super) async fn run_foreground_subagent(
        &self,
        args: ForegroundRunArgs<'_>,
    ) -> Result<String, ToolError> {
        let ForegroundRunArgs {
            agent,
            mut messages,
            turn_config,
            effective_registry,
            effective_policy,
            workspace,
            subagent_session_id,
            handler,
            instance_number,
            model,
            provider,
        } = args;

        // 1. Execute turn
        let turn_result = turn_executor::execute_turn(
            &mut messages,
            provider.as_ref(),
            effective_registry,
            &effective_policy,
            &turn_config,
            &subagent_session_id,
            &handler,
            None,
            self.config.parent_cancel_flag.as_ref(),
            Some(workspace),
            None,
        )
        .await;

        // 2. Persist subagent messages for future resume
        {
            let sid = subagent_session_id.clone();
            let msgs = messages.clone();
            tokio::task::spawn_blocking(move || {
                if let Err(err) = crate::session::persistence::save_subagent_transcript(&sid, &msgs)
                {
                    warn!("[agent] Failed to persist transcript for {}: {}", sid, err);
                }
            });
        }

        // 3. Handle result + update LinkedSession.
        // If the subagent's terminal iteration produced no text (pure
        // tool_use turn), backtrack through the turn's message history to
        // find the most recent assistant narration so the parent agent
        // never receives an empty subagent result. This is the right layer
        // to do it — this function is the seam where the subagent's
        // transcript is collapsed into a single response for the caller.
        let (final_status, tokens, response) = match turn_result {
            Ok(result) => {
                let resp = result.content.or_else(|| {
                    turn_executor::last_assistant_text(&result.messages).inspect(|recovered| {
                        info!(
                            "[agent] '{}' terminal iteration had no text; recovered {} chars from earlier turn",
                            agent.name,
                            recovered.len()
                        );
                    })
                }).unwrap_or_else(|| {
                    format!(
                        "Agent '{}' completed but produced no text response.",
                        agent.name
                    )
                });
                handler.broadcast_complete();
                (
                    LinkedSessionStatus::Completed,
                    result.total_tokens,
                    Ok(resp),
                )
            }
            Err(err) => {
                let msg = format!("Agent '{}' failed: {}", agent.name, err);
                handler.broadcast_error();
                (
                    LinkedSessionStatus::Failed,
                    0i64,
                    Err(ToolError::ExecutionFailed(msg)),
                )
            }
        };

        let result_preview: String = match &response {
            Ok(resp) => resp.chars().take(2000).collect(),
            Err(err) => format!("{}", err),
        };
        self.update_linked_session(&subagent_session_id, final_status, tokens, &result_preview)
            .await;

        match &response {
            Ok(_) => {
                info!(
                    "[agent] '{}' #{} done (model={}): {} tokens",
                    agent.name, instance_number, model, tokens
                );
            }
            Err(err) => {
                warn!(
                    "[agent] '{}' #{} failed: {}",
                    agent.name, instance_number, err
                );
            }
        }

        response
    }
}
