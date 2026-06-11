//! Dev Record
//!
//! Tracks development activity across all tools (Orgii editor, external IDEs, terminal,
//! agent) using a heartbeat model. Data is stored locally in SQLite for privacy.
//!
//! ## Architecture
//!
//! - **Heartbeat model**: Record one event per ~2 minutes of activity (like WakaTime)
//! - **IDE detection**: Process scanning via `sysinfo` to detect running editors
//! - **File attribution**: Correlate file changes with the frontmost IDE
//! - **Local-only**: All data in `~/.orgii/sessions.db`, never sent to backend
//!
//! ## IDE modules
//!
//! - `cursor/` — Cursor IDE session cache + bubble history reader
//! - `claude_code/` — Claude Code session cache + JSONL history reader
//! - `codex/` — Codex app JSONL history reader
//! - `windsurf/` — Windsurf vscdb history reader
//!
//! ## Shared modules
//!
//! - `types` — Typed enums and structs
//! - `schema` — SQLite table definitions
//! - `collector` — Heartbeat ingestion with dedup and rate-limiting
//! - `ide_detector` — External IDE process scanning (real-time)
//! - `ide_attribution` — IDE artifact scanning for commit attribution (retroactive)
//! - `heartbeat_import` — Heartbeat backfill from IDE history files and AI CLI logs
//! - `retroactive` — Offline activity backfill from git log + IDE attribution
//! - `queries` — Aggregation and summary queries
//! - `commands` — Tauri command handlers

pub mod claude_code;
pub mod cli_session_db;
pub mod codex;
pub mod collector;
pub mod commands;
pub mod cursor;
pub mod heartbeat_import;
pub mod ide_attribution;
pub mod ide_detector;
pub mod imported_history;
pub mod queries;
pub mod retroactive;
pub mod schema;
pub mod types;
pub mod windsurf;

pub use commands::*;

#[cfg(test)]
mod tests;
