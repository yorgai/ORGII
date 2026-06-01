//! Key storage for CLI agents and API providers
//!
//! Credentials stored at `~/.orgii/credentials.json`.
//! Thread-safe with file locking for concurrent access.

mod agent_env_builder;
mod service;
mod store;
mod types;

pub use service::*;
pub use store::*;
pub use types::*;

#[cfg(test)]
mod tests;
