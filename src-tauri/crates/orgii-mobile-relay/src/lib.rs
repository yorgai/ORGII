//! ORGII mobile remote control relay server.
//!
//! Standalone axum server that routes RPC frames between paired desktop
//! and mobile peers.
//!
//! ## What lives here
//!
//! - HTTP endpoints (`/healthz`, `/readyz`, `/version`) for liveness
//!   probes and version negotiation
//! - The shared [`AppState`] passed to every handler
//! - The [`server::run`] entrypoint that boots the listener with
//!   graceful Ctrl+C shutdown
//!
//! ## What does NOT live here (yet)
//!
//! - WebSocket pairing / relay handlers — Phase 2
//! - SQLite-backed storage layer — Phase 2
//! - Per-user routing actors (`UserHub`) — Phase 2
//!
//! Wire types come from `orgii_protocol`; this crate must not redefine
//! them.

pub mod audit;
pub mod cli;
pub mod config;
pub mod error;
pub mod handlers;
pub mod hub;
pub mod routes;
pub mod server;
pub mod state;
pub mod storage;

pub use config::AppConfig;
pub use error::RelayError;
pub use state::AppState;

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
