//! `db_explore` tool — discover connections, tables, and schemas.

use async_trait::async_trait;
use serde_json::Value;

use super::SharedConfig;
use crate::tools::names as tool_names;
use crate::tools::traits::{required_string, Tool, ToolError};

pub struct DbExploreTool {
    config: SharedConfig,
}

impl DbExploreTool {
    pub fn new(config: SharedConfig) -> Self {
        Self { config }
    }
}

#[async_trait]
impl Tool for DbExploreTool {
    fn name(&self) -> &str {
        tool_names::DB_EXPLORE
    }

    fn category(&self) -> &str {
        crate::tools::categories::DATABASE
    }

    fn is_read_only(&self) -> bool {
        true
    }

    fn description(&self) -> &str {
        "Explore database connections, tables, and schemas.\n\n\
         ## Actions\n\
         - **list_connections** — List all configured database connections (no params)\n\
         - **list_tables** — List tables/views in a connection (requires connection_id)\n\
         - **schema** — Get column definitions for a table (requires connection_id + table)"
    }

    fn llm_description(&self) -> Option<String> {
        let connections = self.config.try_lock().ok()?;
        if connections.connections.is_empty() {
            return None;
        }
        let mut lines = Vec::new();
        for (conn_id, entry) in &connections.connections {
            let status = if entry.enabled { "" } else { " [disabled]" };
            let ro = if entry.read_only { " [read-only]" } else { "" };
            lines.push(format!(
                "  - `{conn_id}` ({}){}{}",
                entry.db_type, ro, status
            ));
        }
        let conn_list = lines.join("\n");
        Some(format!(
            "Explore database connections, tables, and schemas.\n\n\
             Configured connections:\n{conn_list}\n\n\
             Actions: list_connections, list_tables (requires connection_id), \
             schema (requires connection_id + table)."
        ))
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "Action to perform",
                    "enum": ["list_connections", "list_tables", "schema"]
                },
                "connection_id": {
                    "type": "string",
                    "description": "Database connection ID (from list_connections)"
                },
                "table": {
                    "type": "string",
                    "description": "Table name (for schema action)"
                }
            },
            "required": ["action"]
        })
    }

    async fn execute_text(&self, params: Value) -> Result<String, ToolError> {
        let action = required_string(&params, "action")?;

        match action.as_str() {
            "list_connections" => self.exec_list_connections().await,
            "list_tables" => {
                let connection_id = required_string(&params, "connection_id")?;
                self.exec_list_tables(&connection_id).await
            }
            "schema" => {
                let connection_id = required_string(&params, "connection_id")?;
                let table = required_string(&params, "table")?;
                self.exec_schema(&connection_id, &table).await
            }
            other => Err(ToolError::InvalidParams(format!(
                "Unknown db_explore action: \"{}\". Use list_connections, list_tables, or schema.",
                other
            ))),
        }
    }
}

impl DbExploreTool {
    async fn exec_list_connections(&self) -> Result<String, ToolError> {
        let config = self.config.lock().await;

        if config.connections.is_empty() {
            return Ok("No database connections configured. Add databases in Settings > Integrations > Databases.".to_string());
        }

        let mut lines = Vec::new();
        for entry in config.connections.values() {
            let status = if entry.enabled { "enabled" } else { "disabled" };
            lines.push(format!(
                "- {} ({}): {} [{}]{}",
                entry.name,
                entry.db_type,
                entry.url,
                status,
                if entry.read_only { " [read-only]" } else { "" },
            ));
        }

        Ok(format!(
            "{} database connection(s):\n{}",
            config.connections.len(),
            lines.join("\n")
        ))
    }

    async fn exec_list_tables(&self, connection_id: &str) -> Result<String, ToolError> {
        let config = self.config.lock().await;

        let entry = config.connections.get(connection_id).ok_or_else(|| {
            ToolError::InvalidParams(format!("Connection not found: {}", connection_id))
        })?;

        if !entry.enabled {
            return Err(ToolError::PermissionDenied(format!(
                "Database connection '{}' is disabled. Enable it in Integrations > Databases.",
                entry.name
            )));
        }

        Err(ToolError::ExecutionFailed(format!(
            "db_explore.list_tables is a STUB — no provider driver is wired into the agent \
             tool path for any of the 6 `DatabaseProviderType`s. Connection '{}' ({} at {}) \
             is configured, but the agent-facing path can only `list_connections` (purely \
             config introspection). Live table-listing is implemented in the WorkStation's \
             Database Manager UI (SQLite-only, `work_station::db_browser::ops::get_tables`).",
            entry.name, entry.db_type, entry.url
        )))
    }

    async fn exec_schema(&self, connection_id: &str, table: &str) -> Result<String, ToolError> {
        let config = self.config.lock().await;

        let entry = config.connections.get(connection_id).ok_or_else(|| {
            ToolError::InvalidParams(format!("Connection not found: {}", connection_id))
        })?;

        if !entry.enabled {
            return Err(ToolError::PermissionDenied(format!(
                "Database connection '{}' is disabled.",
                entry.name
            )));
        }

        Err(ToolError::ExecutionFailed(format!(
            "db_explore.schema is a STUB — no provider driver is wired into the agent tool \
             path. Connection '{}' ({}) is configured, but reading schema for table '{}' \
             requires the still-unfinished agent-side execution path. The WorkStation's \
             Database Manager UI exposes a wired SQLite-only schema reader.",
            entry.name, entry.db_type, table
        )))
    }
}
