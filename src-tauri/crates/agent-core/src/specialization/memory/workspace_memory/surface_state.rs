//! Session-scoped tracking for workspace memories already injected into prompts.

use std::collections::{HashSet, VecDeque};

const DEFAULT_MAX_SURFACED_PROJECT_MEMORIES: usize = 128;

#[derive(Debug, Clone)]
pub struct WorkspaceMemorySurfaceState {
    surfaced_paths: HashSet<String>,
    insertion_order: VecDeque<String>,
    max_entries: usize,
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
        }
    }

    pub fn snapshot(&self) -> HashSet<String> {
        self.surfaced_paths.clone()
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
}
