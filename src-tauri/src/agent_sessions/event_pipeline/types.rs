//! Event Store Types (compatibility re-export).
//!
//! Canonical definitions live in `core_types::session_event`. This shim
//! keeps existing
//! `crate::agent_sessions::event_pipeline::types::*` imports compiling
//! while `agent_core` and other leaf consumers depend on `core_types`
//! directly.
//!
//! The `EXTRACTOR` inversion-of-control slot in `core_types` is wired
//! once at startup from
//! `agent_sessions::event_pipeline::extractors::register_extractor_hook`
//! so that `SessionEvent::recompute_extracted` keeps producing typed
//! envelopes for the rendering layer.

pub use core_types::session_event::*;

#[cfg(test)]
#[path = "tests/types_tests.rs"]
mod tests;
