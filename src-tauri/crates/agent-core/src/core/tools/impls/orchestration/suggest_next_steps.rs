//! Propose next step tool.
//!
//! The agent calls `suggest_next_steps` at the end of a turn with 2-3
//! contextual suggestions for what the user might want to do next.
//! Non-blocking — returns the proposals immediately as JSON so the
//! frontend can render clickable cards.

use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::tools::names as tool_names;
use crate::tools::traits::{params_schema, parse_params, Tool, ToolError};

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct StepProposal {
    /// Short display label (e.g. "Add unit tests")
    pub title: String,
    /// Full instruction sent as the next user message when clicked
    pub command: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SuggestNextStepsParams {
    /// 2-3 contextual next step suggestions
    pub steps: Vec<StepProposal>,
}

#[derive(Default)]
pub struct SuggestNextStepsTool;

impl SuggestNextStepsTool {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Tool for SuggestNextStepsTool {
    fn name(&self) -> &str {
        tool_names::SUGGEST_NEXT_STEPS
    }

    fn description(&self) -> &str {
        concat!(
            "Propose 2-3 contextual next steps at the end of a turn as clickable cards. ",
            "Each step has a short title and a full command sent as the next user message when picked. ",
            "Call this tool INSTEAD OF writing 'Next options:', 'Next steps:', 'You could:', ",
            "or any similar follow-up list in your text — the cards ARE the UI, so do NOT preview ",
            "the options in text before or after calling this tool. ",
            "Only call it when a follow-up is genuinely useful AND you have 2-3 clearly distinct, ",
            "actionable steps. Skip it for simple factual answers, yes/no questions you just asked, ",
            "or when there is only one obvious next action (just do that action instead). ",
            "When you do call it, it MUST be the final action of the turn — stop immediately after."
        )
    }

    fn category(&self) -> &str {
        crate::tools::categories::ORCHESTRATION
    }

    fn is_read_only(&self) -> bool {
        true
    }

    fn parameters(&self) -> Value {
        params_schema::<SuggestNextStepsParams>()
    }

    async fn execute_text(&self, params: Value) -> Result<String, ToolError> {
        let parsed: SuggestNextStepsParams = parse_params(params)?;

        if parsed.steps.is_empty() {
            return Err(ToolError::InvalidParams(
                "At least one step proposal is required".into(),
            ));
        }
        if parsed.steps.len() > 5 {
            return Err(ToolError::InvalidParams(
                "At most 5 step proposals are allowed".into(),
            ));
        }

        serde_json::to_string(&parsed.steps).map_err(|err| {
            ToolError::ExecutionFailed(format!("Failed to serialize step proposals: {err}"))
        })
    }
}
