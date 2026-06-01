//! Project management domain
//!
//! This crate contains project-management functionality:
//! - `projects`: Pure-SQLite project & work item store at
//!   `~/.orgii/projects/projects.db`. Single source of truth.
//! - `orchestrator`: Workflow orchestration state machine.
//! - `lineage`: Code lineage tracking and analysis.
//! - `sync`: Pluggable sync framework — outbox + adapters draining through
//!   a tokio worker.

pub mod lineage;
pub mod orchestrator;
pub mod projects;
pub mod sync;

#[cfg(test)]
mod test_support;
