//! L3 offline consolidation engine.
//!
//! The write path (`reflection.rs`, orchestrator bridge) appends
//! `status = 'pending'` rows. This module drains the pending queue and
//! decides — per row — whether to ADD / UPDATE / DELETE or do nothing,
//! following mem0's canonical memory-decision interface.
//!
//! ## Flow
//!
//! 1. `entry::consolidate(scope, trigger)` — entry point
//!    - Loads all `status='pending'` rows for the scope
//!    - Groups them by `account_id` (per plan §3.2 — billing correctness)
//!    - For each group, resolves a provider + embedding mode, calls
//!      `batch::consolidate_batch`
//!    - Records one `consolidation_runs` row per group
//! 2. `batch::consolidate_batch(ctx, batch)` — per-account inner loop
//!    - For each pending row: hash-reinforce short-circuit, candidate
//!      recall (Mode A via `recall::recall_mode_embedding`, Mode B via
//!      `recall::recall_mode_manifest`), mem0 decision via
//!      `decision::parse_decision`, state transition via `events::apply_event`.
//!
//! Mode A vs Mode B is decided once per batch by probing the embedding
//! provider in `batch::resolve_embed_mode`. Both modes converge on the
//! same LLM decision step — only the candidate shortlisting differs
//! (plan §§3.4, 3.6, 3.7).
//!
//! ## Submodule layout
//!
//! - `types`     — `ConsolidationTrigger`, `CandidateMode`
//! - `decision`  — mem0 prompt + JSON schema + fuzzy ID correction
//! - `recall`    — Mode A (embedding) / Mode B (salience manifest)
//! - `events`    — apply_event state-machine + `EventCounts`
//! - `batch`     — per-batch loop + provider/mode resolution
//! - `entry`     — `consolidate()` public entry point
//! - `triggers`  — lazy / forced / idle policy
//! - `tick`      — background `spawn_consolidation_tick`

mod batch;
mod decision;
mod entry;
mod events;
mod recall;
mod tick;
mod triggers;
mod types;

#[cfg(test)]
pub(crate) mod tests_support;

// `CandidateMode` is reached only from `batch.rs` via `super::types::CandidateMode`,
// so we don't flatten it here. `ConsolidationTrigger` is the only enum the
// outside world (`memory::commands`, gateway hooks) names directly.
pub use entry::consolidate;
pub use events::EventCounts;
pub use tick::spawn_consolidation_tick;
pub use types::ConsolidationTrigger;
