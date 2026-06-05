//! Process-Wide SQLite Writer Serialization
//!
//! SQLite WAL mode allows concurrent readers but only **one writer at a
//! time** per database file. The default contention strategy — let every
//! caller open its own `Connection`, run `BEGIN DEFERRED`, and race for
//! the first INSERT — has two failure modes under streaming agent load:
//!
//! 1. **`SQLITE_BUSY` races at first-statement time.** `BEGIN DEFERRED`
//!    does not acquire the writer lock; the second writer only finds out
//!    it lost at its first INSERT and returns immediately with
//!    `SQLITE_BUSY` instead of waiting on `busy_timeout`.
//! 2. **`busy_timeout` exhaustion with deeply nested critical sections.**
//!    Hot writers like `save_events` rewrite many rows, then call
//!    `normalize_session_sequences` (per-row UPDATEs), then commit, then
//!    open *another* connection for `rebuild_turn_index`. With N
//!    concurrent writers all racing, the wait queue exceeds 15s and the
//!    retry layer exhausts after ~45s, logging
//!    `database is locked` and dropping the write.
//!
//! ## Solution
//!
//! Wrap every write transaction against `sessions.db` in a single
//! process-wide [`parking_lot::Mutex`]. Concurrent writers queue in Rust
//! (FIFO under uncontended `parking_lot` semantics, fair under heavy
//! contention) and the file lock sees exactly one writer at a time.
//!
//! Readers are **not** routed through this mutex — they continue to use
//! plain `get_connection()` and remain fully concurrent via WAL.
//!
//! ## Usage
//!
//! Write paths:
//!
//! ```ignore
//! use database::db::{get_connection, with_sessions_writer};
//!
//! with_sessions_writer(|| {
//!     let conn = get_connection()?;
//!     let tx = begin_immediate(&conn)?;
//!     // ... INSERT / UPDATE / DELETE ...
//!     tx.commit()
//! })?;
//! ```
//!
//! Read paths:
//!
//! ```ignore
//! let conn = get_connection()?;
//! conn.query_row("SELECT ...", [], |row| row.get(0))?;
//! ```
//!
//! ## Cross-process contention
//!
//! The mutex is **in-process only**. A second `orgii` instance running
//! against the same `~/.orgii/sessions.db` would not be serialized by it
//! and would fall back to `busy_timeout` (raised to 15s for that case).
//! In practice ORGII is a single-instance Tauri app, so cross-process
//! contention is limited to manual `sqlite3` inspection.

use std::cell::Cell;

use parking_lot::Mutex;
use rusqlite::{Connection, Result as SqliteResult, Transaction, TransactionBehavior};

/// Single-slot writer lock for `~/.orgii/sessions.db`.
///
/// `parking_lot::Mutex` is preferred over `std::sync::Mutex` because:
/// - It does not poison on panic (a panicking write would otherwise
///   permanently brick all subsequent writes process-wide).
/// - It is ~3× faster on the uncontended path, which matters for the
///   thousands of small writes per second the event pipeline emits.
fn sessions_writer_mutex() -> &'static Mutex<()> {
    static MUTEX: Mutex<()> = parking_lot::const_mutex(());
    &MUTEX
}

thread_local! {
    /// Per-thread re-entrancy guard.
    ///
    /// Some helper functions (`rebuild_turn_index`, `normalize_session_sequences`)
    /// are called both standalone and from inside an already-locked
    /// `save_events`. Without re-entrancy support the nested call would
    /// deadlock against the same thread that holds the mutex.
    ///
    /// `Cell<u32>` is a refcount: outer call increments, inner call sees
    /// the non-zero value and skips locking, both decrement on drop.
    /// This is safe because the underlying mutex is held across all
    /// nested calls on the same thread by the outer guard.
    static SESSIONS_WRITER_DEPTH: Cell<u32> = const { Cell::new(0) };
}

/// RAII guard for the sessions writer mutex.
///
/// Holds the `parking_lot::MutexGuard<'static, ()>` at depth 0 and bumps
/// `SESSIONS_WRITER_DEPTH` so re-entrant calls on the same thread skip
/// re-locking.
pub struct SessionsWriterGuard {
    _outer: Option<parking_lot::MutexGuard<'static, ()>>,
}

impl SessionsWriterGuard {
    fn acquire() -> Self {
        let depth = SESSIONS_WRITER_DEPTH.with(|cell| {
            let depth = cell.get();
            cell.set(depth + 1);
            depth
        });
        let outer = if depth == 0 {
            Some(sessions_writer_mutex().lock())
        } else {
            None
        };
        Self { _outer: outer }
    }
}

impl Drop for SessionsWriterGuard {
    fn drop(&mut self) {
        SESSIONS_WRITER_DEPTH.with(|cell| {
            let depth = cell.get();
            debug_assert!(depth > 0, "SESSIONS_WRITER_DEPTH underflow");
            cell.set(depth.saturating_sub(1));
        });
    }
}

/// Acquire the sessions writer mutex and return an RAII guard.
///
/// Prefer [`with_sessions_writer`] (closure form) — it is harder to
/// forget to release. Use this raw form only when the closure shape
/// does not fit (e.g. branching control flow that must return early
/// without dropping the guard prematurely).
pub fn sessions_writer_guard() -> SessionsWriterGuard {
    SessionsWriterGuard::acquire()
}

/// Run a write closure while holding the sessions writer mutex.
///
/// The closure should open its own connection, run `BEGIN IMMEDIATE`,
/// perform writes, and commit. Read-only work can stay outside the
/// closure to keep the critical section short.
pub fn with_sessions_writer<F, T>(func: F) -> T
where
    F: FnOnce() -> T,
{
    let _guard = SessionsWriterGuard::acquire();
    func()
}

/// Begin an IMMEDIATE-mode transaction on `conn`.
///
/// `BEGIN IMMEDIATE` acquires the writer lock at transaction start,
/// so a second writer queues on `busy_timeout` rather than racing to
/// the first INSERT and returning `SQLITE_BUSY` mid-statement. Inside
/// the process-wide writer mutex this is mostly defensive (only one
/// writer is ever in the critical section), but it also protects
/// against cross-process contention and against accidental calls to
/// `save_events` outside the guard.
pub fn begin_immediate(conn: &Connection) -> SqliteResult<Transaction<'_>> {
    // `Connection::transaction_with_behavior` requires `&mut self`, which
    // forces every caller to hold a `&mut Connection` for the entire
    // transaction body. That collides with helper calls that take
    // `&Connection` (e.g. `normalize_session_sequences`,
    // `update_session_metadata`) inside the same tx.
    //
    // `Transaction::new_unchecked` does exactly the same `BEGIN IMMEDIATE`
    // that `transaction_with_behavior` does, but only requires
    // `&Connection`. The "unchecked" qualifier refers to nested
    // transactions: rusqlite cannot catch nesting at the type level when
    // you go through this path, so callers must ensure they do not start
    // a transaction while another is open on the same connection.
    // Inside the writer mutex this is enforced by code structure (each
    // critical section opens exactly one tx).
    Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writer_guard_is_reentrant_on_same_thread() {
        // Two nested guards on the same thread must not deadlock.
        let _outer = sessions_writer_guard();
        let _inner = sessions_writer_guard();
        // Drop order: inner, then outer.
    }

    #[test]
    fn writer_closure_returns_value() {
        let value = with_sessions_writer(|| 42_u32);
        assert_eq!(value, 42);
    }

    #[test]
    fn writer_closure_supports_nesting() {
        let value = with_sessions_writer(|| with_sessions_writer(|| "nested"));
        assert_eq!(value, "nested");
    }
}
