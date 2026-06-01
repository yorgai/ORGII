//! Database tool registration: `db_explore`, `db_run`.

use std::collections::HashSet;
use std::sync::Arc;

use crate::tools::impls::database::db_explore::DbExploreTool;
use crate::tools::impls::database::db_run::DbRunTool;
use crate::tools::registry::ToolRegistry;

use super::{register_if_enabled, ToolDeps};

/// Register all database-category tools that `deps` can support.
///
/// Covers: `db_explore`, `db_run`.
pub async fn register(registry: &mut ToolRegistry, deps: &ToolDeps, disabled: &HashSet<String>) {
    // ── Database tools ──
    if let Some(ref db_cfg) = deps.database_config {
        let has_connections = !db_cfg.lock().await.connections.is_empty();
        if has_connections {
            register_if_enabled(
                registry,
                Box::new(DbExploreTool::new(Arc::clone(db_cfg))),
                disabled,
            );
            register_if_enabled(
                registry,
                Box::new(DbRunTool::new(Arc::clone(db_cfg))),
                disabled,
            );
        }
    }
}
