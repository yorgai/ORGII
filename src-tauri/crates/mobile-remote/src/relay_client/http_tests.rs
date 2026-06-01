//! Tests for `PairingHttpClient`.
//!
//! Uses `wiremock` (already in `[dev-dependencies]`) to spin up a
//! local HTTP server so the happy-path serialization contract is
//! exercised without a real relay.

use super::*;
use crate::test_utils::install_crypto_provider_for_tests;
use orgii_protocol::{
    ConfirmationPhrase, ConfirmingSide, DesktopId, DeviceId, PairingCode, PairingConfirmRequest,
    PairingConfirmStatus, PairingInitRequest, PermissionTier, UserId,
};
use reqwest::Client;
use wiremock::matchers::{body_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Every test in this module builds a `reqwest::Client` (directly or
/// via `PairingHttpClient::new` / `AuditHttpClient`). The workspace's
/// `reqwest` is built with `rustls-no-provider`, so the first
/// `Client::builder().build()` panics with `"No provider set"` unless
/// a `CryptoProvider` is installed at the process level. Production
/// installs `ring` in `lib.rs::run`; tests install it via this
/// idempotent one-shot helper.
fn setup() {
    install_crypto_provider_for_tests();
}

fn sample_init_request() -> PairingInitRequest {
    PairingInitRequest {
        desktop_id: DesktopId::new("desk-home"),
        tier: PermissionTier::Full,
        label: "MacBook".into(),
        is_primary: true,
        device_pubkey_fingerprint: "deadbeef".into(),
    }
}

#[test]
fn accessors_round_trip() {
    setup();
    let client =
        PairingHttpClient::new("https://relay.example", UserId::new("u-1")).expect("client builds");
    assert_eq!(client.base_url(), "https://relay.example");
    assert_eq!(client.user_id().as_str(), "u-1");
}

#[tokio::test]
async fn pair_init_happy_path() {
    setup();
    let server = MockServer::start().await;
    let response_body = serde_json::json!({
        "pairing_code": "ABC123",
        "confirmation_phrase": "crimson-falcon-7392",
        "expires_in_seconds": 600
    });
    Mock::given(method("POST"))
        .and(path("/pair/init"))
        .and(header("X-User-Id", "local-user"))
        .respond_with(ResponseTemplate::new(200).set_body_json(response_body))
        .expect(1)
        .mount(&server)
        .await;

    let client =
        PairingHttpClient::new(server.uri(), UserId::new("local-user")).expect("client builds");
    let response = client
        .pair_init(&sample_init_request())
        .await
        .expect("pair_init succeeds");

    assert_eq!(response.pairing_code, PairingCode::new("ABC123"));
    assert_eq!(
        response.confirmation_phrase,
        ConfirmationPhrase::new("crimson-falcon-7392")
    );
    assert_eq!(response.expires_in_seconds, 600);
}

#[tokio::test]
async fn pair_init_rejected_with_error_body() {
    setup();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/pair/init"))
        .respond_with(
            ResponseTemplate::new(401)
                .set_body_json(serde_json::json!({ "error": "missing X-User-Id header" })),
        )
        .expect(1)
        .mount(&server)
        .await;

    let client =
        PairingHttpClient::new(server.uri(), UserId::new("local-user")).expect("client builds");
    let err = client
        .pair_init(&sample_init_request())
        .await
        .expect_err("should reject");

    match err {
        MobileRemoteError::RelayRejected { status, message } => {
            assert_eq!(status, 401);
            assert_eq!(message, "missing X-User-Id header");
        }
        other => panic!("unexpected error variant: {other:?}"),
    }
}

#[tokio::test]
async fn pair_confirm_happy_path() {
    setup();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/pair/confirm"))
        .and(header("X-User-Id", "local-user"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({ "status": "paired" })),
        )
        .expect(1)
        .mount(&server)
        .await;

    let client =
        PairingHttpClient::new(server.uri(), UserId::new("local-user")).expect("client builds");
    let req = PairingConfirmRequest {
        pairing_code: PairingCode::new("ABC123"),
        confirming_side: ConfirmingSide::Desktop,
        tier: PermissionTier::Full,
    };
    let response = client.pair_confirm(&req).await.expect("pair_confirm");
    assert_eq!(response.status, PairingConfirmStatus::Paired);
}

#[tokio::test]
async fn pair_init_network_failure_is_unreachable() {
    setup();
    // Port 1 is the reserved `tcpmux` slot; binding requires root, so
    // nothing else in the test process listens there. Earlier this
    // test allocated then dropped a `MockServer` to find a free port,
    // but parallel `cargo test` runs raced another test's
    // `MockServer::start()` into the same port between drop and
    // connect, producing spurious 200s. A statically-closed port
    // makes the unreachable branch deterministic.
    let dead_url = "http://127.0.0.1:1".to_owned();
    let client =
        PairingHttpClient::new(dead_url, UserId::new("local-user")).expect("client builds");

    let err = client
        .pair_init(&sample_init_request())
        .await
        .expect_err("dead URL should fail");
    assert!(
        matches!(err, MobileRemoteError::RelayUnreachable(_)),
        "expected RelayUnreachable, got {err:?}"
    );
}

#[test]
fn extract_error_message_handles_plain_text() {
    let msg = extract_error_message("not json at all");
    assert_eq!(msg, "not json at all");
}

#[test]
fn extract_error_message_pulls_field() {
    let msg = extract_error_message(r#"{"error":"boom"}"#);
    assert_eq!(msg, "boom");
}

#[tokio::test]
async fn list_devices_happy_path() {
    setup();
    let server = MockServer::start().await;
    let body = serde_json::json!({
        "devices": [
            {
                "device_id": "dev-1",
                "desktop_id": "desk-home",
                "label": "Alice's iPhone",
                "tier": "full",
                "paired_at_ms": 1_700_000_000_000_i64,
                "last_seen_ms": null,
                "is_primary": true
            }
        ]
    });
    Mock::given(method("GET"))
        .and(path("/devices"))
        .and(header("X-User-Id", "local-user"))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .expect(1)
        .mount(&server)
        .await;

    let client =
        PairingHttpClient::new(server.uri(), UserId::new("local-user")).expect("client builds");
    let response = client.list_devices().await.expect("list_devices");
    assert_eq!(response.devices.len(), 1);
    assert_eq!(response.devices[0].device_id.as_str(), "dev-1");
    assert_eq!(response.devices[0].is_primary, true);
}

#[tokio::test]
async fn revoke_device_204_returns_ok() {
    setup();
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/devices/dev-1"))
        .and(header("X-User-Id", "local-user"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    let client =
        PairingHttpClient::new(server.uri(), UserId::new("local-user")).expect("client builds");
    client
        .revoke_device(&DeviceId::new("dev-1"))
        .await
        .expect("revoke_device 204");
}

#[tokio::test]
async fn revoke_device_404_maps_to_relay_rejected() {
    setup();
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/devices/dev-nope"))
        .respond_with(
            ResponseTemplate::new(404)
                .set_body_json(serde_json::json!({ "error": "device not found" })),
        )
        .expect(1)
        .mount(&server)
        .await;

    let client =
        PairingHttpClient::new(server.uri(), UserId::new("local-user")).expect("client builds");
    let err = client
        .revoke_device(&DeviceId::new("dev-nope"))
        .await
        .expect_err("404 should error");
    match err {
        MobileRemoteError::RelayRejected { status, message } => {
            assert_eq!(status, 404);
            assert_eq!(message, "device not found");
        }
        other => panic!("unexpected: {other:?}"),
    }
}

#[tokio::test]
async fn set_primary_desktop_happy_path() {
    setup();
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/desktops/desk-home/primary"))
        .and(header("X-User-Id", "local-user"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({ "desktop_id": "desk-home" })),
        )
        .expect(1)
        .mount(&server)
        .await;

    let client =
        PairingHttpClient::new(server.uri(), UserId::new("local-user")).expect("client builds");
    let response = client
        .set_primary_desktop(&DesktopId::new("desk-home"))
        .await
        .expect("set_primary_desktop");
    assert_eq!(response.desktop_id.as_str(), "desk-home");
}

// ============================================================
// AuditHttpClient::record_audit
// ============================================================

fn sample_audit_body() -> AuditRecordRequest {
    AuditRecordRequest {
        user_id: "local-user".into(),
        source_device_id: "dev-mobile".into(),
        command: "sessions_list".into(),
        ok: true,
        latency_ms: 42,
        ts_ms: 1_700_000_000_000,
    }
}

#[tokio::test]
async fn record_audit_accepts_202() {
    setup();
    let server = MockServer::start().await;
    let body = sample_audit_body();
    let expected_body = serde_json::json!({
        "user_id": body.user_id,
        "source_device_id": body.source_device_id,
        "command": body.command,
        "ok": body.ok,
        "latency_ms": body.latency_ms,
        "ts_ms": body.ts_ms,
    });
    Mock::given(method("POST"))
        .and(path("/audit/record"))
        .and(header("X-User-Id", "local-user"))
        .and(body_json(&expected_body))
        .respond_with(ResponseTemplate::new(202))
        .expect(1)
        .mount(&server)
        .await;

    let client = AuditHttpClient::new(server.uri(), UserId::new("local-user"), Client::new());
    client
        .record_audit(&body)
        .await
        .expect("record_audit accepted");
}

#[tokio::test]
async fn record_audit_treats_200_as_rejection() {
    // The contract says relays MUST return 202. A 200 from a
    // misbehaving relay is treated as a typed error rather than
    // silently accepted, so callers don't get fooled into thinking
    // the row was accepted by an out-of-spec server.
    setup();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/audit/record"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;

    let client = AuditHttpClient::new(server.uri(), UserId::new("local-user"), Client::new());
    let err = client
        .record_audit(&sample_audit_body())
        .await
        .expect_err("200 should be rejected");
    match err {
        MobileRemoteError::RelayRejected { status, .. } => assert_eq!(status, 200),
        other => panic!("unexpected error: {other:?}"),
    }
}

#[tokio::test]
async fn record_audit_400_maps_to_relay_rejected() {
    setup();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/audit/record"))
        .respond_with(
            ResponseTemplate::new(400)
                .set_body_json(serde_json::json!({ "error": "command too long" })),
        )
        .expect(1)
        .mount(&server)
        .await;

    let client = AuditHttpClient::new(server.uri(), UserId::new("local-user"), Client::new());
    let err = client
        .record_audit(&sample_audit_body())
        .await
        .expect_err("400 should error");
    match err {
        MobileRemoteError::RelayRejected { status, message } => {
            assert_eq!(status, 400);
            assert_eq!(message, "command too long");
        }
        other => panic!("unexpected: {other:?}"),
    }
}

#[tokio::test]
async fn record_audit_network_failure_is_unreachable() {
    setup();
    // See `pair_init_network_failure_is_unreachable` for the
    // port-1 rationale: a freshly-dropped MockServer's port races
    // with sibling tests under parallel `cargo test`.
    let dead_url = "http://127.0.0.1:1".to_owned();
    let client = AuditHttpClient::new(dead_url, UserId::new("local-user"), Client::new());
    let err = client
        .record_audit(&sample_audit_body())
        .await
        .expect_err("dead URL should fail");
    assert!(
        matches!(err, MobileRemoteError::RelayUnreachable(_)),
        "expected RelayUnreachable, got {err:?}"
    );
}
