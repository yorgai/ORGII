use super::*;
use serde_json::json;

#[test]
fn frame_rpc_call_round_trip() {
    let call = Frame::RpcCall(RpcCall {
        id: RpcId::new("req-1"),
        target_desktop_id: DesktopId::new("desk-home"),
        source_device_id: DeviceId::new("dev-alice-iphone"),
        command: "sessions_list".to_owned(),
        args: json!({ "limit": 50 }),
    });

    let wire = serde_json::to_string(&call).expect("serialize");
    let back: Frame = serde_json::from_str(&wire).expect("deserialize");
    assert_eq!(call, back, "round-trip mismatch: {wire}");
}

#[test]
fn frame_kind_discriminant_lives_on_kind_field() {
    let call = Frame::RpcCall(RpcCall {
        id: RpcId::new("x"),
        target_desktop_id: DesktopId::new("d"),
        source_device_id: DeviceId::new("m"),
        command: "ping".into(),
        args: serde_json::Value::Null,
    });
    let wire = serde_json::to_value(&call).unwrap();
    assert_eq!(wire["kind"], "rpc_call", "wire shape: {wire}");
}

#[test]
fn rpc_call_source_device_id_is_required_snake_case_field() {
    let call = RpcCall {
        id: RpcId::new("req-2"),
        target_desktop_id: DesktopId::new("desk-home"),
        source_device_id: DeviceId::new("dev-bob-pixel"),
        command: "sessions_list".to_owned(),
        args: serde_json::Value::Null,
    };
    let wire = serde_json::to_value(&call).expect("serialize");
    assert_eq!(
        wire["source_device_id"], "dev-bob-pixel",
        "snake_case wire field present: {wire}"
    );
    let back: RpcCall = serde_json::from_value(wire).expect("deserialize");
    assert_eq!(call, back);
}

#[test]
fn rpc_call_without_source_device_id_fails_to_deserialize() {
    // Per workspace rule "no legacy / backward compatibility": a frame
    // that omits `source_device_id` must NOT silently default — it is
    // a hard decode error so the relay's stamping bug surfaces loudly.
    let wire = json!({
        "id": "req-3",
        "target_desktop_id": "desk-home",
        "command": "sessions_list",
        "args": null,
    });
    let result: Result<RpcCall, _> = serde_json::from_value(wire);
    assert!(
        result.is_err(),
        "missing source_device_id must be a decode error, got {result:?}"
    );
}

#[test]
fn rpc_result_ok_and_err_round_trip() {
    let ok = RpcResult::Ok {
        id: RpcId::new("a"),
        data: json!({"sessions": []}),
    };
    let wire = serde_json::to_value(&ok).unwrap();
    assert_eq!(wire["outcome"], "ok");

    let err = RpcResult::Err {
        id: RpcId::new("b"),
        error: "boom".into(),
    };
    let wire = serde_json::to_value(&err).unwrap();
    assert_eq!(wire["outcome"], "err");
    assert_eq!(wire["error"], "boom");
}

#[test]
fn fleet_view_subscribe_uses_empty_desktop_ids() {
    let sub = Frame::Subscribe(Subscription {
        desktop_ids: Vec::new(),
        session_filter: None,
    });
    let wire = serde_json::to_string(&sub).unwrap();
    let back: Frame = serde_json::from_str(&wire).unwrap();
    assert_eq!(sub, back);
}

#[test]
fn read_only_tier_blocks_session_create() {
    assert!(!PermissionTier::ReadOnly.allows("session_create"));
    assert!(PermissionTier::ReadOnly.allows("sessions_list"));
}

#[test]
fn full_tier_is_strict_superset_of_read_only() {
    let read_only = PermissionTier::ReadOnly.allowed_commands();
    for cmd in read_only {
        assert!(
            PermissionTier::Full.allows(cmd),
            "Full tier missing read-only command {cmd}",
        );
    }
}

#[test]
fn full_tier_allows_mutating_commands() {
    let mutating = [
        "session_create",
        "session_cancel",
        "agent_send_message",
        "tool_call_approve",
        "tool_call_deny",
    ];
    for cmd in mutating {
        assert!(PermissionTier::Full.allows(cmd), "Full should allow {cmd}");
    }
}

#[test]
fn allowlist_has_no_string_collisions() {
    let read_only = PermissionTier::ReadOnly.allowed_commands();
    let mut seen = std::collections::HashSet::new();
    for cmd in read_only {
        assert!(seen.insert(*cmd), "duplicate read-only command: {cmd}");
    }
    let full = PermissionTier::Full.allowed_commands();
    let mut seen = std::collections::HashSet::new();
    for cmd in full {
        assert!(seen.insert(*cmd), "duplicate full command: {cmd}");
    }
}

#[test]
fn pairing_request_round_trip() {
    let req = PairingInitRequest {
        desktop_id: DesktopId::new("desk"),
        tier: PermissionTier::Full,
        label: "Alice's iPhone".into(),
        is_primary: true,
        device_pubkey_fingerprint: "abcd1234".into(),
    };
    let wire = serde_json::to_string(&req).unwrap();
    let back: PairingInitRequest = serde_json::from_str(&wire).unwrap();
    assert_eq!(req, back);
}

#[test]
fn pairing_claim_request_round_trip_carries_label_and_fingerprint() {
    let req = PairingClaimRequest {
        pairing_code: PairingCode::new("ABC23456"),
        device_label: "Bob's Pixel".into(),
        device_pubkey_fingerprint: "deadbeef".into(),
    };
    let wire = serde_json::to_string(&req).unwrap();
    let back: PairingClaimRequest = serde_json::from_str(&wire).unwrap();
    assert_eq!(req, back);
}

#[test]
fn pairing_claim_response_round_trips_all_ids() {
    let resp = PairingClaimResponse {
        desktop_id: DesktopId::new("desk-home"),
        user_id: UserId::new("user-1"),
        device_id: DeviceId::new("dev-xyz"),
        tier: PermissionTier::ReadOnly,
        label: "Alice's iPhone".into(),
        confirmation_phrase: ConfirmationPhrase::new("crimson-falcon-beacon-7392"),
    };
    let wire = serde_json::to_string(&resp).unwrap();
    let back: PairingClaimResponse = serde_json::from_str(&wire).unwrap();
    assert_eq!(resp, back);
}

#[test]
fn pairing_confirm_request_round_trip_with_side_and_tier() {
    let req = PairingConfirmRequest {
        pairing_code: PairingCode::new("XYZ23456"),
        confirming_side: ConfirmingSide::Desktop,
        tier: PermissionTier::Full,
    };
    let wire = serde_json::to_value(&req).unwrap();
    assert_eq!(wire["confirming_side"], "desktop");
    let back: PairingConfirmRequest = serde_json::from_value(wire).unwrap();
    assert_eq!(req, back);
}

#[test]
fn pairing_confirm_response_status_serializes_snake_case() {
    let paired = PairingConfirmResponse {
        status: PairingConfirmStatus::Paired,
        device_id: Some(DeviceId::new("dev-abc")),
    };
    let wire = serde_json::to_value(&paired).unwrap();
    assert_eq!(wire["status"], "paired");
    assert_eq!(wire["device_id"], "dev-abc");

    let awaiting = PairingConfirmResponse {
        status: PairingConfirmStatus::AwaitingOtherSide,
        device_id: None,
    };
    let wire = serde_json::to_value(&awaiting).unwrap();
    assert_eq!(wire["status"], "awaiting_other_side");
    // Field omitted on the wire when not paired (skip_serializing_if).
    assert!(wire.get("device_id").is_none());
}

#[test]
fn pairing_confirm_response_paired_with_device_id_round_trip() {
    let resp = PairingConfirmResponse {
        status: PairingConfirmStatus::Paired,
        device_id: Some(DeviceId::new("dev-1234")),
    };
    let wire = serde_json::to_value(&resp).unwrap();
    let back: PairingConfirmResponse = serde_json::from_value(wire).unwrap();
    assert_eq!(resp, back);
}

#[test]
fn pairing_confirm_response_deserializes_without_device_id_field() {
    // Older relays that don't yet send `device_id` must still deserialize
    // (relevant during a brief desktop-ahead-of-relay rollout window).
    let wire = serde_json::json!({ "status": "awaiting_other_side" });
    let parsed: PairingConfirmResponse = serde_json::from_value(wire).unwrap();
    assert_eq!(parsed.status, PairingConfirmStatus::AwaitingOtherSide);
    assert_eq!(parsed.device_id, None);
}

#[test]
fn confirming_side_round_trip() {
    let desktop = ConfirmingSide::Desktop;
    let wire = serde_json::to_value(&desktop).unwrap();
    assert_eq!(wire, "desktop");
    let back: ConfirmingSide = serde_json::from_value(wire).unwrap();
    assert_eq!(desktop, back);

    let mobile = ConfirmingSide::Mobile;
    let wire = serde_json::to_value(&mobile).unwrap();
    assert_eq!(wire, "mobile");
}

#[test]
fn pairing_expiry_default_is_ten_minutes() {
    assert_eq!(PAIRING_EXPIRY_SECONDS, 600);
}

#[test]
fn device_list_response_round_trip() {
    let resp = DeviceListResponse {
        devices: vec![
            DeviceListEntry {
                device_id: DeviceId::new("dev-1"),
                desktop_id: DesktopId::new("desk-1"),
                label: "Alice's iPhone".into(),
                tier: PermissionTier::Full,
                paired_at_ms: 1_700_000_000_000,
                last_seen_ms: Some(1_700_000_500_000),
                is_primary: true,
            },
            DeviceListEntry {
                device_id: DeviceId::new("dev-2"),
                desktop_id: DesktopId::new("desk-2"),
                label: "Bob's Pixel".into(),
                tier: PermissionTier::ReadOnly,
                paired_at_ms: 1_700_000_100_000,
                last_seen_ms: None,
                is_primary: false,
            },
        ],
    };
    let wire = serde_json::to_string(&resp).unwrap();
    let back: DeviceListResponse = serde_json::from_str(&wire).unwrap();
    assert_eq!(resp, back);
}

#[test]
fn device_list_entry_uses_snake_case_wire() {
    let entry = DeviceListEntry {
        device_id: DeviceId::new("d"),
        desktop_id: DesktopId::new("k"),
        label: "x".into(),
        tier: PermissionTier::ReadOnly,
        paired_at_ms: 0,
        last_seen_ms: None,
        is_primary: false,
    };
    let wire = serde_json::to_value(&entry).unwrap();
    assert!(wire.get("device_id").is_some(), "snake_case device_id");
    assert!(wire.get("desktop_id").is_some(), "snake_case desktop_id");
    assert!(
        wire.get("paired_at_ms").is_some(),
        "snake_case paired_at_ms"
    );
    assert!(wire.get("is_primary").is_some(), "snake_case is_primary");
}

#[test]
fn set_primary_desktop_response_round_trip() {
    let resp = SetPrimaryDesktopResponse {
        desktop_id: DesktopId::new("desk-home"),
    };
    let wire = serde_json::to_string(&resp).unwrap();
    let back: SetPrimaryDesktopResponse = serde_json::from_str(&wire).unwrap();
    assert_eq!(resp, back);
}

#[test]
fn protocol_version_compatibility() {
    let a = ProtocolVersion::new(0, 1);
    let b = ProtocolVersion::new(0, 2);
    let c = ProtocolVersion::new(1, 0);
    assert!(a.is_compatible_with(b), "minor differences are compatible");
    assert!(!a.is_compatible_with(c), "major differences break compat");
}

#[test]
fn handshake_round_trip_through_frame() {
    let h = Frame::Handshake {
        version: PROTOCOL_VERSION,
        role: PeerRole::Mobile,
        agent: "orgii-pwa/0.1.0".into(),
    };
    let wire = serde_json::to_string(&h).unwrap();
    let back: Frame = serde_json::from_str(&wire).unwrap();
    assert_eq!(h, back);
}

#[test]
fn handshake_serializes_with_kind_discriminant() {
    let h = Frame::Handshake {
        version: PROTOCOL_VERSION,
        role: PeerRole::Desktop,
        agent: "orgii-desktop/0.1.0".into(),
    };
    let wire = serde_json::to_value(&h).unwrap();
    assert_eq!(
        wire["kind"], "handshake",
        "Handshake must surface as a tagged Frame variant: {wire}"
    );
    assert_eq!(wire["role"], "desktop", "wire: {wire}");
    assert_eq!(wire["version"]["major"], 0, "wire: {wire}");
    assert_eq!(wire["version"]["minor"], 1, "wire: {wire}");
}

#[test]
fn id_newtypes_are_distinct_at_type_level() {
    fn takes_desktop(_: &DesktopId) {}
    fn takes_device(_: &DeviceId) {}

    let d = DesktopId::new("a");
    let m = DeviceId::new("a");
    takes_desktop(&d);
    takes_device(&m);
}

#[test]
fn desktop_status_serializes_with_status_string() {
    let status = Frame::DesktopStatus(DesktopStatus {
        desktop_id: DesktopId::new("desk-1"),
        status: DesktopStatusKind::Offline,
    });
    let wire = serde_json::to_value(&status).unwrap();
    assert_eq!(wire["kind"], "desktop_status");
    assert_eq!(wire["status"], "offline");
}
