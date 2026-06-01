use super::*;

#[test]
fn parse_tier_accepts_read_only() {
    assert_eq!(parse_tier("read_only"), Ok(PermissionTier::ReadOnly));
}

#[test]
fn parse_tier_accepts_full() {
    assert_eq!(parse_tier("full"), Ok(PermissionTier::Full));
}

#[test]
fn parse_tier_rejects_unknown() {
    let err = parse_tier("admin").expect_err("should reject");
    assert!(err.contains("admin"), "error should mention input: {err}");
    assert!(err.contains("read_only"));
    assert!(err.contains("full"));
}

#[test]
fn parse_tier_rejects_empty() {
    assert!(parse_tier("").is_err());
}

#[test]
fn paired_device_record_to_info_round_trip() {
    let rec = PairedDeviceRecord {
        device_id: "dev-1".into(),
        desktop_id: "desk-home".into(),
        label: "Phone".into(),
        tier: PermissionTier::ReadOnly,
        is_primary: true,
        paired_at_ms: 1_700_000_000_000,
        last_seen_ms: Some(1_700_000_001_000),
        device_pubkey_fingerprint: "fp".into(),
    };
    let info: PairedDeviceInfo = rec.into();
    assert_eq!(info.device_id, "dev-1");
    assert_eq!(info.desktop_id, "desk-home");
    assert_eq!(info.label, "Phone");
    assert_eq!(info.tier, "read_only");
    assert!(info.is_primary);
    assert_eq!(info.paired_at_ms, 1_700_000_000_000);
    assert_eq!(info.last_seen_ms, Some(1_700_000_001_000));
}

#[test]
fn paired_device_info_serializes_desktop_id_camel_case() {
    let info = PairedDeviceInfo {
        device_id: "dev-1".into(),
        desktop_id: "desk-home".into(),
        label: "Phone".into(),
        tier: "full".into(),
        is_primary: false,
        paired_at_ms: 1_700_000_000_000,
        last_seen_ms: None,
    };
    let json = serde_json::to_value(&info).expect("serialize");
    assert_eq!(json["deviceId"], "dev-1");
    assert_eq!(json["desktopId"], "desk-home");
}
