//! DB Browser — Tauri commands for opening/querying arbitrary SQLite files
//! from the WorkStation code editor panel.
//!
//! Replaces the WASM sql.js `SqliteService` / `SqliteProvider` frontend layers.

pub mod commands;
mod ops;
mod pool;
mod types;

pub use commands::{
    db_close, db_delete, db_execute, db_get_table_data, db_get_table_schema, db_get_tables,
    db_insert, db_is_valid_sqlite_file, db_open, db_query, db_update,
};
