//! SessionStoreManager — session metadata + LRU eviction policy
//!
//! Each session now owns its own `EventStore` instance (held by
//! `EventStoreState::stores`). This manager is the pure policy layer:
//!
//! - tracks which session is currently *active* (default target when commands
//!   omit `session_id`),
//! - keeps a pin set so long-running agent sessions are never evicted,
//! - maintains an LRU order of "idle" sessions and enforces max cache size.
//!
//! All event data lives in the per-session stores. This struct does not touch
//! `SessionEvent` values — it only decides which session ids are eligible for
//! eviction from the outer `HashMap<String, EventStore>`.

use std::collections::{HashMap, HashSet, VecDeque};

/// Maximum number of idle (unpinned) sessions kept in the LRU ring.
const MAX_CACHED_IDLE: usize = 15;
/// Total cap across idle + pinned.
const MAX_TOTAL_CACHED: usize = 25;

/// Metadata about a cached session. Events live in
/// `EventStoreState::stores[session_id]`; this struct only tracks "when was
/// this last touched" so the LRU policy has a tiebreaker.
#[derive(Debug, Clone)]
struct SessionMeta {
    touched_at_ms: u64,
}

/// Session registry + LRU policy engine.
pub struct SessionStoreManager {
    /// All known sessions (active + idle + pinned). Mirrors the key set of the
    /// outer stores `HashMap` — kept in sync by the `EventStoreState` helpers.
    known: HashMap<String, SessionMeta>,
    /// Pinned sessions are never LRU-evicted (agent currently running).
    pinned: HashSet<String>,
    /// FIFO of unpinned sessions in touched order (front = oldest).
    lru_order: VecDeque<String>,
    /// The currently active session (default target when `session_id` is
    /// omitted by Tauri commands).
    active_id: Option<String>,
}

impl Default for SessionStoreManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionStoreManager {
    pub fn new() -> Self {
        Self {
            known: HashMap::with_capacity(MAX_TOTAL_CACHED),
            pinned: HashSet::new(),
            lru_order: VecDeque::with_capacity(MAX_CACHED_IDLE),
            active_id: None,
        }
    }

    pub fn active_id(&self) -> Option<&str> {
        self.active_id.as_deref()
    }

    /// Set the active session. If the session isn't known yet, it's registered
    /// and touched. Returns the ids that should be evicted from the outer
    /// stores map as a result of LRU pressure.
    pub fn set_active(&mut self, session_id: &str) -> Vec<String> {
        if let Some(ref old) = self.active_id {
            if old == session_id {
                return Vec::new();
            }
            // Demote the previous active session into the LRU ring.
            self.touch_lru(old.clone());
        }
        self.active_id = Some(session_id.to_string());
        self.register(session_id);
        self.enforce_limits()
    }

    /// Register a session (on first write / subscription). Idempotent.
    pub fn register(&mut self, session_id: &str) {
        self.known
            .entry(session_id.to_string())
            .and_modify(|m| m.touched_at_ms = now_ms())
            .or_insert_with(|| SessionMeta {
                touched_at_ms: now_ms(),
            });
        if !self.pinned.contains(session_id)
            && self.active_id.as_deref() != Some(session_id)
            && !self.lru_order.iter().any(|id| id == session_id)
        {
            self.lru_order.push_back(session_id.to_string());
        }
    }

    /// Pin a session (agent started running). Pinned sessions skip LRU eviction.
    pub fn pin(&mut self, session_id: &str) {
        self.register(session_id);
        self.pinned.insert(session_id.to_string());
        self.remove_lru(session_id);
    }

    /// Unpin a session (agent finished). Session becomes eligible for eviction.
    pub fn unpin(&mut self, session_id: &str) -> Vec<String> {
        self.pinned.remove(session_id);
        if self.known.contains_key(session_id) && self.active_id.as_deref() != Some(session_id) {
            self.touch_lru(session_id.to_string());
        }
        self.enforce_limits()
    }

    pub fn is_pinned(&self, session_id: &str) -> bool {
        self.pinned.contains(session_id)
    }

    pub fn has_known(&self, session_id: &str) -> bool {
        self.known.contains_key(session_id)
    }

    /// Mark a session as recently touched (LRU promotion).
    pub fn touch(&mut self, session_id: &str) {
        self.register(session_id);
    }

    /// Explicitly forget a session. Caller is responsible for removing the
    /// backing store entry.
    pub fn evict(&mut self, session_id: &str) {
        self.known.remove(session_id);
        self.pinned.remove(session_id);
        self.remove_lru(session_id);
        if self.active_id.as_deref() == Some(session_id) {
            self.active_id = None;
        }
    }

    pub fn clear(&mut self) {
        self.known.clear();
        self.pinned.clear();
        self.lru_order.clear();
        self.active_id = None;
    }

    pub fn known_count(&self) -> usize {
        self.known.len()
    }

    pub fn pinned_count(&self) -> usize {
        self.pinned.len()
    }

    pub fn idle_count(&self) -> usize {
        self.lru_order.len()
    }

    // =========================================================================
    // LRU management
    // =========================================================================

    fn touch_lru(&mut self, session_id: String) {
        if self.pinned.contains(&session_id) {
            return;
        }
        self.remove_lru(&session_id);
        self.lru_order.push_back(session_id.clone());
        if let Some(meta) = self.known.get_mut(&session_id) {
            meta.touched_at_ms = now_ms();
        }
    }

    fn remove_lru(&mut self, session_id: &str) {
        self.lru_order.retain(|id| id != session_id);
    }

    /// Returns session ids that should be dropped from the backing stores.
    fn enforce_limits(&mut self) -> Vec<String> {
        let mut evicted = Vec::new();
        while self.lru_order.len() > MAX_CACHED_IDLE {
            if let Some(oldest) = self.lru_order.pop_front() {
                if self.active_id.as_deref() != Some(&oldest) && !self.pinned.contains(&oldest) {
                    self.known.remove(&oldest);
                    evicted.push(oldest);
                }
            } else {
                break;
            }
        }
        while self.known.len() > MAX_TOTAL_CACHED {
            if let Some(oldest) = self.lru_order.pop_front() {
                if self.active_id.as_deref() != Some(&oldest) && !self.pinned.contains(&oldest) {
                    self.known.remove(&oldest);
                    evicted.push(oldest);
                }
            } else {
                break;
            }
        }
        evicted
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
#[path = "tests/session_manager_tests.rs"]
mod tests;
