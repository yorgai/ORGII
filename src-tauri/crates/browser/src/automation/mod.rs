//! Browser automation command surface.
//!
//! Frontend-facing Tauri commands use `AgentBrowserController` from
//! `shared_state` so agent tools and workstation browser controls operate on
//! the same selected browser engine.

pub mod commands;

pub use shared_state::browser_state::AgentBrowserController;

#[cfg(test)]
#[path = "tests/automation_tests.rs"]
mod tests;
