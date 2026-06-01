//! End-to-end tests for `GET /audit`.
//!
//! Construction mirrors `devices_tests.rs` exactly: the `MemoryStorage`
//! backend is wired into a standalone `Router` that mounts only the
//! audit route, so these tests don't depend on the ordering of the
//! main `routes::build_router` (which is being touched in parallel by
//! the WS work).

use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use orgii_protocol::{DeviceId, UserId};
use tower::ServiceExt;

use crate::audit::AuditRecord;
use crate::handlers::audit_handler::{
    audit_routes, AUDIT_RECORD_COMMAND_MAX_LEN, AUDIT_RECORD_LATENCY_MAX_MS,
};
use crate::hub::UserHubRegistry;
use crate::state::AppState;
use crate::storage::{MemoryStorage, Storage};

fn router_with_state() -> (axum::Router, Arc<dyn Storage>) {
    let storage: Arc<dyn Storage> = Arc::new(MemoryStorage::new());
    let registry = Arc::new(UserHubRegistry::new());
    let state = AppState::new(storage.clone(), registry);
    let router = axum::Router::new().merge(audit_routes()).with_state(state);
    (router, storage)
}

fn req(uri: &str, user: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder().method("GET").uri(uri);
    if let Some(u) = user {
        builder = builder.header("x-user-id", u);
    }
    builder.body(Body::empty()).expect("build request")
}

fn record_body(
    user_id: &str,
    device_id: &str,
    command: &str,
    ok: bool,
    latency_ms: u64,
    ts_ms: i64,
) -> serde_json::Value {
    serde_json::json!({
        "user_id": user_id,
        "source_device_id": device_id,
        "command": command,
        "ok": ok,
        "latency_ms": latency_ms,
        "ts_ms": ts_ms,
    })
}

fn post_record(uri: &str, user: Option<&str>, body: &serde_json::Value) -> Request<Body> {
    let mut builder = Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json");
    if let Some(u) = user {
        builder = builder.header("x-user-id", u);
    }
    builder
        .body(Body::from(
            serde_json::to_vec(body).expect("serialize body"),
        ))
        .expect("build request")
}

/// `AuditWriter::record` spawns the SQLite write onto a tokio task,
/// so the handler returns 202 before the row is durable. Tests that
/// want to read back the row must wait for the spawned task to land.
/// This polls the storage layer up to ~1s, which is plenty for the
/// in-memory backend.
async fn await_audit_count(storage: &Arc<dyn Storage>, user: &str, expected: usize) {
    use crate::audit::AuditQuery;
    for _ in 0..50 {
        let rows = storage
            .audit_query(AuditQuery::for_user(UserId::new(user)))
            .await
            .expect("audit_query");
        if rows.len() >= expected {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("expected {} audit rows for {} after wait", expected, user);
}

async fn read_body(resp: axum::response::Response) -> serde_json::Value {
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).expect("parse json")
}

async fn seed(storage: &Arc<dyn Storage>, user: &str, device: &str, cmd: &str, ok: bool, ts: i64) {
    storage
        .audit_record(AuditRecord {
            id: 0,
            ts_ms: ts,
            user_id: UserId::new(user),
            device_id: DeviceId::new(device),
            command: cmd.to_string(),
            ok,
            latency_ms: 7,
            error: if ok { None } else { Some("boom".into()) },
        })
        .await
        .expect("seed");
}

#[tokio::test]
async fn missing_user_id_is_401() {
    let (router, _) = router_with_state();
    let resp = router.oneshot(req("/audit", None)).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn empty_user_id_is_401() {
    let (router, _) = router_with_state();
    let resp = router.oneshot(req("/audit", Some(""))).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn returns_only_callers_rows_newest_first() {
    let (router, storage) = router_with_state();
    seed(&storage, "user-a", "dev-a", "cmd.one", true, 100).await;
    seed(&storage, "user-a", "dev-a", "cmd.two", true, 300).await;
    seed(&storage, "user-a", "dev-a", "cmd.three", true, 200).await;
    seed(&storage, "user-b", "dev-b", "cmd.elsewhere", true, 999).await;

    let resp = router.oneshot(req("/audit", Some("user-a"))).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = read_body(resp).await;
    let rows: Vec<AuditRecord> = serde_json::from_value(body).unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0].ts_ms, 300);
    assert_eq!(rows[1].ts_ms, 200);
    assert_eq!(rows[2].ts_ms, 100);
    assert!(
        rows.iter().all(|r| r.user_id.as_str() == "user-a"),
        "user-b's row must not leak into user-a's view"
    );
}

#[tokio::test]
async fn filter_by_device_and_command() {
    let (router, storage) = router_with_state();
    seed(&storage, "user-a", "dev-a", "cmd.one", true, 1).await;
    seed(&storage, "user-a", "dev-a", "cmd.two", true, 2).await;
    seed(&storage, "user-a", "dev-b", "cmd.one", true, 3).await;

    let resp = router
        .clone()
        .oneshot(req(
            "/audit?device_id=dev-a&command=cmd.one",
            Some("user-a"),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let rows: Vec<AuditRecord> = serde_json::from_value(read_body(resp).await).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].device_id.as_str(), "dev-a");
    assert_eq!(rows[0].command, "cmd.one");
}

#[tokio::test]
async fn filter_by_since_ts_ms() {
    let (router, storage) = router_with_state();
    for ts in [10, 20, 30, 40, 50] {
        seed(&storage, "user-a", "dev", "cmd", true, ts).await;
    }

    let resp = router
        .oneshot(req("/audit?since_ts_ms=30", Some("user-a")))
        .await
        .unwrap();
    let rows: Vec<AuditRecord> = serde_json::from_value(read_body(resp).await).unwrap();
    assert_eq!(rows.len(), 3);
    assert!(rows.iter().all(|r| r.ts_ms >= 30));
}

#[tokio::test]
async fn ok_only_filter() {
    let (router, storage) = router_with_state();
    seed(&storage, "user-a", "dev", "cmd", true, 1).await;
    seed(&storage, "user-a", "dev", "cmd", false, 2).await;
    seed(&storage, "user-a", "dev", "cmd", true, 3).await;

    let resp = router
        .clone()
        .oneshot(req("/audit?ok_only=true", Some("user-a")))
        .await
        .unwrap();
    let rows: Vec<AuditRecord> = serde_json::from_value(read_body(resp).await).unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|r| r.ok));

    let resp = router
        .oneshot(req("/audit?ok_only=false", Some("user-a")))
        .await
        .unwrap();
    let rows: Vec<AuditRecord> = serde_json::from_value(read_body(resp).await).unwrap();
    assert_eq!(rows.len(), 1);
    assert!(!rows[0].ok);
    assert_eq!(rows[0].error.as_deref(), Some("boom"));
}

#[tokio::test]
async fn limit_param_caps_results() {
    let (router, storage) = router_with_state();
    for ts in 0..10i64 {
        seed(&storage, "user-a", "dev", "cmd", true, ts).await;
    }

    let resp = router
        .oneshot(req("/audit?limit=3", Some("user-a")))
        .await
        .unwrap();
    let rows: Vec<AuditRecord> = serde_json::from_value(read_body(resp).await).unwrap();
    assert_eq!(rows.len(), 3);
    // Newest-first: ts 9, 8, 7
    assert_eq!(rows[0].ts_ms, 9);
    assert_eq!(rows[2].ts_ms, 7);
}

#[tokio::test]
async fn malformed_limit_is_400() {
    let (router, _) = router_with_state();
    let resp = router
        .oneshot(req("/audit?limit=not-a-number", Some("user-a")))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn cross_user_filter_is_silently_overridden() {
    // A caller can't read another user's rows by passing user_id in
    // the URL — we don't accept user_id as a query param at all, and
    // the handler always scopes to the X-User-Id header.
    let (router, storage) = router_with_state();
    seed(&storage, "user-a", "dev-a", "cmd", true, 1).await;
    seed(&storage, "user-b", "dev-b", "cmd", true, 2).await;

    let resp = router
        .oneshot(req("/audit?user_id=user-b", Some("user-a")))
        .await
        .unwrap();
    let rows: Vec<AuditRecord> = serde_json::from_value(read_body(resp).await).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].user_id.as_str(), "user-a");
}

// ============================================================
// POST /audit/record
// ============================================================

#[tokio::test]
async fn record_persists_through_to_audit_writer() {
    let (router, storage) = router_with_state();
    let body = record_body(
        "user-a",
        "dev-a",
        "sessions_list",
        true,
        42,
        1_700_000_000_000,
    );

    let resp = router
        .clone()
        .oneshot(post_record("/audit/record", Some("user-a"), &body))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::ACCEPTED);

    await_audit_count(&storage, "user-a", 1).await;
    let rows: Vec<AuditRecord> = serde_json::from_value(
        read_body(router.oneshot(req("/audit", Some("user-a"))).await.unwrap()).await,
    )
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].user_id.as_str(), "user-a");
    assert_eq!(rows[0].device_id.as_str(), "dev-a");
    assert_eq!(rows[0].command, "sessions_list");
    assert_eq!(rows[0].ok, true);
    assert_eq!(rows[0].latency_ms, 42);
    assert_eq!(rows[0].ts_ms, 1_700_000_000_000);
    assert!(rows[0].error.is_none());
}

#[tokio::test]
async fn record_rejects_when_x_user_id_mismatches_body() {
    let (router, storage) = router_with_state();
    let body = record_body("user-impostor", "dev-a", "sessions_list", true, 1, 0);

    let resp = router
        .oneshot(post_record("/audit/record", Some("user-a"), &body))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // Storage must not have been written.
    use crate::audit::AuditQuery;
    let rows = storage
        .audit_query(AuditQuery::for_user(UserId::new("user-a")))
        .await
        .expect("audit_query");
    assert!(rows.is_empty());
    let rows = storage
        .audit_query(AuditQuery::for_user(UserId::new("user-impostor")))
        .await
        .expect("audit_query");
    assert!(rows.is_empty());
}

#[tokio::test]
async fn record_rejects_oversized_command_string() {
    let (router, _) = router_with_state();
    let oversize = "x".repeat(AUDIT_RECORD_COMMAND_MAX_LEN + 1);
    let body = record_body("user-a", "dev-a", &oversize, true, 1, 0);

    let resp = router
        .oneshot(post_record("/audit/record", Some("user-a"), &body))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn record_rejects_implausible_latency_ms() {
    let (router, _) = router_with_state();
    let body = record_body(
        "user-a",
        "dev-a",
        "sessions_list",
        true,
        AUDIT_RECORD_LATENCY_MAX_MS + 1,
        0,
    );

    let resp = router
        .oneshot(post_record("/audit/record", Some("user-a"), &body))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn record_returns_202_accepted_not_200_ok() {
    // The contract is "fire-and-forget"; clients must not assume the
    // row is durable until they re-read it via GET /audit.
    let (router, _) = router_with_state();
    let body = record_body("user-a", "dev-a", "sessions_list", true, 1, 0);

    let resp = router
        .oneshot(post_record("/audit/record", Some("user-a"), &body))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::ACCEPTED);
    assert_ne!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn record_missing_x_user_id_returns_401() {
    let (router, _) = router_with_state();
    let body = record_body("user-a", "dev-a", "sessions_list", true, 1, 0);

    let resp = router
        .oneshot(post_record("/audit/record", None, &body))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}
