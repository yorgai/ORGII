//! Frontend-visible event names emitted by the projects subsystem.
//!
//! Hosts the `DATA_CHANGED_EVENT` Tauri event name. Callers depend on this
//! module so that emitting a "project data changed" notification has no coupling
//! to file system watchers.

/// Tauri event name emitted whenever any project / work item / orchestrator
/// state has been mutated and the frontend should re-fetch.
pub const DATA_CHANGED_EVENT: &str = "orgii-data-changed";
