//! Param-extraction helpers shared by every action handler.
//!
//! Pulled out of the dispatch file so each handler reads a flat list of
//! `optional_*` calls instead of repeating the same `Value` ceremony.

use serde_json::Value;

use crate::tool_infra::OrchestratorConfigOverrides;
use crate::tools::traits::optional_string;

/// Extract an optional array of strings from params.
pub(super) fn optional_string_array(params: &Value, key: &str) -> Option<Vec<String>> {
    params.get(key).and_then(|val| {
        val.as_array().map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(String::from))
                .collect()
        })
    })
}

/// Extract optional todos array: `[{"content": "...", "status": "..."}]`
pub(super) fn optional_todos(params: &Value) -> Option<Vec<(String, String)>> {
    params.get("todos").and_then(|val| {
        val.as_array().map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let content = item.get("content")?.as_str()?.to_string();
                    let status = item
                        .get("status")
                        .and_then(|status_val| status_val.as_str())
                        .unwrap_or("pending")
                        .to_string();
                    Some((content, status))
                })
                .collect()
        })
    })
}

pub(super) fn optional_schedule(params: &Value) -> Option<core_types::workflow::WorkItemSchedule> {
    params.get("schedule").and_then(|val| {
        if !val.is_object() {
            return None;
        }
        let at = val.get("at").and_then(|v| v.as_str()).map(String::from);
        let cron = val.get("cron").and_then(|v| v.as_str()).map(String::from);
        if at.is_none() && cron.is_none() {
            return None;
        }
        let enabled = val.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
        Some(core_types::workflow::WorkItemSchedule {
            at,
            cron,
            enabled,
            last_run: None,
        })
    })
}

/// Build orchestrator config overrides from params if any agent-related fields are set.
pub(super) fn orchestrator_overrides_from_params(
    params: &Value,
) -> Option<OrchestratorConfigOverrides> {
    let account = optional_string(params, "selected_account_id");
    let model = optional_string(params, "selected_model_id");
    let sub_agents = optional_string_array(params, "sub_agent_ids");
    let org_id = optional_string(params, "org_id");
    let agent_definition_id = optional_string(params, "agent_definition_id");
    let worktree_path = optional_string(params, "worktree_path");
    let review_config = params.get("review_config").and_then(|rc| {
        serde_json::from_value::<core_types::workflow::ReviewConfig>(rc.clone()).ok()
    });
    if account.is_some()
        || model.is_some()
        || sub_agents.as_ref().is_some_and(|v| !v.is_empty())
        || org_id.is_some()
        || agent_definition_id.is_some()
        || worktree_path.is_some()
        || review_config.is_some()
    {
        Some(OrchestratorConfigOverrides {
            selected_account_id: account,
            selected_model_id: model,
            sub_agent_ids: sub_agents.unwrap_or_default(),
            org_id,
            agent_definition_id,
            worktree_path,
            review_config,
        })
    } else {
        None
    }
}
