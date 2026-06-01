//! Layer 2b: External integrations.
//!
//! Chat channel connectors (Telegram, Discord, Slack, etc.),
//! decoupled message gateway, and rule-based automation engine.

pub mod automation;
pub mod channels;
pub mod config;
pub mod gateway;
pub mod patch;

pub use config::{IntegrationsConfig, IntegrationsError};
// `IntegrationsConfigPatch` is reached only through its deeper
// `integrations::patch::IntegrationsConfigPatch` path (definitions/commands.rs),
// so we don't flatten it onto `integrations::*`.
