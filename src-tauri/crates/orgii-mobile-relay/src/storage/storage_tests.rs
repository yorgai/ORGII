//! Storage trait conformance tests. Every test runs against both the
//! SQLite backend (`:memory:`) and the in-memory backend so the two
//! implementations stay observationally indistinguishable.

use super::types::PeerKind;
use super::*;
use crate::audit::{AuditQuery, AuditRecord};
use orgii_protocol::{
    ConfirmationPhrase, ConfirmingSide, DesktopId, DeviceId, PairingCode, PermissionTier, UserId,
};

/// Run every contract test against a freshly-constructed `Storage`.
/// Each test sees its own instance so insertions don't bleed across
/// scenarios — important because `MemoryStorage::default()` has no
/// concept of "begin / commit" transactions.
async fn run_all<S: Storage, F, Fut>(make: F)
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = S>,
{
    schema_idempotent(&make().await).await;
    paired_device_round_trip(&make().await).await;
    list_paired_filters_by_user(&make().await).await;
    revoke_paired_device_works(&make().await).await;
    set_primary_is_exclusive(&make().await).await;
    update_last_seen(&make().await).await;
    pending_pairing_round_trip(&make().await).await;
    mark_claimed_then_confirmed_both_sides(&make().await).await;
    delete_expired_pairings_only_removes_old(&make().await).await;
    audit_log_is_newest_first(&make().await).await;
    audit_record_round_trip(&make().await).await;
    audit_query_filters_by_dimensions(&make().await).await;
    audit_query_scopes_to_user(&make().await).await;
    audit_query_caps_limit_at_max(&make().await).await;
    connection_open_then_close_records_bytes(&make().await).await;
}

#[tokio::test]
async fn memory_storage_passes_all_contract_tests() {
    run_all(|| async { MemoryStorage::new() }).await;
}

#[tokio::test]
async fn sqlite_storage_passes_all_contract_tests() {
    run_all(|| async { SqliteStorage::open_in_memory().await.expect("open") }).await;
}

#[tokio::test]
async fn sqlite_migrations_idempotent_on_reopen() {
    // Open the same in-memory connection isn't possible (each :memory:
    // is fresh), so use a tempfile to verify migrations don't crash on
    // a re-open.
    let tmp = tempfile::NamedTempFile::new().expect("tempfile");
    let path = tmp.path().to_owned();
    {
        let s = SqliteStorage::open(&path).await.expect("first open");
        sample_paired_device_smoke(&s).await;
    }
    // Second open must succeed without "table already exists" errors.
    let s = SqliteStorage::open(&path).await.expect("second open");
    sample_paired_device_smoke(&s).await;
}

async fn sample_paired_device_smoke<S: Storage>(s: &S) {
    let dev = PairedDevice {
        device_id: DeviceId::new("smoke"),
        user_id: UserId::new("u"),
        desktop_id: DesktopId::new("d"),
        label: "L".into(),
        tier: PermissionTier::ReadOnly,
        paired_at_ms: 1,
        last_seen_ms: None,
        is_primary: true,
        device_pubkey_fingerprint: "fp".into(),
    };
    s.upsert_paired_device(dev.clone()).await.unwrap();
    let got = s.get_paired_device(&dev.device_id).await.unwrap();
    assert_eq!(got, Some(dev));
}

async fn schema_idempotent<S: Storage>(_s: &S) {
    // The factory already ran migrations; a no-op assertion just keeps
    // the parametric helper symmetric with the SQLite-specific
    // `sqlite_migrations_idempotent_on_reopen` test above.
}

async fn paired_device_round_trip<S: Storage>(s: &S) {
    let dev = PairedDevice {
        device_id: DeviceId::new("dev-1"),
        user_id: UserId::new("user-1"),
        desktop_id: DesktopId::new("desk-1"),
        label: "iPhone".into(),
        tier: PermissionTier::Full,
        paired_at_ms: 100,
        last_seen_ms: None,
        is_primary: true,
        device_pubkey_fingerprint: "fp1".into(),
    };
    s.upsert_paired_device(dev.clone()).await.unwrap();
    let back = s.get_paired_device(&dev.device_id).await.unwrap();
    assert_eq!(back, Some(dev));
}

async fn list_paired_filters_by_user<S: Storage>(s: &S) {
    let user_a = UserId::new("a");
    let user_b = UserId::new("b");
    for (i, user) in [(0, &user_a), (1, &user_a), (2, &user_b)] {
        s.upsert_paired_device(PairedDevice {
            device_id: DeviceId::new(format!("dev-{i}")),
            user_id: user.clone(),
            desktop_id: DesktopId::new("desk"),
            label: "L".into(),
            tier: PermissionTier::ReadOnly,
            paired_at_ms: i as i64,
            last_seen_ms: None,
            is_primary: false,
            device_pubkey_fingerprint: "fp".into(),
        })
        .await
        .unwrap();
    }
    let a_list = s.list_paired_devices_for_user(&user_a).await.unwrap();
    assert_eq!(a_list.len(), 2);
    assert!(a_list.iter().all(|d| d.user_id == user_a));
    let b_list = s.list_paired_devices_for_user(&user_b).await.unwrap();
    assert_eq!(b_list.len(), 1);
}

async fn revoke_paired_device_works<S: Storage>(s: &S) {
    let dev = PairedDevice {
        device_id: DeviceId::new("dev-r"),
        user_id: UserId::new("u"),
        desktop_id: DesktopId::new("d"),
        label: "L".into(),
        tier: PermissionTier::ReadOnly,
        paired_at_ms: 0,
        last_seen_ms: None,
        is_primary: false,
        device_pubkey_fingerprint: "fp".into(),
    };
    s.upsert_paired_device(dev.clone()).await.unwrap();
    s.revoke_paired_device(&dev.device_id).await.unwrap();
    let back = s.get_paired_device(&dev.device_id).await.unwrap();
    assert!(back.is_none());
}

async fn set_primary_is_exclusive<S: Storage>(s: &S) {
    let user = UserId::new("u");
    for (i, desk, primary) in [(1, "home", true), (2, "office", false)] {
        s.upsert_paired_device(PairedDevice {
            device_id: DeviceId::new(format!("dev-{i}")),
            user_id: user.clone(),
            desktop_id: DesktopId::new(desk),
            label: "L".into(),
            tier: PermissionTier::ReadOnly,
            paired_at_ms: i,
            last_seen_ms: None,
            is_primary: primary,
            device_pubkey_fingerprint: "fp".into(),
        })
        .await
        .unwrap();
    }
    s.set_primary_desktop(&user, &DesktopId::new("office"))
        .await
        .unwrap();
    let list = s.list_paired_devices_for_user(&user).await.unwrap();
    let primary_count = list.iter().filter(|d| d.is_primary).count();
    assert_eq!(primary_count, 1, "exactly one primary after switch");
    assert_eq!(
        list.iter().find(|d| d.is_primary).unwrap().desktop_id,
        DesktopId::new("office"),
    );
}

async fn update_last_seen<S: Storage>(s: &S) {
    let dev = PairedDevice {
        device_id: DeviceId::new("dev-ls"),
        user_id: UserId::new("u"),
        desktop_id: DesktopId::new("d"),
        label: "L".into(),
        tier: PermissionTier::ReadOnly,
        paired_at_ms: 0,
        last_seen_ms: None,
        is_primary: false,
        device_pubkey_fingerprint: "fp".into(),
    };
    s.upsert_paired_device(dev.clone()).await.unwrap();
    s.update_device_last_seen(&dev.device_id, 9999)
        .await
        .unwrap();
    let back = s.get_paired_device(&dev.device_id).await.unwrap().unwrap();
    assert_eq!(back.last_seen_ms, Some(9999));
}

async fn pending_pairing_round_trip<S: Storage>(s: &S) {
    let p = PendingPairing {
        pairing_code: PairingCode::new("ABCD2345"),
        user_id: UserId::new("u"),
        desktop_id: DesktopId::new("d"),
        requested_tier: PermissionTier::Full,
        confirmation_phrase: ConfirmationPhrase::new("crimson-falcon-beacon-7392"),
        expires_at_ms: 1_000_000,
        claimed_by_device_id: None,
        confirmed_by_desktop: false,
        confirmed_by_mobile: false,
        device_label: None,
        device_pubkey_fingerprint: None,
        desktop_pubkey_fingerprint: "deskfp".into(),
    };
    s.insert_pending_pairing(p.clone()).await.unwrap();
    let back = s.get_pending_pairing(&p.pairing_code).await.unwrap();
    assert_eq!(back, Some(p));
}

async fn mark_claimed_then_confirmed_both_sides<S: Storage>(s: &S) {
    let code = PairingCode::new("CODE2345");
    s.insert_pending_pairing(PendingPairing {
        pairing_code: code.clone(),
        user_id: UserId::new("u"),
        desktop_id: DesktopId::new("d"),
        requested_tier: PermissionTier::ReadOnly,
        confirmation_phrase: ConfirmationPhrase::new("a-b-c-1234"),
        expires_at_ms: 9_999_999_999_999,
        claimed_by_device_id: None,
        confirmed_by_desktop: false,
        confirmed_by_mobile: false,
        device_label: None,
        device_pubkey_fingerprint: None,
        desktop_pubkey_fingerprint: "fp".into(),
    })
    .await
    .unwrap();

    s.mark_pairing_claimed(&code, &DeviceId::new("dev-9"))
        .await
        .unwrap();
    s.mark_pairing_confirmed(&code, ConfirmingSide::Desktop)
        .await
        .unwrap();
    s.mark_pairing_confirmed(&code, ConfirmingSide::Mobile)
        .await
        .unwrap();

    let back = s.get_pending_pairing(&code).await.unwrap().unwrap();
    assert_eq!(back.claimed_by_device_id, Some(DeviceId::new("dev-9")));
    assert!(back.confirmed_by_desktop);
    assert!(back.confirmed_by_mobile);
}

async fn delete_expired_pairings_only_removes_old<S: Storage>(s: &S) {
    let user = UserId::new("u");
    for (suffix, expires) in [("OLD23456", 100i64), ("NEW23456", 9_999_999_999_999i64)] {
        s.insert_pending_pairing(PendingPairing {
            pairing_code: PairingCode::new(suffix),
            user_id: user.clone(),
            desktop_id: DesktopId::new("d"),
            requested_tier: PermissionTier::ReadOnly,
            confirmation_phrase: ConfirmationPhrase::new("x-y-z-1234"),
            expires_at_ms: expires,
            claimed_by_device_id: None,
            confirmed_by_desktop: false,
            confirmed_by_mobile: false,
            device_label: None,
            device_pubkey_fingerprint: None,
            desktop_pubkey_fingerprint: "fp".into(),
        })
        .await
        .unwrap();
    }
    let removed = s.delete_expired_pairings(1_000).await.unwrap();
    assert_eq!(removed, 1);
    assert!(s
        .get_pending_pairing(&PairingCode::new("OLD23456"))
        .await
        .unwrap()
        .is_none());
    assert!(s
        .get_pending_pairing(&PairingCode::new("NEW23456"))
        .await
        .unwrap()
        .is_some());
}

async fn audit_log_is_newest_first<S: Storage>(s: &S) {
    let user = UserId::new("u-audit");
    for (i, ts) in [(0, 100i64), (1, 200), (2, 150)] {
        s.append_audit(AuditEntry {
            user_id: user.clone(),
            device_id: Some(DeviceId::new(format!("dev-{i}"))),
            command: format!("cmd_{i}"),
            ok: true,
            latency_ms: 5,
            occurred_at_ms: ts,
            error_message: None,
        })
        .await
        .unwrap();
    }
    let list = s.list_audit_for_user(&user, 10).await.unwrap();
    assert_eq!(list.len(), 3);
    assert_eq!(list[0].occurred_at_ms, 200);
    assert_eq!(list[1].occurred_at_ms, 150);
    assert_eq!(list[2].occurred_at_ms, 100);

    let limited = s.list_audit_for_user(&user, 1).await.unwrap();
    assert_eq!(limited.len(), 1);
    assert_eq!(limited[0].occurred_at_ms, 200);
}

fn make_record(user: &str, device: &str, command: &str, ok: bool, ts_ms: i64) -> AuditRecord {
    AuditRecord {
        id: 0,
        ts_ms,
        user_id: UserId::new(user),
        device_id: DeviceId::new(device),
        command: command.to_string(),
        ok,
        latency_ms: 5,
        error: if ok { None } else { Some("nope".into()) },
    }
}

async fn audit_record_round_trip<S: Storage>(s: &S) {
    let user = UserId::new("u-rt");
    s.audit_record(make_record("u-rt", "dev-a", "session.send", true, 100))
        .await
        .unwrap();
    s.audit_record(make_record("u-rt", "dev-a", "session.send", true, 200))
        .await
        .unwrap();

    let out = s.audit_query(AuditQuery::for_user(user)).await.unwrap();
    assert_eq!(out.len(), 2);
    assert_eq!(out[0].ts_ms, 200);
    assert_eq!(out[1].ts_ms, 100);
    assert!(
        out.iter().all(|r| r.id > 0),
        "ids must be assigned on insert"
    );
    assert!(out[0].id != out[1].id, "ids must be unique");
}

async fn audit_query_filters_by_dimensions<S: Storage>(s: &S) {
    let user = "u-filter";
    for (i, dev, cmd, ok) in [
        (10i64, "dev-a", "session.send", true),
        (20i64, "dev-b", "session.send", true),
        (30i64, "dev-a", "session.cancel", false),
        (40i64, "dev-a", "session.send", false),
    ] {
        s.audit_record(make_record(user, dev, cmd, ok, i))
            .await
            .unwrap();
    }

    let by_device = s
        .audit_query(AuditQuery {
            device_id: Some(DeviceId::new("dev-a")),
            ..AuditQuery::for_user(UserId::new(user))
        })
        .await
        .unwrap();
    assert_eq!(by_device.len(), 3);
    assert!(by_device.iter().all(|r| r.device_id.as_str() == "dev-a"));

    let by_command = s
        .audit_query(AuditQuery {
            command: Some("session.send".to_string()),
            ..AuditQuery::for_user(UserId::new(user))
        })
        .await
        .unwrap();
    assert_eq!(by_command.len(), 3);
    assert!(by_command.iter().all(|r| r.command == "session.send"));

    let since = s
        .audit_query(AuditQuery {
            since_ts_ms: Some(25),
            ..AuditQuery::for_user(UserId::new(user))
        })
        .await
        .unwrap();
    assert_eq!(since.len(), 2);
    assert!(since.iter().all(|r| r.ts_ms >= 25));

    let only_failures = s
        .audit_query(AuditQuery {
            ok_only: Some(false),
            ..AuditQuery::for_user(UserId::new(user))
        })
        .await
        .unwrap();
    assert_eq!(only_failures.len(), 2);
    assert!(only_failures.iter().all(|r| !r.ok));

    let only_successes = s
        .audit_query(AuditQuery {
            ok_only: Some(true),
            ..AuditQuery::for_user(UserId::new(user))
        })
        .await
        .unwrap();
    assert_eq!(only_successes.len(), 2);
    assert!(only_successes.iter().all(|r| r.ok));
}

async fn audit_query_scopes_to_user<S: Storage>(s: &S) {
    s.audit_record(make_record("u-scope-a", "dev-a", "cmd", true, 1))
        .await
        .unwrap();
    s.audit_record(make_record("u-scope-b", "dev-b", "cmd", true, 2))
        .await
        .unwrap();

    // u-scope-a must NEVER see u-scope-b's row, even though no
    // device_id / command filter is set.
    let a_view = s
        .audit_query(AuditQuery::for_user(UserId::new("u-scope-a")))
        .await
        .unwrap();
    assert_eq!(a_view.len(), 1);
    assert_eq!(a_view[0].user_id.as_str(), "u-scope-a");

    let b_view = s
        .audit_query(AuditQuery::for_user(UserId::new("u-scope-b")))
        .await
        .unwrap();
    assert_eq!(b_view.len(), 1);
    assert_eq!(b_view[0].user_id.as_str(), "u-scope-b");
}

async fn audit_query_caps_limit_at_max<S: Storage>(s: &S) {
    let user = "u-cap";
    for i in 0..5i64 {
        s.audit_record(make_record(user, "dev", "cmd", true, i))
            .await
            .unwrap();
    }

    // limit=2 honored.
    let two = s
        .audit_query(AuditQuery {
            limit: Some(2),
            ..AuditQuery::for_user(UserId::new(user))
        })
        .await
        .unwrap();
    assert_eq!(two.len(), 2);

    // limit=10000 silently clamped to AUDIT_QUERY_MAX_LIMIT (1000) but
    // since we only have 5 rows the visible result is 5.
    let huge = s
        .audit_query(AuditQuery {
            limit: Some(10_000),
            ..AuditQuery::for_user(UserId::new(user))
        })
        .await
        .unwrap();
    assert_eq!(huge.len(), 5);

    // No limit => default (100), again capped naturally by row count.
    let default_limit = s
        .audit_query(AuditQuery::for_user(UserId::new(user)))
        .await
        .unwrap();
    assert_eq!(default_limit.len(), 5);
}

async fn connection_open_then_close_records_bytes<S: Storage>(s: &S) {
    let entry = ConnectionHistoryEntry {
        user_id: UserId::new("u"),
        peer_role: PeerKind::Mobile,
        peer_id: "dev-1".into(),
        connected_at_ms: 1,
        disconnected_at_ms: None,
        bytes_sent: 0,
        bytes_received: 0,
    };
    let row_id = s.record_connection_open(entry).await.unwrap();
    assert!(row_id > 0);
    s.record_connection_close(row_id, 999, 1024, 2048)
        .await
        .unwrap();
    // Closing a non-existent row must error rather than silently
    // succeed.
    let bad = s.record_connection_close(999_999, 0, 0, 0).await;
    assert!(bad.is_err(), "missing row must error: {bad:?}");
}
