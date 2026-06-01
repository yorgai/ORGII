//! Rate-limiting action tracker.
//!
//! Tracks actions in a sliding 1-hour window to enforce
//! `max_actions_per_hour` limits on the security policy.

use std::sync::Mutex;
use std::time::Instant;

/// Sliding-window rate limiter (1-hour window).
///
/// Thread-safe via internal `Mutex`. Each `record()` call prunes
/// stale entries (older than 3600s) before counting.
pub struct ActionTracker {
    actions: Mutex<Vec<Instant>>,
}

/// Hard cap on the actions vec to prevent unbounded memory growth.
const MAX_TRACKED_ACTIONS: usize = 10_000;

impl ActionTracker {
    /// Create a new empty tracker.
    pub fn new() -> Self {
        Self {
            actions: Mutex::new(Vec::new()),
        }
    }

    /// Atomically check the rate limit and record an action if under the limit.
    ///
    /// Returns `Ok(current_count)` if the action was recorded,
    /// or `Err(current_count)` if the limit would be exceeded.
    ///
    /// This eliminates the TOCTOU race between separate `count()` + `record()` calls.
    pub fn try_record(&self, limit: usize) -> Result<usize, usize> {
        let mut actions = self
            .actions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let cutoff = Instant::now() - std::time::Duration::from_secs(3600);
        actions.retain(|ts| *ts > cutoff);

        // Safety cap: prevent unbounded growth in pathological cases
        if actions.len() >= MAX_TRACKED_ACTIONS {
            let half = actions.len() / 2;
            actions.drain(..half);
        }

        if actions.len() >= limit {
            return Err(actions.len());
        }

        actions.push(Instant::now());
        Ok(actions.len())
    }

    /// Record an action and return the current count (including this one).
    pub fn record(&self) -> usize {
        let mut actions = self
            .actions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let cutoff = Instant::now() - std::time::Duration::from_secs(3600);
        actions.retain(|ts| *ts > cutoff);

        if actions.len() >= MAX_TRACKED_ACTIONS {
            let half = actions.len() / 2;
            actions.drain(..half);
        }

        actions.push(Instant::now());
        actions.len()
    }

    /// Get the current action count without recording.
    pub fn count(&self) -> usize {
        let mut actions = self
            .actions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let cutoff = Instant::now() - std::time::Duration::from_secs(3600);
        actions.retain(|ts| *ts > cutoff);
        actions.len()
    }

    /// Reset the tracker (clear all recorded actions).
    pub fn reset(&self) {
        let mut actions = self
            .actions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        actions.clear();
    }
}

impl Default for ActionTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for ActionTracker {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ActionTracker")
            .field("count", &self.count())
            .finish()
    }
}
