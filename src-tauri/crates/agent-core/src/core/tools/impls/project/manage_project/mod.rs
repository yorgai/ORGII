//! `manage_project` tool — agent-facing wrapper over `tool_infra::project`.
//!
//! Layout:
//! - [`schema`]      — static description, dynamic `llm_description`, JSON Schema.
//! - [`params`]      — shared param-extraction helpers (string arrays, todos,
//!   schedule, orchestrator overrides).
//! - [`projects`]     — project-level CRUD action handlers.
//! - [`work_items`]  — work-item action handlers (`list_items`, `read_item`,
//!   …, `find`).
//! - [`members`]     — team-member action handlers.
//!
//! `mod.rs` itself only owns the `ProjectTool` struct, the `Tool` impl, and
//! the action-name → handler dispatch.

mod members;
mod params;
mod projects;
mod schema;
mod work_items;

use async_trait::async_trait;
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

use crate::tools::names as tool_names;
use crate::tools::traits::{required_string, Tool, ToolError};

/// Project management tool.
pub struct ProjectTool {
    /// App handle for launching sessions (`start_item`).
    app_handle: Option<tauri::AppHandle>,
    /// Agent session code account (shared with `SessionTool` when set).
    current_account_id: Option<Arc<TokioMutex<Option<String>>>>,
    /// Agent model id for the running session (used with session account for
    /// `start_item`).
    agent_model: String,
}

impl ProjectTool {
    pub fn new(
        app_handle: Option<tauri::AppHandle>,
        current_account_id: Option<Arc<TokioMutex<Option<String>>>>,
        agent_model: String,
    ) -> Self {
        Self {
            app_handle,
            current_account_id,
            agent_model,
        }
    }

    /// Resolve the `slug` parameter to a canonical project slug.
    /// Accepts slug, display name, or project ID.
    fn resolve_slug(params: &Value) -> Result<String, ToolError> {
        let raw = required_string(params, "slug")?;
        crate::tool_infra::resolve_slug(&raw).map_err(ToolError::ExecutionFailed)
    }
}

#[async_trait]
impl Tool for ProjectTool {
    fn name(&self) -> &str {
        tool_names::MANAGE_PROJECT
    }

    fn category(&self) -> &str {
        crate::tools::categories::PROJECT
    }

    fn description(&self) -> &str {
        schema::DESCRIPTION
    }

    fn llm_description(&self) -> Option<String> {
        Some(schema::llm_description())
    }

    fn parameters(&self) -> Value {
        schema::parameters()
    }

    async fn execute_text(&self, params: Value) -> Result<String, ToolError> {
        let action = required_string(&params, "action")?;

        match action.as_str() {
            // ── Project actions ──
            "list" => projects::list().await,
            "read" => {
                let slug = Self::resolve_slug(&params)?;
                projects::read(&slug).await
            }
            "create" => projects::create(&params).await,
            "update" => {
                let slug = Self::resolve_slug(&params)?;
                projects::update(&slug, &params).await
            }
            "delete" => {
                let slug = Self::resolve_slug(&params)?;
                projects::delete(&slug).await
            }

            // ── Work item actions ──
            "list_items" => {
                let slug = Self::resolve_slug(&params)?;
                work_items::list(&slug).await
            }
            "read_item" => {
                let slug = Self::resolve_slug(&params)?;
                let short_id = required_string(&params, "short_id")?;
                work_items::read(&slug, &short_id).await
            }
            "create_item" => {
                let slug = Self::resolve_slug(&params)?;
                work_items::create(&slug, &params).await
            }
            "update_item" => {
                let slug = Self::resolve_slug(&params)?;
                let short_id = required_string(&params, "short_id")?;
                work_items::update(&slug, &short_id, &params).await
            }
            "delete_item" => {
                let slug = Self::resolve_slug(&params)?;
                let short_id = required_string(&params, "short_id")?;
                work_items::delete(&slug, &short_id).await
            }
            "start_item" => {
                let slug = Self::resolve_slug(&params)?;
                let short_id = required_string(&params, "short_id")?;
                work_items::start(
                    &slug,
                    &short_id,
                    self.app_handle.as_ref(),
                    self.current_account_id.as_ref(),
                    &self.agent_model,
                )
                .await
            }
            "find" => {
                let query = required_string(&params, "query")?;
                work_items::find(&query).await
            }

            // ── Member actions ──
            "list_members" => {
                let slug = Self::resolve_slug(&params)?;
                members::list_members(&slug)
            }
            "list_contributors" => {
                let slug = Self::resolve_slug(&params)?;
                members::list_contributors(&slug)
            }

            _ => Err(ToolError::InvalidParams(format!(
                "Unknown project action: '{}'. Valid: list, read, create, update, delete, \
                 list_items, read_item, create_item, update_item, delete_item, start_item, \
                 find, list_members, list_contributors",
                action
            ))),
        }
    }
}
