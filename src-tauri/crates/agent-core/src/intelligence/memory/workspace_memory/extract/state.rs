//! Per-session extraction state + read-only debug snapshot.
//!
//! The mutable struct lives in its own module so the gating helpers
//! (`gating`) and the forked-agent runner (`runner`) are the only crates
//! that can mutate its fields. External callers go through the public
//! `snapshot()` getter or the `is_in_progress` accessor below.

/// Per-session state for memory extraction. Held inside the processor.
///
/// The `pending_messages` field carries coalesce semantics — see
/// `gating::stash_pending` / `gating::take_pending`.
#[derive(Debug, Default)]
pub struct ExtractMemoriesState {
    /// Index of the last message processed (cursor).
    /// `None` means no extraction has run yet for this session.
    pub(super) last_processed_idx: Option<usize>,

    /// True while extraction is in progress (overlap guard).
    pub(super) in_progress: bool,

    /// Turns since last successful extraction (for throttling).
    pub(super) turns_since_extraction: u32,

    /// Messages stashed by a turn that arrived while extraction was still
    /// running. The processor's spawned task drains this after each run
    /// and, if present, loops for a trailing extraction. Always holds the
    /// *latest* stash — older stashes are overwritten since only the most
    /// recent transcript matters.
    pub(super) pending_messages: Option<Vec<serde_json::Value>>,
}

/// Read-only snapshot of [`ExtractMemoriesState`] for debug / E2E endpoints.
///
/// The struct itself keeps its fields private so the per-turn logic is the
/// only thing that can mutate them. Tests need to assert things like
/// "cursor advanced after this turn", so this snapshot exposes the same
/// fields as plain values that can be serialized over HTTP.
#[derive(Debug, Clone, Copy)]
pub struct ExtractMemoriesStateSnapshot {
    pub last_processed_idx: Option<usize>,
    pub in_progress: bool,
    pub turns_since_extraction: u32,
    pub pending_messages_len: Option<usize>,
}

impl ExtractMemoriesState {
    /// Return a cheap, read-only snapshot of all gating fields.
    ///
    /// Used by the debug-only `GET /agent/test/em-state/:session_id`
    /// endpoint to prove cross-turn persistence in E2E: the assertion
    /// needs an observable, not just a "behavior should happen" claim.
    pub fn snapshot(&self) -> ExtractMemoriesStateSnapshot {
        ExtractMemoriesStateSnapshot {
            last_processed_idx: self.last_processed_idx,
            in_progress: self.in_progress,
            turns_since_extraction: self.turns_since_extraction,
            pending_messages_len: self.pending_messages.as_ref().map(|v| v.len()),
        }
    }

    /// Accessor for the overlap-guard flag. Only the processor needs
    /// this (to decide whether to stash for a trailing run); the
    /// extractor itself reads the field directly.
    pub fn is_in_progress(&self) -> bool {
        self.in_progress
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_state_default() {
        let state = ExtractMemoriesState::default();
        assert!(state.last_processed_idx.is_none());
        assert!(!state.in_progress);
        assert_eq!(state.turns_since_extraction, 0);
        assert!(state.pending_messages.is_none());
    }

    #[test]
    fn test_is_in_progress_accessor() {
        let mut state = ExtractMemoriesState::default();
        assert!(!state.is_in_progress());
        state.in_progress = true;
        assert!(state.is_in_progress());
    }
}
