//! setup_repo tool — report repo setup status and env var updates to the frontend.
//!
//! Non-blocking: broadcasts `agent:setup_repo_update` to the frontend so the
//! App Launcher can refresh its detection state in real-time.
//!
//! Actions:
//! - `report_status` — push a status update (ready / params_missing / message)
//! - `update_env` — push discovered/created env vars to the frontend
//! - `add_env_vars` — append new env vars that the agent discovered

use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::Mutex;
use tracing::info;

use crate::tools::names as tool_names;
use crate::tools::traits::{Tool, ToolError};

#[derive(Default)]
pub struct RepoSetupTool {
    session_id: Mutex<Option<String>>,
}

impl RepoSetupTool {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl Tool for RepoSetupTool {
    fn name(&self) -> &str {
        tool_names::SETUP_REPO
    }

    fn description(&self) -> &str {
        "Report repo setup progress to the App Launcher UI.\n\
         Use after modifying .env files, installing dependencies, or completing setup steps.\n\
         The UI will refresh its analysis view to reflect the changes.\n\n\
         Actions:\n\
         - \"report_status\": Update the repo's setup status with an optional message.\n\
         - \"update_env\": Push the current set of env vars (overwrites the UI's cached list).\n\
         - \"add_env_vars\": Append newly discovered env vars to the UI's list."
    }

    fn category(&self) -> &str {
        crate::tools::categories::PROJECT
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "required": ["action"],
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["report_status", "update_env", "add_env_vars"],
                    "description": "The action to perform"
                },
                "status": {
                    "type": "string",
                    "enum": ["ready", "params_missing", "not_analyzed"],
                    "description": "Setup status (for report_status action)"
                },
                "message": {
                    "type": "string",
                    "description": "Human-readable status message shown in the UI"
                },
                "env_vars": {
                    "type": "array",
                    "description": "Environment variables to push to the UI",
                    "items": {
                        "type": "object",
                        "required": ["key"],
                        "properties": {
                            "key": {
                                "type": "string",
                                "description": "Variable name (e.g. DATABASE_URL)"
                            },
                            "value": {
                                "type": "string",
                                "description": "Variable value (empty string if not yet set)"
                            },
                            "description": {
                                "type": "string",
                                "description": "What this variable is for"
                            }
                        }
                    }
                }
            }
        })
    }

    async fn execute_text(&self, params: Value) -> Result<String, ToolError> {
        let session_id = self
            .session_id
            .lock()
            .await
            .clone()
            .ok_or_else(|| ToolError::ExecutionFailed("No session context set".into()))?;

        let action = params
            .get("action")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidParams("Missing required field: action".into()))?;

        let payload = serde_json::json!({
            "sessionId": session_id,
            "action": action,
            "data": params,
        });

        crate::bus::broadcast_event("agent:setup_repo_update", payload);

        let message = params.get("message").and_then(|v| v.as_str()).unwrap_or("");

        info!(
            "[repo_setup] action={} session={} message={}",
            action, session_id, message
        );

        match action {
            "report_status" => {
                let status = params
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("ready");
                Ok(format!(
                    "Status '{}' reported to the App Launcher. {}",
                    status,
                    if message.is_empty() { "" } else { message }
                ))
            }
            "update_env" | "add_env_vars" => {
                let count = params
                    .get("env_vars")
                    .and_then(|v| v.as_array())
                    .map_or(0, |a| a.len());
                Ok(format!(
                    "{} env var(s) sent to the App Launcher via '{}'. \
                     The UI will refresh automatically.",
                    count, action
                ))
            }
            _ => Err(ToolError::InvalidParams(format!(
                "Unknown action: '{}'. Expected: report_status, update_env, add_env_vars",
                action
            ))),
        }
    }

    async fn set_session_key(&self, session_key: &str) {
        *self.session_id.lock().await = Some(session_key.to_string());
    }
}
