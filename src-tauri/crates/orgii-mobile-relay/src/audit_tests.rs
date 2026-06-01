//! Unit tests for [`AuditWriter`]. The storage-level contract is
//! covered in `storage::storage_tests`; here we focus on the writer
//! semantics: non-blocking record, query passthrough, and limit
//! handling on the [`AuditQuery`] side.

use std::sync::Arc;

use orgii_protocol::{DeviceId, UserId};

use super::*;
use crate::storage::{MemoryStorage, Storage};

fn sample_record(user: &str, ts_ms: i64) -> AuditRecord {
    AuditRecord {
        id: 0,
        ts_ms,
        user_id: UserId::new(user),
        device_id: DeviceId::new("dev-1"),
        command: "session.send_message".into(),
        ok: true,
        latency_ms: 12,
        error: None,
    }
}

#[tokio::test]
async fn record_persists_through_to_storage() {
    let storage: Arc<dyn Storage> = Arc::new(MemoryStorage::new());
    let writer = AuditWriter::new(storage.clone());

    writer.record(sample_record("u-1", 1_700_000_000_000));

    // The spawn is independent; yield until storage has the row. We
    // poll a bounded number of times instead of sleeping a fixed
    // duration so the test is fast on a free machine and tolerant on
    // a contended one.
    for _ in 0..50 {
        let rows = storage
            .audit_query(AuditQuery::for_user(UserId::new("u-1")))
            .await
            .unwrap();
        if !rows.is_empty() {
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].command, "session.send_message");
            assert!(rows[0].id > 0, "storage must assign an id on insert");
            return;
        }
        tokio::task::yield_now().await;
    }
    panic!("audit row never reached storage after 50 yields");
}

#[tokio::test]
async fn record_is_non_blocking() {
    // Calling `record()` many times in tight succession must not
    // accumulate the underlying storage cost on the calling task —
    // each `record` returns after a `tokio::spawn`, which is O(µs).
    // We assert a generous timing budget (10ms for 100 calls) so the
    // test is robust on contended CI machines but still catches a
    // regression where `record` accidentally awaits the storage call
    // synchronously.
    let storage: Arc<dyn Storage> = Arc::new(MemoryStorage::new());
    let writer = AuditWriter::new(storage.clone());

    let start = std::time::Instant::now();
    for ts in 0..100i64 {
        writer.record(sample_record("u-fast", ts));
    }
    let elapsed = start.elapsed();
    assert!(
        elapsed < std::time::Duration::from_millis(10),
        "record() must not await the storage write, 100 calls took {elapsed:?}"
    );

    // Drain spawned tasks before the test ends so storage actually
    // receives them — otherwise we'd be racing the test runtime
    // shutdown.
    for _ in 0..200 {
        let rows = storage
            .audit_query(AuditQuery::for_user(UserId::new("u-fast")))
            .await
            .unwrap();
        if rows.len() == 100 {
            return;
        }
        tokio::task::yield_now().await;
    }
    panic!("only some of the spawned audit writes completed");
}

#[tokio::test]
async fn query_passthrough_returns_storage_rows() {
    let storage: Arc<dyn Storage> = Arc::new(MemoryStorage::new());
    let writer = AuditWriter::new(storage.clone());

    storage
        .audit_record(sample_record("u-q", 100))
        .await
        .unwrap();
    storage
        .audit_record(sample_record("u-q", 200))
        .await
        .unwrap();

    let rows = writer
        .query(AuditQuery::for_user(UserId::new("u-q")))
        .await
        .unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].ts_ms, 200, "newest first");
}

#[test]
fn effective_limit_uses_default_when_unset() {
    let q = AuditQuery::for_user(UserId::new("u"));
    assert_eq!(q.effective_limit(), AUDIT_QUERY_DEFAULT_LIMIT);
}

#[test]
fn effective_limit_clamps_to_max() {
    let q = AuditQuery {
        limit: Some(50_000),
        ..AuditQuery::for_user(UserId::new("u"))
    };
    assert_eq!(q.effective_limit(), AUDIT_QUERY_MAX_LIMIT);
}

#[test]
fn effective_limit_passes_small_value_through() {
    let q = AuditQuery {
        limit: Some(7),
        ..AuditQuery::for_user(UserId::new("u"))
    };
    assert_eq!(q.effective_limit(), 7);
}
