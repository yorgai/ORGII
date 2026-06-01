//! End-to-end pairing flow tests using the real axum router with the
//! `MemoryStorage` backend. We exercise the public HTTP contract —
//! status codes, headers, JSON bodies — not handler internals.

use super::*;
use crate::hub::UserHubRegistry;
use crate::routes::build_router;
use crate::storage::{MemoryStorage, Storage};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use orgii_protocol::{
    ConfirmingSide, DesktopId, PairingClaimRequest, PairingClaimResponse, PairingConfirmRequest,
    PairingConfirmResponse, PairingConfirmStatus, PairingInitRequest, PairingInitResponse,
    PermissionTier,
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

fn json_request(method: &str, path: &str, body: &serde_json::Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json")
        .header("x-user-id", "user-1")
        .body(Body::from(body.to_string()))
        .expect("build request")
}

async fn read_json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).expect("parse json")
}

fn init_body() -> serde_json::Value {
    serde_json::to_value(PairingInitRequest {
        desktop_id: DesktopId::new("desk-home"),
        tier: PermissionTier::Full,
        label: "home mac".into(),
        is_primary: true,
        device_pubkey_fingerprint: "fp-desk".into(),
    })
    .unwrap()
}

#[tokio::test]
async fn pair_init_without_user_id_header_is_401() {
    let (router, _) = router_with_state();
    let req = Request::builder()
        .method("POST")
        .uri("/pair/init")
        .header("content-type", "application/json")
        .body(Body::from(init_body().to_string()))
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn pair_init_returns_code_phrase_and_expiry() {
    let (router, _) = router_with_state();
    let resp = router
        .oneshot(json_request("POST", "/pair/init", &init_body()))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = read_json(resp).await;
    let parsed: PairingInitResponse = serde_json::from_value(body).unwrap();
    assert!(!parsed.pairing_code.as_str().is_empty());
    assert!(!parsed.confirmation_phrase.as_str().is_empty());
    assert_eq!(parsed.expires_in_seconds, 600);
}

#[tokio::test]
async fn full_pairing_flow_paired_after_both_confirm() {
    let (router_init, storage) = router_with_state();

    // Init.
    let resp = router_init
        .clone()
        .oneshot(json_request("POST", "/pair/init", &init_body()))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let init: PairingInitResponse = serde_json::from_value(read_json(resp).await).unwrap();

    // Claim.
    let claim_body = serde_json::to_value(PairingClaimRequest {
        pairing_code: init.pairing_code.clone(),
        device_label: "Bob's Pixel".into(),
        device_pubkey_fingerprint: "fp-mob".into(),
    })
    .unwrap();
    let resp = router_init
        .clone()
        .oneshot(json_request("POST", "/pair/claim", &claim_body))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let claim: PairingClaimResponse = serde_json::from_value(read_json(resp).await).unwrap();
    assert_eq!(claim.confirmation_phrase, init.confirmation_phrase);
    assert_eq!(claim.tier, PermissionTier::Full);
    assert!(claim.device_id.as_str().starts_with("dev-"));

    // Confirm desktop side first → AwaitingOtherSide.
    let confirm_desktop = serde_json::to_value(PairingConfirmRequest {
        pairing_code: init.pairing_code.clone(),
        confirming_side: ConfirmingSide::Desktop,
        tier: PermissionTier::ReadOnly,
    })
    .unwrap();
    let resp = router_init
        .clone()
        .oneshot(json_request("POST", "/pair/confirm", &confirm_desktop))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let confirm_resp: PairingConfirmResponse =
        serde_json::from_value(read_json(resp).await).unwrap();
    assert_eq!(confirm_resp.status, PairingConfirmStatus::AwaitingOtherSide);

    // Confirm mobile side → Paired.
    let confirm_mobile = serde_json::to_value(PairingConfirmRequest {
        pairing_code: init.pairing_code.clone(),
        confirming_side: ConfirmingSide::Mobile,
        tier: PermissionTier::Full, // ignored
    })
    .unwrap();
    let resp = router_init
        .clone()
        .oneshot(json_request("POST", "/pair/confirm", &confirm_mobile))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let confirm_resp: PairingConfirmResponse =
        serde_json::from_value(read_json(resp).await).unwrap();
    assert_eq!(confirm_resp.status, PairingConfirmStatus::Paired);

    // Storage now holds a paired_device with the desktop-chosen tier.
    let stored = storage.get_paired_device(&claim.device_id).await.unwrap();
    let stored = stored.expect("paired_device row should exist");
    assert_eq!(stored.tier, PermissionTier::ReadOnly);
    assert_eq!(stored.label, "Bob's Pixel");
    assert_eq!(stored.device_pubkey_fingerprint, "fp-mob");
    // Pending row should be gone.
    assert!(storage
        .get_pending_pairing(&init.pairing_code)
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn pair_claim_unknown_code_returns_404() {
    let (router, _) = router_with_state();
    let body = serde_json::to_value(PairingClaimRequest {
        pairing_code: orgii_protocol::PairingCode::new("UNKNOWN1"),
        device_label: "x".into(),
        device_pubkey_fingerprint: "fp".into(),
    })
    .unwrap();
    let resp = router
        .oneshot(json_request("POST", "/pair/claim", &body))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn pair_claim_double_redemption_returns_409() {
    let (router, _) = router_with_state();
    let resp = router
        .clone()
        .oneshot(json_request("POST", "/pair/init", &init_body()))
        .await
        .unwrap();
    let init: PairingInitResponse = serde_json::from_value(read_json(resp).await).unwrap();
    let claim_body = serde_json::to_value(PairingClaimRequest {
        pairing_code: init.pairing_code.clone(),
        device_label: "Alice".into(),
        device_pubkey_fingerprint: "fp-1".into(),
    })
    .unwrap();
    let first = router
        .clone()
        .oneshot(json_request("POST", "/pair/claim", &claim_body))
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);
    let second = router
        .oneshot(json_request("POST", "/pair/claim", &claim_body))
        .await
        .unwrap();
    assert_eq!(second.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn pair_confirm_terminal_response_carries_real_device_id() {
    // The desktop's `mobile_remote_pair_complete` relies on this field to
    // persist the freshly-issued DeviceId in `PairedDeviceRecord`. The
    // first confirm must carry `device_id: None` (we still only know it
    // mobile-side), and the second confirm — which finalises the pairing
    // — must echo the same id `/pair/claim` returned.
    let (router, _storage) = router_with_state();

    // Init.
    let resp = router
        .clone()
        .oneshot(json_request("POST", "/pair/init", &init_body()))
        .await
        .unwrap();
    let init: PairingInitResponse = serde_json::from_value(read_json(resp).await).unwrap();

    // Claim — captures the relay-minted DeviceId.
    let claim_resp = router
        .clone()
        .oneshot(json_request(
            "POST",
            "/pair/claim",
            &serde_json::to_value(PairingClaimRequest {
                pairing_code: init.pairing_code.clone(),
                device_label: "Dana's iPad".into(),
                device_pubkey_fingerprint: "fp-dana".into(),
            })
            .unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(claim_resp.status(), StatusCode::OK);
    let claim: PairingClaimResponse = serde_json::from_value(read_json(claim_resp).await).unwrap();

    // First confirm (mobile) → AwaitingOtherSide, no device_id echoed.
    let resp_mobile = router
        .clone()
        .oneshot(json_request(
            "POST",
            "/pair/confirm",
            &serde_json::to_value(PairingConfirmRequest {
                pairing_code: init.pairing_code.clone(),
                confirming_side: ConfirmingSide::Mobile,
                tier: PermissionTier::Full,
            })
            .unwrap(),
        ))
        .await
        .unwrap();
    let first: PairingConfirmResponse =
        serde_json::from_value(read_json(resp_mobile).await).unwrap();
    assert_eq!(first.status, PairingConfirmStatus::AwaitingOtherSide);
    assert_eq!(
        first.device_id, None,
        "AwaitingOtherSide must not echo a device id",
    );

    // Second confirm (desktop) → Paired, device_id matches /pair/claim.
    let resp_desktop = router
        .oneshot(json_request(
            "POST",
            "/pair/confirm",
            &serde_json::to_value(PairingConfirmRequest {
                pairing_code: init.pairing_code.clone(),
                confirming_side: ConfirmingSide::Desktop,
                tier: PermissionTier::Full,
            })
            .unwrap(),
        ))
        .await
        .unwrap();
    let second: PairingConfirmResponse =
        serde_json::from_value(read_json(resp_desktop).await).unwrap();
    assert_eq!(second.status, PairingConfirmStatus::Paired);
    assert_eq!(
        second.device_id.as_ref(),
        Some(&claim.device_id),
        "terminal confirm must echo the DeviceId minted by /pair/claim",
    );
}

#[tokio::test]
async fn pair_confirm_mobile_first_then_desktop_also_works() {
    let (router, storage) = router_with_state();
    let resp = router
        .clone()
        .oneshot(json_request("POST", "/pair/init", &init_body()))
        .await
        .unwrap();
    let init: PairingInitResponse = serde_json::from_value(read_json(resp).await).unwrap();
    let _ = router
        .clone()
        .oneshot(json_request(
            "POST",
            "/pair/claim",
            &serde_json::to_value(PairingClaimRequest {
                pairing_code: init.pairing_code.clone(),
                device_label: "Carol".into(),
                device_pubkey_fingerprint: "fp-c".into(),
            })
            .unwrap(),
        ))
        .await
        .unwrap();

    // Mobile first.
    let resp = router
        .clone()
        .oneshot(json_request(
            "POST",
            "/pair/confirm",
            &serde_json::to_value(PairingConfirmRequest {
                pairing_code: init.pairing_code.clone(),
                confirming_side: ConfirmingSide::Mobile,
                tier: PermissionTier::Full,
            })
            .unwrap(),
        ))
        .await
        .unwrap();
    let body: PairingConfirmResponse = serde_json::from_value(read_json(resp).await).unwrap();
    assert_eq!(body.status, PairingConfirmStatus::AwaitingOtherSide);

    // Desktop second; uses Full tier.
    let resp = router
        .oneshot(json_request(
            "POST",
            "/pair/confirm",
            &serde_json::to_value(PairingConfirmRequest {
                pairing_code: init.pairing_code.clone(),
                confirming_side: ConfirmingSide::Desktop,
                tier: PermissionTier::Full,
            })
            .unwrap(),
        ))
        .await
        .unwrap();
    let body: PairingConfirmResponse = serde_json::from_value(read_json(resp).await).unwrap();
    assert_eq!(body.status, PairingConfirmStatus::Paired);

    // Find the inserted device row by user_id, and confirm tier.
    let user_devs = storage
        .list_paired_devices_for_user(&UserId::new("user-1"))
        .await
        .unwrap();
    assert_eq!(user_devs.len(), 1);
    assert_eq!(user_devs[0].tier, PermissionTier::Full);
}
