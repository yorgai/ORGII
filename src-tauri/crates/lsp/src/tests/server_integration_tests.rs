//! Integration-style tests for `crate::server` that need an async
//! runtime but do NOT need a real LSP child process.
//!
//! Spawning a real LSP binary in unit tests would require one of
//! `rust-analyzer` / `pyright` / `gopls` to be installed on the build
//! host, plus a long warm-up. Instead, these tests target the
//! Phase-1-EOF-draining surface (`drain_pending_on_close`) and the
//! `LogBuffer` cross-task semantics directly. The full process
//! lifecycle (spawn → initialize → shutdown → SIGTERM → SIGKILL) is
//! covered by manual smoke testing and the runtime crash budget; an
//! end-to-end harness with a fake child belongs in a future Phase 14
//! that introduces a stub `ChildProcess` trait.

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use tokio::sync::oneshot;

use crate::log_buffer::{IoKind, LogBuffer};
use crate::server::drain_pending_on_close;

#[tokio::test]
async fn drain_pending_on_close_resolves_all_awaiters_with_recv_error() {
    // Phase 1 contract: when the server's stdout listener exits
    // (process crashed, EOF on the pipe, etc.) we must drop every
    // pending oneshot sender so the per-request awaiters resolve
    // immediately with `RecvError` instead of waiting for the
    // default 30 s request timeout.
    let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>> =
        Arc::new(Mutex::new(HashMap::new()));

    let (tx_a, rx_a) = oneshot::channel();
    let (tx_b, rx_b) = oneshot::channel();
    let (tx_c, rx_c) = oneshot::channel();
    {
        let mut guard = pending.lock();
        guard.insert(1, tx_a);
        guard.insert(2, tx_b);
        guard.insert(3, tx_c);
    }

    drain_pending_on_close(&pending, "rust").await;

    // Map cleared.
    assert!(pending.lock().is_empty());

    // All receivers resolve with `RecvError` immediately. We use
    // `try_recv` on a closed channel to avoid burning real time.
    assert!(rx_a.await.is_err());
    assert!(rx_b.await.is_err());
    assert!(rx_c.await.is_err());
}

#[tokio::test]
async fn drain_pending_on_close_is_a_noop_when_empty() {
    // The cleanup path is unconditional in `shutdown()`: it runs even
    // when the listener already drained the map cleanly. The function
    // must not log a spurious "Cancelling 0 requests" line — and more
    // importantly, must not panic on an already-empty map.
    let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>> =
        Arc::new(Mutex::new(HashMap::new()));

    drain_pending_on_close(&pending, "rust").await;
    assert!(pending.lock().is_empty());
}

#[tokio::test]
async fn log_buffer_is_safe_to_share_across_tasks() {
    // Phase 13 contract: `LogBuffer` is cloned into the stderr-drain
    // task and the stdout-listener task. Both push concurrently with
    // the main thread that issues writes. Verify the bounded-deque
    // remains consistent under concurrent pushers and that no entry
    // is lost (until the cap kicks in).
    let buffer = LogBuffer::new();

    let stderr_buf = buffer.clone();
    let stderr_task = tokio::spawn(async move {
        for index in 0..50 {
            stderr_buf.push(IoKind::StdErr, format!("err {}", index));
        }
    });

    let stdout_buf = buffer.clone();
    let stdout_task = tokio::spawn(async move {
        for index in 0..50 {
            stdout_buf.push(IoKind::StdOut, format!("out {}", index));
        }
    });

    for index in 0..50 {
        buffer.push(IoKind::StdIn, format!("in {}", index));
    }

    stderr_task.await.unwrap();
    stdout_task.await.unwrap();

    let snap = buffer.snapshot();
    // 50 pushes * 3 producers, well under the 500 cap.
    assert_eq!(snap.len(), 150);
    let stdin = snap
        .iter()
        .filter(|line| line.kind == IoKind::StdIn)
        .count();
    let stdout = snap
        .iter()
        .filter(|line| line.kind == IoKind::StdOut)
        .count();
    let stderr = snap
        .iter()
        .filter(|line| line.kind == IoKind::StdErr)
        .count();
    assert_eq!(stdin, 50);
    assert_eq!(stdout, 50);
    assert_eq!(stderr, 50);
}
