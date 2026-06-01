//! `db_run` tool — execute SQL queries (SELECT) or mutations
//! (INSERT/UPDATE/DELETE/DDL) against a configured database connection.

use async_trait::async_trait;
use serde_json::Value;

use super::SharedConfig;
use crate::tools::names as tool_names;
use crate::tools::traits::{required_string, Tool, ToolError};

pub struct DbRunTool {
    config: SharedConfig,
}

impl DbRunTool {
    pub fn new(config: SharedConfig) -> Self {
        Self { config }
    }
}

#[async_trait]
impl Tool for DbRunTool {
    fn name(&self) -> &str {
        tool_names::DB_RUN
    }

    fn category(&self) -> &str {
        crate::tools::categories::DATABASE
    }

    fn description(&self) -> &str {
        "Execute SQL against a database connection.\n\n\
         ## Actions\n\
         - **query** — Run a read-only SQL statement (SELECT, WITH, EXPLAIN)\n\
         - **execute** — Run a mutating statement (INSERT, UPDATE, DELETE, DDL). \
         Blocked on read-only connections. May require user approval via tool policy."
    }

    fn llm_description(&self) -> Option<String> {
        let connections = self.config.try_lock().ok()?;
        if connections.connections.is_empty() {
            return None;
        }
        let mut lines = Vec::new();
        for (conn_id, entry) in &connections.connections {
            if !entry.enabled {
                continue;
            }
            let ro = if entry.read_only {
                " [read-only, query only]"
            } else {
                ""
            };
            lines.push(format!("  - `{conn_id}` ({}){}", entry.db_type, ro));
        }
        if lines.is_empty() {
            return None;
        }
        let conn_list = lines.join("\n");
        Some(format!(
            "Execute SQL against a database connection.\n\n\
             Available connections:\n{conn_list}\n\n\
             Actions: query (SELECT/WITH/EXPLAIN), execute (mutations — blocked on read-only)."
        ))
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "\"query\" for read-only or \"execute\" for mutations",
                    "enum": ["query", "execute"]
                },
                "connection_id": {
                    "type": "string",
                    "description": "Database connection ID"
                },
                "sql": {
                    "type": "string",
                    "description": "SQL statement to run"
                }
            },
            "required": ["action", "connection_id", "sql"]
        })
    }

    async fn execute_text(&self, params: Value) -> Result<String, ToolError> {
        let action = required_string(&params, "action")?;
        let connection_id = required_string(&params, "connection_id")?;
        let sql = required_string(&params, "sql")?;

        let config = self.config.lock().await;
        let entry = config.connections.get(&connection_id).ok_or_else(|| {
            ToolError::InvalidParams(format!("Connection not found: {}", connection_id))
        })?;

        if !entry.enabled {
            return Err(ToolError::PermissionDenied(format!(
                "Database connection '{}' is disabled.",
                entry.name
            )));
        }

        match action.as_str() {
            "query" => {
                let sql_upper = sql.trim().to_uppercase();
                if !sql_upper.starts_with("SELECT")
                    && !sql_upper.starts_with("WITH")
                    && !sql_upper.starts_with("EXPLAIN")
                {
                    return Err(ToolError::PermissionDenied(
                        "db_run action \"query\" only allows SELECT, WITH, and EXPLAIN statements. \
                         Use action \"execute\" for mutations."
                            .to_string(),
                    ));
                }

                Err(ToolError::ExecutionFailed(format!(
                    "db_run is a STUB — no provider driver is wired into the agent tool path. \
                     Connection '{}' ({}) is configured in Integrations → Databases, \
                     but `db_run` does not execute SQL against any of the 6 supported \
                     `DatabaseProviderType`s. The fully wired SQLite path lives in the \
                     WorkStation's Database Manager UI (`work_station::db_browser`); the \
                     agent tool layer is intentionally not yet wired to other providers. \
                     Workaround for SQLite: ask the user to run the query in the Database \
                     Manager UI, or shell out via `bash` to a CLI client. Original SQL: {}",
                    entry.name, entry.db_type, sql
                )))
            }

            "execute" => {
                if entry.read_only {
                    return Err(ToolError::PermissionDenied(format!(
                        "Database connection '{}' is read-only. Cannot execute mutations.",
                        entry.name
                    )));
                }

                Err(ToolError::ExecutionFailed(format!(
                    "db_run is a STUB — no provider driver is wired into the agent tool path. \
                     Connection '{}' ({}) is configured but the agent-facing SQL execution \
                     path is unfinished. The wired SQLite path lives in \
                     `work_station::db_browser`. Original SQL: {}",
                    entry.name, entry.db_type, sql
                )))
            }

            other => Err(ToolError::InvalidParams(format!(
                "Unknown db_run action: \"{}\". Use \"query\" or \"execute\".",
                other
            ))),
        }
    }
}
