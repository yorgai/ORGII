//! Remote SQL client commands (PostgreSQL + MySQL via sqlx).
//!
//! Backs the frontend `DatabasePalette` and DB-connection management
//! surfaces. The 6 `#[tauri::command]`s and their helper types/functions
//! live in `commands.rs` rather than the crate root because applying
//! `#[tauri::command]` to functions at the lib-root produces an `E0255
//! __cmd__<fn> defined multiple times` collision (same issue we worked
//! around in `app_window`). Re-exporting from a submodule lets
//! `app::commands::handler_list` reference them as `db_clients::db_sql_*`.

// Building this crate without any engine driver is meaningless — the
// commands would all reject any `db_type`. Refuse at compile time so a
// caller can't accidentally `--no-default-features` themselves into a
// stub crate that silently accepts queries it can never serve.
#[cfg(not(any(feature = "postgres", feature = "mysql")))]
compile_error!(
    "db_clients requires at least one of the `postgres` or `mysql` features. \
     Either keep default features on, or pass --features postgres / --features mysql."
);

pub mod commands;
pub use commands::*;
