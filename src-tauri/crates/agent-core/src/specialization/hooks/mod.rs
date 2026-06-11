//! Lifecycle Hook System
//!
//! Hooks allow users to run custom commands, inject prompts, or fire webhooks
//! at key agent lifecycle events.
//!
//! Configuration is loaded from `.orgii/hooks.json` in the workspace root.
//!
//! ## 10 events
//!
//! PreToolUse, PostToolUse, PostToolUseFailure, SessionStart, SessionStop,
//! NotificationReceived, Stop, PrePromptBuild, PreCompaction, PostCompaction
//!
//! ## 3 hook types
//!
//! - `command` — shell command with env var context
//! - `prompt` — inject text into system prompt
//! - `http` — send JSON webhook to a URL

pub mod config;
pub mod events;
pub mod executor;

pub use events::HookEvent;
pub use executor::HookExecutor;

#[cfg(test)]
mod tests;
