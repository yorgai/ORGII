//! Tests for [`MobileRemoteBridge`].
//!
//! `MobileRemoteBridge::start` requires a `tauri::AppHandle` which
//! cannot be constructed without a Tauri runtime, and our pairing
//! storage path resolves through `dirs::home_dir()` (no DI seam). We
//! therefore restrict these tests to the pure helpers carved out of
//! the bridge module — `select_primary`, `build_device_tier_map`,
//! and `BridgeInner::resolve_tier` — plus the `is_running` accessor's
//! semantics where we can fake the inner state.
//!
//! Once the Tauri test harness lands (Phase 7), real `start()` tests
//! can drive a temp-dir paired-devices file and assert on the
//! returned `Option<MobileRemoteBridge>`.

use std::io;
use std::sync::{Arc as StdArc, Mutex as StdMutex};
use std::time::Duration;

use orgii_protocol::{DesktopId, DeviceId, PermissionTier, RpcCall, RpcId};
use tokio::sync::Mutex;
use tracing::subscriber::with_default;
use tracing_subscriber::fmt;
use tracing_subscriber::fmt::MakeWriter;

use super::*;
use crate::pairing::storage::PairedDeviceRecord;

fn record(device_id: &str, is_primary: bool, tier: PermissionTier) -> PairedDeviceRecord {
    PairedDeviceRecord {
        device_id: device_id.to_owned(),
        desktop_id: "desk-test".to_owned(),
        label: "test".to_owned(),
        tier,
        is_primary,
        paired_at_ms: 0,
        last_seen_ms: None,
        device_pubkey_fingerprint: "abc".to_owned(),
    }
}

#[test]
fn select_primary_returns_none_for_empty_list() {
    let records: Vec<PairedDeviceRecord> = Vec::new();
    assert!(select_primary(&records).is_none());
}

#[test]
fn select_primary_prefers_explicit_primary_flag() {
    let records = vec![
        record("dev-1", false, PermissionTier::ReadOnly),
        record("dev-2", true, PermissionTier::Full),
        record("dev-3", false, PermissionTier::ReadOnly),
    ];
    let chosen = select_primary(&records).expect("non-empty list returns Some");
    assert_eq!(chosen.device_id, "dev-2");
    assert_eq!(chosen.tier, PermissionTier::Full);
}

#[test]
fn select_primary_falls_back_to_first_when_no_primary_flag() {
    let records = vec![
        record("dev-1", false, PermissionTier::ReadOnly),
        record("dev-2", false, PermissionTier::Full),
    ];
    let chosen = select_primary(&records).expect("non-empty list returns Some");
    assert_eq!(chosen.device_id, "dev-1");
    assert_eq!(chosen.tier, PermissionTier::ReadOnly);
}

/// Smoke test that the placeholder user id constant is non-empty and
/// matches the value used by the pairing module — the relay rejects
/// connections whose handshake `X-User-Id` doesn't line up with the
/// pairing-time value.
#[test]
fn placeholder_user_id_is_non_empty() {
    assert!(!PLACEHOLDER_USER_ID.is_empty());
}

// ============================================================
// Per-device tier resolution (Phase 6)
// ============================================================

fn build_inner(tiers: HashMap<DeviceId, PermissionTier>, fallback: PermissionTier) -> BridgeInner {
    BridgeInner {
        device_tiers: tiers,
        fallback_tier: fallback,
        handles: Mutex::new(Vec::new()),
    }
}

fn make_call(source_device_id: &str, command: &str) -> RpcCall {
    RpcCall {
        id: RpcId::new("req-test"),
        target_desktop_id: DesktopId::new("desk-test"),
        source_device_id: DeviceId::new(source_device_id),
        command: command.to_owned(),
        args: serde_json::Value::Null,
    }
}

#[test]
fn build_device_tier_map_keys_by_device_id_newtype() {
    let records = vec![
        record("dev-1", true, PermissionTier::Full),
        record("dev-2", false, PermissionTier::ReadOnly),
    ];
    let map = build_device_tier_map(&records);
    assert_eq!(map.len(), 2);
    assert_eq!(
        map.get(&DeviceId::new("dev-1")),
        Some(&PermissionTier::Full)
    );
    assert_eq!(
        map.get(&DeviceId::new("dev-2")),
        Some(&PermissionTier::ReadOnly)
    );
}

#[test]
fn resolve_tier_uses_per_device_lookup_when_source_known() {
    // Topology: primary = read-write desktop, secondary = view-only
    // phone. Phase 4 used the primary's tier for everything; Phase 6
    // must resolve per-device so the phone is held to its own tier.
    let mut tiers = HashMap::new();
    tiers.insert(DeviceId::new("dev-primary"), PermissionTier::Full);
    tiers.insert(DeviceId::new("dev-phone"), PermissionTier::ReadOnly);
    let inner = build_inner(tiers, PermissionTier::Full);

    let phone_call = make_call("dev-phone", "sessions_list");
    assert_eq!(
        inner.resolve_tier(&phone_call),
        PermissionTier::ReadOnly,
        "view-only phone must resolve to ReadOnly even when fallback is Full"
    );

    let primary_call = make_call("dev-primary", "session_create");
    assert_eq!(
        inner.resolve_tier(&primary_call),
        PermissionTier::Full,
        "primary device resolves to its own tier"
    );
}

/// `MakeWriter` that captures every emitted byte into a shared `Vec<u8>`
/// so a unit test can assert that `tracing` produced specific output.
#[derive(Clone, Default)]
struct CaptureWriter(StdArc<StdMutex<Vec<u8>>>);

struct CaptureGuard(StdArc<StdMutex<Vec<u8>>>);

impl io::Write for CaptureGuard {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0
            .lock()
            .map_err(|_| io::Error::other("capture buffer poisoned"))?
            .extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl<'a> MakeWriter<'a> for CaptureWriter {
    type Writer = CaptureGuard;
    fn make_writer(&'a self) -> Self::Writer {
        CaptureGuard(StdArc::clone(&self.0))
    }
}

impl CaptureWriter {
    fn snapshot(&self) -> String {
        let guard = self.0.lock().expect("capture buffer poisoned");
        String::from_utf8_lossy(&guard).into_owned()
    }
}

#[test]
fn resolve_tier_falls_back_and_emits_warn_for_unknown_source_device_id() {
    // The local cache may briefly lag relay state until
    // `mobile_remote_sync_devices` reconciles them. In that window an
    // inbound `RpcCall` may carry a `source_device_id` we haven't
    // recorded yet. The bridge must NOT silently drop the call — the
    // relay already gated it — but it MUST emit a warn-level trace
    // so the staleness shows up in operational dashboards.
    let mut tiers = HashMap::new();
    tiers.insert(DeviceId::new("dev-known"), PermissionTier::ReadOnly);
    let inner = build_inner(tiers, PermissionTier::Full);

    let writer = CaptureWriter::default();
    let subscriber = fmt::Subscriber::builder()
        .with_max_level(tracing::Level::WARN)
        .with_writer(writer.clone())
        .with_ansi(false)
        .finish();

    let call = make_call("dev-stale-not-in-cache", "sessions_list");
    let resolved = with_default(subscriber, || inner.resolve_tier(&call));

    assert_eq!(
        resolved,
        PermissionTier::Full,
        "unknown source falls back to primary's tier"
    );

    let captured = writer.snapshot();
    assert!(
        captured.contains("WARN"),
        "expected WARN-level trace, got: {captured}"
    );
    assert!(
        captured.contains("dev-stale-not-in-cache"),
        "expected captured trace to include the unknown source device id, got: {captured}"
    );
    assert!(
        captured.contains("mobile_remote::bridge"),
        "expected trace target to be mobile_remote::bridge, got: {captured}"
    );
}

// ============================================================
// Graceful shutdown (P1b)
// ============================================================

/// `stop()` aborts a spawned task that would otherwise run forever
/// and lets `is_running()` flip to `false` before the timeout fires.
/// This is the load-bearing primitive for [`BridgeSupervisor::restart`]:
/// without it, a relay-URL change would either leak the old task or
/// race a fresh `start` against the still-live connect loop.
#[tokio::test]
async fn stop_aborts_spawned_task_and_flips_is_running() {
    let handle = tokio::spawn(async {
        // Sleep way past the supervisor's 2s shutdown budget. Without
        // `abort()` the test would hang here.
        tokio::time::sleep(Duration::from_secs(60)).await;
    });
    let bridge = MobileRemoteBridge::from_handles_for_test(vec![handle]);
    assert!(bridge.is_running(), "fresh bridge should report running");

    bridge.stop().await;

    assert!(
        !bridge.is_running(),
        "after stop the connect-loop task must be aborted and is_running must be false"
    );
}

/// Calling `stop()` twice is a no-op the second time. The supervisor
/// relies on this when the user clicks "Save" with the same URL still
/// in the field — the idempotency check skips the restart, but a
/// future re-arrangement of the call order shouldn't be able to
/// double-stop into a panic.
#[tokio::test]
async fn stop_is_idempotent() {
    let handle = tokio::spawn(async {});
    let bridge = MobileRemoteBridge::from_handles_for_test(vec![handle]);
    bridge.stop().await;
    bridge.stop().await;
    assert!(!bridge.is_running());
}
