//! Debug-only outbound tap for interactive dogfood (`bin/gateway_chat_cli`).
//!
//! Entire module compiles away in release builds (`#[cfg(debug_assertions)]`
//! on every item and on the `mod debug_tap;` declaration in the parent).
//!
//! # Safety contract
//!
//! - Default state: **disarmed**. `is_armed()` returns `false` until an
//!   operator explicitly calls `arm()` (exposed via
//!   `POST /agent/test/gateway/outbound-tap/arm`).
//! - When disarmed, `try_push` does **nothing** — no clone, no lock, no
//!   allocation. Production outbound delivery has zero observable overhead.
//! - When armed, `try_push` clones `(channel, chat_id, content)` into a
//!   bounded ring (capacity `MAX_TAP_BUFFER`) and returns immediately. The
//!   push uses `try_lock`; if the buffer is contended it silently drops the
//!   sample rather than blocking delivery. The real channel send path is
//!   never modified or delayed.
//! - The arm flag is process-local and resets on every restart. There is no
//!   persistence.
//! - Release builds do not carry this code at all — the parent `mod` line is
//!   also `#[cfg(debug_assertions)]`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

const MAX_TAP_BUFFER: usize = 128;

static ARMED: AtomicBool = AtomicBool::new(false);

fn buffer() -> &'static Mutex<Vec<(String, String, String)>> {
    static BUFFER: OnceLock<Mutex<Vec<(String, String, String)>>> = OnceLock::new();
    BUFFER.get_or_init(|| Mutex::new(Vec::with_capacity(MAX_TAP_BUFFER)))
}

/// Arm the tap. Subsequent outbound messages are mirrored until [`disarm`]
/// is called. Idempotent.
pub fn arm() {
    ARMED.store(true, Ordering::Release);
}

/// Disarm the tap. Subsequent outbound messages are no longer mirrored. The
/// currently-buffered samples are retained — call [`drain`] to read them.
/// Idempotent.
pub fn disarm() {
    ARMED.store(false, Ordering::Release);
}

/// Return `true` iff the tap is armed right now.
pub fn is_armed() -> bool {
    ARMED.load(Ordering::Acquire)
}

/// Best-effort tap push. A no-op when disarmed. When armed, clones the three
/// fields into the ring buffer; drops the sample silently if the buffer lock
/// is contended or the ring is already full after eviction.
///
/// This function is intentionally infallible — the caller (the real channel
/// send path) must never be slowed or failed by the tap.
pub fn try_push(channel: &str, chat_id: &str, content: &str) {
    if !is_armed() {
        return;
    }
    let Ok(mut guard) = buffer().try_lock() else {
        return;
    };
    if guard.len() >= MAX_TAP_BUFFER {
        guard.remove(0);
    }
    guard.push((
        channel.to_string(),
        chat_id.to_string(),
        content.to_string(),
    ));
}

/// Snapshot the current buffer. If `clear` is true, the buffer is emptied
/// atomically under the same lock acquisition. Returns an empty vec when the
/// lock is contended — the CLI retries on the next poll.
pub fn drain(clear: bool) -> Vec<(String, String, String)> {
    let Ok(mut guard) = buffer().try_lock() else {
        return Vec::new();
    };
    let snapshot = guard.clone();
    if clear {
        guard.clear();
    }
    snapshot
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    /// Serial guard: the three tests here manipulate the process-global
    /// `ARMED` + buffer in lock-step. Cargo runs unit tests in parallel
    /// threads, so without this mutex two tests would race on the same
    /// static state.
    fn serial() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| StdMutex::new(()))
            .lock()
            .expect("serial lock poisoned")
    }

    fn reset() {
        disarm();
        let mut guard = buffer().lock().unwrap();
        guard.clear();
    }

    #[test]
    fn disarmed_tap_is_noop() {
        let _guard = serial();
        reset();
        assert!(!is_armed());
        try_push("telegram:default", "42", "ignored");
        assert!(drain(true).is_empty());
    }

    #[test]
    fn armed_tap_captures_and_clears() {
        let _guard = serial();
        reset();
        arm();
        try_push("telegram:default", "42", "hello");
        try_push("telegram:default", "42", "world");
        let first = drain(false);
        assert_eq!(first.len(), 2, "read-only drain keeps the buffer");
        let cleared = drain(true);
        assert_eq!(cleared.len(), 2, "clearing drain returns the same snapshot");
        assert!(drain(true).is_empty(), "second clearing drain is empty");
        disarm();
    }

    #[test]
    fn ring_evicts_front_when_full() {
        let _guard = serial();
        reset();
        arm();
        for i in 0..(MAX_TAP_BUFFER + 5) {
            try_push("c", "id", &format!("msg-{i}"));
        }
        let samples = drain(true);
        assert_eq!(samples.len(), MAX_TAP_BUFFER);
        assert_eq!(samples.first().unwrap().2, format!("msg-{}", 5));
        assert_eq!(
            samples.last().unwrap().2,
            format!("msg-{}", MAX_TAP_BUFFER + 4)
        );
        disarm();
    }
}
