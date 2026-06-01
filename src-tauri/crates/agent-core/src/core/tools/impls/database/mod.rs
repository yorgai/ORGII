//! Database tools — agent access to configured database connections.
//!
//! Two tools, one file each. Consumers import via deep paths
//! (`impls::database::db_explore::DbExploreTool`,
//! `impls::database::db_run::DbRunTool`) — no flat re-exports, matching
//! the rest of `impls/`.
//!
//! - [`db_explore`] — discover connections, tables, and schemas (read-only metadata)
//! - [`db_run`] — execute SQL queries (SELECT) or mutations (INSERT/UPDATE/DELETE)
//!
//! **Stub status.** `DatabasesConfig` supports six providers (Sqlite,
//! Supabase, Turso, Neon, Postgres, Mysql), and the integrations UI
//! lets users configure connections for all of them. The agent-facing
//! tools here only consume the registry to list connections; live
//! execution paths (`db_run`, `db_explore::list_tables`, `db_explore::schema`)
//! return an explicit `ToolError::ExecutionFailed` naming the wired
//! WorkStation SQLite path (`work_station::db_browser`) instead of
//! fabricating a placeholder result. Wiring real driver paths is a
//! multi-PR job; the error message keeps the agent honest in the
//! meantime.

pub mod db_explore;
pub mod db_run;

use std::sync::Arc;
use tokio::sync::Mutex;

use crate::config::DatabasesConfig;

/// Shared, lock-protected handle to the user's configured database
/// connections. Both tools read this — `db_explore` only reads metadata,
/// `db_run` will additionally dispatch SQL once a provider is wired up.
pub(super) type SharedConfig = Arc<Mutex<DatabasesConfig>>;
