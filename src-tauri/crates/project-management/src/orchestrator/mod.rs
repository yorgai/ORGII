//! Work Item Orchestrator — deterministic state machine for multi-agent workflows.
//!
//! NOT an LLM agent. This module coordinates SDE → Review → Follow-up pipelines
//! by reading/writing work item frontmatter and launching coding agent sessions.

pub mod branch_health;
pub mod commands;
pub mod diff_stats;
pub mod follow_up;
pub mod proof_of_work;
pub mod recovery;
pub mod state_machine;

#[cfg(test)]
mod tests;
