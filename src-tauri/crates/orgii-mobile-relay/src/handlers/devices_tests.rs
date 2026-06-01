//! End-to-end tests for the `/devices` and `/desktops/:id/primary`
//! endpoints. Same router-level approach as `pairing_tests.rs`.

use crate::hub::UserHubRegistry;
use crate::routes::build_router;
use crate::state::AppState;
use crate::storage::types::PairedDevice;
use crate::storage::{MemoryStorage, Storage};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use orgii_protocol::{
    DesktopId, DeviceId, DeviceListResponse, PermissionTier, SetPrimaryDesktopResponse, UserId,
};
use std::sync::Arc;
use tower::ServiceExt;

fn router_with_state() -> (axum::Router, Arc<dyn Storage>) {
    let storage: Arc<dyn Storage> = Arc::new(MemoryStorage::new());
    let registry = Arc::new(UserHubRegistry::new());
    (
        build_router(AppState::new(storage.clone(), registry)),
        storage,
    )
}

fn req(method: &str, path: &str, user: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(path)
        .header("x-user-id", user)
        .body(Body::empty())
        .expect("build request")
}

async fn read_json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).expect("parse json")
}

async fn seed_device(
    storage: &Arc<dyn Storage>,
    user: &str,
    device_id: &str,
    desktop_id: &str,
    is_primary: bool,
) {
    storage
        .upsert_paired_device(PairedDevice {
            device_id: DeviceId::new(device_id),
            user_id: UserId::new(user),
            desktop_id: DesktopId::new(desktop_id),
            label: format!("{user}'s {device_id}"),
            tier: PermissionTier::Full,
            paired_at_ms: 1_700_000_000_000,
            last_seen_ms: None,
            is_primary,
            device_pubkey_fingerprint: "fp".into(),
        })
        .await
        .expect("seed");
}

#[tokio::test]
async fn list_devices_without_user_id_is_401() {
    let (router, _) = router_with_state();
    let r = Request::builder()
        .method("GET")
        .uri("/devices")
        .body(Body::empty())
        .unwrap();
    let resp = router.oneshot(r).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn list_devices_returns_only_callers_devices() {
    let (router, storage) = router_with_state();
    seed_device(&storage, "user-a", "dev-a1", "desk-a", true).await;
    seed_device(&storage, "user-a", "dev-a2", "desk-a", false).await;
    seed_device(&storage, "user-b", "dev-b1", "desk-b", true).await;

    let resp = router
        .oneshot(req("GET", "/devices", "user-a"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: DeviceListResponse = serde_json::from_value(read_json(resp).await).unwrap();
    assert_eq!(body.devices.len(), 2);
    let ids: Vec<&str> = body.devices.iter().map(|d| d.device_id.as_str()).collect();
    assert!(ids.contains(&"dev-a1"));
    assert!(ids.contains(&"dev-a2"));
    // user-b's device must not leak into user-a's list.
    assert!(!ids.contains(&"dev-b1"));
}

#[tokio::test]
async fn revoke_device_removes_row_and_returns_204() {
    let (router, storage) = router_with_state();
    seed_device(&storage, "user-a", "dev-a1", "desk-a", true).await;

    let resp = router
        .clone()
        .oneshot(req("DELETE", "/devices/dev-a1", "user-a"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let after = storage
        .get_paired_device(&DeviceId::new("dev-a1"))
        .await
        .unwrap();
    assert!(after.is_none(), "device should be gone after revoke");
}

#[tokio::test]
async fn revoke_device_unknown_id_is_404() {
    let (router, _) = router_with_state();
    let resp = router
        .oneshot(req("DELETE", "/devices/dev-nope", "user-a"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn revoke_device_belonging_to_other_user_is_404_not_403() {
    // 404 (not 403) so a probe can't enumerate other users' device IDs.
    let (router, storage) = router_with_state();
    seed_device(&storage, "user-b", "dev-b1", "desk-b", true).await;

    let resp = router
        .clone()
        .oneshot(req("DELETE", "/devices/dev-b1", "user-a"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    // user-b's row must still be there.
    let after = storage
        .get_paired_device(&DeviceId::new("dev-b1"))
        .await
        .unwrap();
    assert!(
        after.is_some(),
        "user-b's device must not be deleted by user-a's request"
    );
}

#[tokio::test]
async fn set_primary_desktop_marks_target_and_clears_other() {
    let (router, storage) = router_with_state();
    seed_device(&storage, "user-a", "dev-a1", "desk-home", true).await;
    seed_device(&storage, "user-a", "dev-a2", "desk-work", false).await;

    let resp = router
        .clone()
        .oneshot(req("PUT", "/desktops/desk-work/primary", "user-a"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body: SetPrimaryDesktopResponse = serde_json::from_value(read_json(resp).await).unwrap();
    assert_eq!(body.desktop_id.as_str(), "desk-work");

    // Inspect storage: desk-work rows now is_primary=true, desk-home false.
    let rows = storage
        .list_paired_devices_for_user(&UserId::new("user-a"))
        .await
        .unwrap();
    let work = rows
        .iter()
        .find(|r| r.desktop_id.as_str() == "desk-work")
        .unwrap();
    let home = rows
        .iter()
        .find(|r| r.desktop_id.as_str() == "desk-home")
        .unwrap();
    assert!(work.is_primary, "work desktop should be primary");
    assert!(!home.is_primary, "home desktop should no longer be primary");
}

#[tokio::test]
async fn set_primary_desktop_unknown_desktop_is_404() {
    let (router, storage) = router_with_state();
    seed_device(&storage, "user-a", "dev-a1", "desk-a", true).await;

    let resp = router
        .oneshot(req("PUT", "/desktops/desk-nope/primary", "user-a"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn set_primary_desktop_for_other_users_desktop_is_404() {
    let (router, storage) = router_with_state();
    seed_device(&storage, "user-b", "dev-b1", "desk-b", true).await;

    let resp = router
        .oneshot(req("PUT", "/desktops/desk-b/primary", "user-a"))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
