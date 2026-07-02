//! Session-scoped tracking for workspace memories already injected into prompts.

use std::collections::{HashSet, VecDeque};

const DEFAULT_MAX_SURFACED_PROJECT_MEMORIES: usize = 128;

/// Maximum bytes of workspace-memory prompt sections injected per session.
///
/// Mirrors Claude Code's relevant_memories session budget (60KB/session on
/// top of the per-turn/per-file caps). Once exhausted, memory prefetch is
/// skipped entirely for the rest of the session.
pub const MAX_SESSION_MEMORY_BYTES: usize = 60_000;

#[derive(Debug, Clone)]
pub struct WorkspaceMemorySurfaceState {
    surfaced_paths: HashSet<String>,
    insertion_order: VecDeque<String>,
    max_entries: usize,
    /// Total bytes of memory sections injected so far this session.
    injected_bytes: usize,
}

impl Default for WorkspaceMemorySurfaceState {
    fn default() -> Self {
        Self::with_max_entries(DEFAULT_MAX_SURFACED_PROJECT_MEMORIES)
    }
}

impl WorkspaceMemorySurfaceState {
    pub fn with_max_entries(max_entries: usize) -> Self {
        Self {
            surfaced_paths: HashSet::new(),
            insertion_order: VecDeque::new(),
            max_entries,
            injected_bytes: 0,
        }
    }

    pub fn snapshot(&self) -> HashSet<String> {
        self.surfaced_paths.clone()
    }

    /// Record bytes injected into the prompt against the session budget.
    pub fn record_bytes(&mut self, bytes: usize) {
        self.injected_bytes = self.injected_bytes.saturating_add(bytes);
    }

    /// Remaining session injection budget under `cap` bytes (0 when exhausted).
    pub fn remaining_budget(&self, cap: usize) -> usize {
        cap.saturating_sub(self.injected_bytes)
    }

    pub fn record_paths<I>(&mut self, paths: I)
    where
        I: IntoIterator<Item = String>,
    {
        for path in paths {
            self.record_path(path);
        }
    }

    fn record_path(&mut self, path: String) {
        let trimmed_path = path.trim();
        if trimmed_path.is_empty() || self.max_entries == 0 {
            return;
        }

        if !self.surfaced_paths.insert(trimmed_path.to_string()) {
            return;
        }

        self.insertion_order.push_back(trimmed_path.to_string());
        while self.insertion_order.len() > self.max_entries {
            if let Some(evicted_path) = self.insertion_order.pop_front() {
                self.surfaced_paths.remove(&evicted_path);
            }
        }
    }

    #[cfg(test)]
    fn contains(&self, path: &str) -> bool {
        self.surfaced_paths.contains(path)
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.surfaced_paths.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_unique_paths() {
        let mut state = WorkspaceMemorySurfaceState::with_max_entries(8);

        state.record_paths(vec![
            "/tmp/memory-a.md".to_string(),
            "/tmp/memory-a.md".to_string(),
            "  /tmp/memory-b.md  ".to_string(),
        ]);

        assert_eq!(state.len(), 2);
        assert!(state.contains("/tmp/memory-a.md"));
        assert!(state.contains("/tmp/memory-b.md"));
    }

    #[test]
    fn snapshot_is_independent_copy() {
        let mut state = WorkspaceMemorySurfaceState::with_max_entries(8);
        state.record_paths(vec!["/tmp/memory-a.md".to_string()]);

        let mut snapshot = state.snapshot();
        snapshot.insert("/tmp/memory-b.md".to_string());

        assert!(state.contains("/tmp/memory-a.md"));
        assert!(!state.contains("/tmp/memory-b.md"));
    }

    #[test]
    fn evicts_oldest_path_when_capacity_is_reached() {
        let mut state = WorkspaceMemorySurfaceState::with_max_entries(2);

        state.record_paths(vec![
            "/tmp/memory-a.md".to_string(),
            "/tmp/memory-b.md".to_string(),
            "/tmp/memory-c.md".to_string(),
        ]);

        assert_eq!(state.len(), 2);
        assert!(!state.contains("/tmp/memory-a.md"));
        assert!(state.contains("/tmp/memory-b.md"));
        assert!(state.contains("/tmp/memory-c.md"));
    }

    #[test]
    fn zero_capacity_records_nothing() {
        let mut state = WorkspaceMemorySurfaceState::with_max_entries(0);

        state.record_paths(vec!["/tmp/memory-a.md".to_string()]);

        assert_eq!(state.len(), 0);
    }

    #[test]
    fn budget_starts_full_and_drains_with_recorded_bytes() {
        let mut state = WorkspaceMemorySurfaceState::default();

        assert_eq!(
            state.remaining_budget(MAX_SESSION_MEMORY_BYTES),
            MAX_SESSION_MEMORY_BYTES
        );

        state.record_bytes(10_000);
        assert_eq!(
            state.remaining_budget(MAX_SESSION_MEMORY_BYTES),
            MAX_SESSION_MEMORY_BYTES - 10_000
        );

        state.record_bytes(20_000);
        assert_eq!(
            state.remaining_budget(MAX_SESSION_MEMORY_BYTES),
            MAX_SESSION_MEMORY_BYTES - 30_000
        );
    }

    #[test]
    fn budget_saturates_at_zero_when_exhausted() {
        let mut state = WorkspaceMemorySurfaceState::default();

        // Overshoot: slight over-injection is tolerated by design (snapshot
        // and record happen around a concurrently-spawned task), but the
        // remaining budget must clamp at 0 instead of underflowing.
        state.record_bytes(MAX_SESSION_MEMORY_BYTES + 5_000);
        assert_eq!(state.remaining_budget(MAX_SESSION_MEMORY_BYTES), 0);

        state.record_bytes(usize::MAX); // saturating_add must not panic
        assert_eq!(state.remaining_budget(MAX_SESSION_MEMORY_BYTES), 0);
    }
}
