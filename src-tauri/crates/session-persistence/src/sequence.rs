//! In-memory sequence counter cache for session event ordering
//!
//! Maintains a per-session monotonically increasing sequence number so that
//! events written from multiple async tasks are stored in a deterministic order.
//!
//! The global `SEQUENCE_COUNTERS` map is capped at `MAX_SEQUENCE_ENTRIES` (500)
//! to prevent unbounded growth in long-running processes.

use rusqlite::{Connection, Result as SqliteResult};
use std::collections::HashMap;
use std::sync::Mutex;
const MAX_SEQUENCE_ENTRIES: usize = 500;

static SEQUENCE_COUNTERS: std::sync::LazyLock<Mutex<HashMap<String, i64>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// Get or initialize the next history sequence number for a session
pub(super) fn get_next_sequence(conn: &Connection, session_id: &str) -> SqliteResult<i64> {
    // Check in-memory cache first
    {
        let counters = SEQUENCE_COUNTERS.lock().unwrap();
        if let Some(&seq) = counters.get(session_id) {
            return Ok(seq);
        }
    }

    // Initialize from database
    let max_seq: Option<i64> = conn
        .query_row(
            "SELECT MAX(history_sequence) FROM events WHERE session_id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .unwrap_or(None);

    let next_seq = max_seq.unwrap_or(-1) + 1;

    // Cache it
    {
        let mut counters = SEQUENCE_COUNTERS.lock().unwrap();
        counters.insert(session_id.to_string(), next_seq);
    }

    Ok(next_seq)
}

/// Increment and get the next sequence number
pub(super) fn increment_sequence(session_id: &str) -> i64 {
    let mut counters = SEQUENCE_COUNTERS.lock().unwrap();

    // Evict oldest entries if cache is too large (FIFO by insertion order)
    if counters.len() >= MAX_SEQUENCE_ENTRIES && !counters.contains_key(session_id) {
        if let Some(oldest_key) = counters.keys().next().cloned() {
            counters.remove(&oldest_key);
        }
    }

    let seq = counters.entry(session_id.to_string()).or_insert(0);
    let current = *seq;
    *seq += 1;
    current
}

/// Reset sequence counter for a session (used after truncate/clear)
pub(super) fn reset_sequence(session_id: &str, new_value: i64) {
    let mut counters = SEQUENCE_COUNTERS.lock().unwrap();
    counters.insert(session_id.to_string(), new_value);
}
