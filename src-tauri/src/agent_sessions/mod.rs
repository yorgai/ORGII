//! Agent Sessions Domain
//!
//! Session management for AI agents (CLI agents, SDE agent, OS agent).
//!
//! ## Structure
//! - `cli`            — CLI agent session lifecycle (parsers, runner, persistence)
//! - `event_pipeline` — Event ingestion, buffering, filtering, streaming, history, statistics
//! - `unified_stats`  — Cross-backend unified session listing, filtering, and statistics
//! - `health`         — Session health checks and stale detection
//! - `stream_recovery`— Crash recovery for streaming messages
//!
//! Session-specific SQLite persistence (event cache + token usage) lives
//! in the `session_persistence` workspace crate; consumers should import
//! from there directly. The `KeySource` enum lives in `core_types::key_source`,
//! and builtin session-id prefix constants live in `core_types::session`
//! (with the lookup helpers in `agent_core::core::definitions::prefix_lookup`).

pub mod cli;
pub mod event_pipeline;
pub mod health;
pub mod stream_recovery;
pub mod unified_stats;
