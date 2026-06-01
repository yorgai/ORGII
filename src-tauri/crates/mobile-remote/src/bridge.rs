//! Mobile-remote bridge lifecycle. Owns the outbound WS to the relay
//! plus the dispatch task that consumes inbound `RpcCall` frames and
//! forwards each to a `DispatchHost` (production: `TauriDispatchHost`).
//!
//! Startup sequence (called from `lib.rs::run` on `setup`):
//!   1. Read paired devices file. If empty, skip — nothing to do.
//!   2. Read relay URL config.
//!   3. Construct `RelayWsClient` + `TauriDispatchHost`.
//!   4. Spawn the connect-with-reconnect loop.
//!   5. Spawn the dispatch loop: pull RpcCall from `inbound_rx`,
//!      resolve the per-device tier via `call.source_device_id`,
//!      route to host, push RpcResult into the connection's
//!      `outbound_tx`.
//!
//! Shutdown is graceful via [`MobileRemoteBridge::stop`], which
//! aborts the spawned tasks and waits ~2s for them to drain before
//! detaching. The bridge stores its task handles in an
//! `Arc<Mutex<Vec<JoinHandle<…>>>>` so [`BridgeSupervisor`] (the
//! singleton above us in `lib.rs`) can call `stop` mid-process and
//! then re-enter `start` with the latest relay URL / device tier
//! map without restarting the whole app.
//!
//! ## Per-call tier
//!
//! The relay does its own tier check before forwarding `RpcCall` to a
//! desktop, so the bridge mirroring that gate is defence-in-depth
//! rather than primary enforcement. Phase 6 makes this lookup
//! per-device: every inbound `RpcCall` carries `source_device_id`
//! (stamped by the relay from the mobile peer's authenticated WS
//! handshake), and the bridge resolves the tier against
//! `device_tiers`. If the source id is not present in the local
//! cache the bridge falls back to the primary device's tier and emits
//! a `warn!` — defensive against the local cache lagging relay state
//! until `mobile_remote_sync_devices` reconciles them.

use std::collections::HashMap;
use std::sync::Arc;

use orgii_protocol::{DeviceId, Frame, PermissionTier, RpcCall, UserId};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tracing::{info, warn};

use crate::audit::AuditLogger;
use crate::config::get_relay_url;
use crate::dispatch::{dispatch_rpc, DispatchHost};
use crate::error::MobileRemoteError;
use crate::pairing::desktop_identity::load_or_create_desktop_id;
use crate::pairing::storage::{load_paired_devices, PairedDeviceRecord};
use crate::relay_client::{RelayWsClient, WsLifecycleEvent};

/// Placeholder `UserId` until the relay supports a real auth token.
/// Mirrors `pairing::commands::PLACEHOLDER_USER_ID`; kept duplicated
/// rather than re-exported so the pairing module's value can change
/// independently of the bridge's.
const PLACEHOLDER_USER_ID: &str = "local-user";

/// Lifetime owner for the running bridge. Holds the spawned task
/// handles in an `Arc<Mutex<…>>` so Phase 7 shutdown can abort them
/// without re-plumbing the public surface.
pub struct MobileRemoteBridge {
    inner: Arc<BridgeInner>,
}

/// Cheap-to-clone state shared across the spawned tasks.
struct BridgeInner {
    /// Per-device permission tier, looked up on every inbound RPC by
    /// `RpcCall.source_device_id`. The relay stamps that field from
    /// the mobile peer's authenticated WS handshake so it is the
    /// authoritative actor identifier — a `view-only` paired phone
    /// can no longer leak into a `read-write` slot just because some
    /// other paired device happens to be primary.
    device_tiers: HashMap<DeviceId, PermissionTier>,
    /// Tier of the primary paired device. Used as a defensive fallback
    /// when an inbound call's `source_device_id` is not in
    /// `device_tiers` — should not happen in practice (the relay only
    /// forwards calls from devices it has paired records for), but
    /// the local cache may briefly lag relay state until
    /// `mobile_remote_sync_devices` reconciles them.
    fallback_tier: PermissionTier,
    /// Task handles for the connect loop and the dispatch loop. Held
    /// behind a mutex so a future shutdown surface can abort them
    /// without racing the spawn site.
    handles: Mutex<Vec<JoinHandle<()>>>,
}

impl BridgeInner {
    /// Resolve the [`PermissionTier`] for an inbound [`RpcCall`].
    ///
    /// Returns the tier registered for `call.source_device_id` if the
    /// device is in the local cache. Otherwise emits a warn-level
    /// trace and returns the primary's `fallback_tier` so the call is
    /// not silently dropped — the relay has already done its own tier
    /// check and the mismatch here points at a desktop-side cache
    /// staleness bug, not at a malicious call.
    fn resolve_tier(&self, call: &RpcCall) -> PermissionTier {
        match self.device_tiers.get(&call.source_device_id) {
            Some(tier) => *tier,
            None => {
                warn!(
                    target: "mobile_remote::bridge",
                    source_device_id = %call.source_device_id,
                    fallback_tier = ?self.fallback_tier,
                    command = %call.command,
                    "source_device_id not in local paired-devices cache; \
                     falling back to primary tier (cache may lag relay state)"
                );
                self.fallback_tier
            }
        }
    }
}

/// Build the per-device tier map keyed by [`DeviceId`] for fast
/// per-call lookup. Keeping this carved out of `start()` makes it
/// directly unit-testable without a Tauri runtime.
fn build_device_tier_map(records: &[PairedDeviceRecord]) -> HashMap<DeviceId, PermissionTier> {
    records
        .iter()
        .map(|record| (DeviceId::new(record.device_id.clone()), record.tier))
        .collect()
}

impl MobileRemoteBridge {
    /// Start the bridge given a pre-built [`DispatchHost`].
    /// Non-blocking — spawns background tasks. If the user has no
    /// paired devices, returns `Ok(None)` and doesn't open a WS at
    /// all (no-op startup is the expected state for fresh installs).
    ///
    /// The host is supplied by the caller (production: `app::lib.rs`
    /// hands in a `TauriDispatchHost` it built from the live
    /// `AppHandle`) so this crate stays a pure leaf — bridge code
    /// itself never reaches into `agent_core` or `agent_sessions`.
    ///
    /// If pairing storage is corrupt, propagates the error so the
    /// caller can surface "your local pairing file is corrupt" to the
    /// user. If the relay is currently unreachable, that's NOT a
    /// `start` error — the reconnect loop owns recovery.
    pub async fn start(
        host: Arc<dyn DispatchHost + Send + Sync + 'static>,
    ) -> Result<Option<Self>, MobileRemoteError> {
        let paired = load_paired_devices()?;
        let primary = match select_primary(&paired) {
            Some(record) => record,
            None => {
                info!(
                    target: "mobile_remote::bridge",
                    "no paired devices on disk; bridge inactive"
                );
                return Ok(None);
            }
        };

        let fallback_tier = primary.tier;
        let device_tiers = build_device_tier_map(&paired);

        let relay = get_relay_url();
        let desktop_id = load_or_create_desktop_id()?;

        let user_id = UserId::new(PLACEHOLDER_USER_ID);
        let mut ws = RelayWsClient::new(relay.url.clone(), user_id.clone(), desktop_id);
        let lifecycle_rx = ws
            .take_lifecycle_rx()
            .expect("freshly-constructed client must yield its lifecycle rx");

        // Single shared `reqwest::Client` (and therefore a single
        // shared connection pool) for every audit POST emitted from
        // every dispatched RPC for the lifetime of the bridge.
        let http_client = reqwest::Client::new();
        let audit = AuditLogger::new(relay.url, user_id, http_client);

        let inner = Arc::new(BridgeInner {
            device_tiers,
            fallback_tier,
            handles: Mutex::new(Vec::new()),
        });

        // Spawn the connect-with-reconnect loop. The outer task owns
        // the WS client; the dispatch loop reads frames out of it via
        // `inbound_rx`.
        let connect_handle = spawn_connect_loop(ws, host, Arc::clone(&inner), lifecycle_rx, audit);
        inner.handles.lock().await.push(connect_handle);

        Ok(Some(Self { inner }))
    }

    /// Whether the bridge currently has its connect-loop task spawned.
    /// True immediately after [`start`] returns `Ok(Some(_))`. We use
    /// `try_lock` so the call is non-blocking; if the mutex is held
    /// (extremely unlikely outside Phase 7 shutdown work) we
    /// conservatively report `true` because the bridge IS doing
    /// something.
    pub fn is_running(&self) -> bool {
        match self.inner.handles.try_lock() {
            Ok(guard) => guard.iter().any(|h| !h.is_finished()),
            Err(_) => true,
        }
    }

    /// Stop the bridge: abort the spawned connect / dispatch task(s)
    /// and wait briefly for them to exit. Best-effort — any task that
    /// hasn't drained within [`SHUTDOWN_TIMEOUT`] is detached. Idempotent;
    /// safe to call on an already-stopped bridge.
    ///
    /// This is the teardown half of the [`BridgeSupervisor`] start /
    /// stop / restart loop, used when the user changes the relay URL
    /// or pairs / revokes a device through the Settings UI. Closing
    /// the WS via `RelayWsClient::disconnect` is owned by the
    /// connect-loop itself (it calls disconnect on every dispatch
    /// session exit); aborting the outer task is enough to interrupt
    /// any in-flight `connect_with_reconnect` and let the runtime
    /// drop the WS socket on cleanup.
    pub async fn stop(&self) {
        let handles: Vec<JoinHandle<()>> = {
            let mut guard = self.inner.handles.lock().await;
            std::mem::take(&mut *guard)
        };

        if handles.is_empty() {
            return;
        }

        for handle in &handles {
            handle.abort();
        }

        // Race the joins against a small deadline so a stuck task
        // doesn't block the URL-setter command (which the user is
        // waiting on synchronously). Any task still alive after this
        // is detached — the runtime drops it when the process exits.
        let join_all = async {
            for handle in handles {
                let _ = handle.await;
            }
        };
        if tokio::time::timeout(SHUTDOWN_TIMEOUT, join_all)
            .await
            .is_err()
        {
            warn!(
                target: "mobile_remote::bridge",
                "stop timed out after {}s; detaching remaining tasks",
                SHUTDOWN_TIMEOUT.as_secs()
            );
        }
    }
}

/// Maximum time [`MobileRemoteBridge::stop`] waits for spawned tasks
/// to exit after `abort()`. Mirrors the WS client's disconnect budget
/// so a teardown-then-restart never spends more than ~4s end-to-end.
const SHUTDOWN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

#[cfg(test)]
impl MobileRemoteBridge {
    /// Construct a bridge from pre-spawned task handles, bypassing
    /// the relay / dispatch wiring. Used by `stop()` and supervisor
    /// tests that need a real `JoinHandle` (so `abort()` is observable
    /// via `is_finished`) without standing up a Tauri runtime.
    pub(crate) fn from_handles_for_test(handles: Vec<JoinHandle<()>>) -> Self {
        Self {
            inner: Arc::new(BridgeInner {
                device_tiers: HashMap::new(),
                fallback_tier: PermissionTier::ReadOnly,
                handles: Mutex::new(handles),
            }),
        }
    }
}

impl std::fmt::Debug for MobileRemoteBridge {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MobileRemoteBridge")
            .field("paired_devices", &self.inner.device_tiers.len())
            .field("fallback_tier", &self.inner.fallback_tier)
            .finish_non_exhaustive()
    }
}

/// Pick the paired device whose tier the bridge will use for inbound
/// RPCs. Prefers `is_primary == true`; falls back to the first record
/// in the file. Returns `None` only when the list is empty.
fn select_primary(records: &[PairedDeviceRecord]) -> Option<&PairedDeviceRecord> {
    records
        .iter()
        .find(|record| record.is_primary)
        .or_else(|| records.first())
}

/// Drive the connect-with-reconnect loop and dispatch inbound RPCs.
/// The same task owns the WS client throughout — `ws.inbound_rx()`
/// only hands back a `&mut`, so we cannot split inbound reading off to
/// a sibling task without an extra forwarder. Phase 4 accepts
/// sequential dispatch (the routed commands are read-only / cheap).
/// Phase 7 may revisit if mutating commands need long-running tasks.
fn spawn_connect_loop(
    mut ws: RelayWsClient,
    host: Arc<dyn DispatchHost + Send + Sync + 'static>,
    inner: Arc<BridgeInner>,
    mut lifecycle_rx: tokio::sync::mpsc::UnboundedReceiver<WsLifecycleEvent>,
    audit: AuditLogger,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            // First / next attempt. `connect_with_reconnect` only
            // returns `Err` if a non-recoverable invariant is
            // violated (today: never), so the `Err` arm is purely
            // defensive.
            if let Err(err) = ws.connect_with_reconnect().await {
                warn!(
                    target: "mobile_remote::bridge",
                    ?err,
                    "connect_with_reconnect surfaced a hard error; sleeping before retry"
                );
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                continue;
            }

            // Drain any pre-existing `Connected` lifecycle event so
            // the disconnect-watcher below only sees fresh signals.
            let _ = lifecycle_rx.try_recv();

            run_dispatch_session(&mut ws, &host, &inner, &mut lifecycle_rx, &audit).await;

            // Tear down the stale connection bookkeeping so the
            // next `connect_with_reconnect` actually re-handshakes
            // instead of seeing `is_connected == true` and short-
            // circuiting. `disconnect` is best-effort (may already
            // be torn down) and bounded to ~2s.
            ws.disconnect().await;

            if lifecycle_rx.is_closed() {
                info!(
                    target: "mobile_remote::bridge",
                    "lifecycle channel closed; bridge connect loop exiting"
                );
                break;
            }
        }
    })
}

/// Run one connected dispatch session. Reads inbound `RpcCall`s and
/// dispatches them on the current task; cooperatively yields to the
/// lifecycle channel so a `Disconnected` event short-circuits the
/// loop and lets the outer connect loop reconnect.
async fn run_dispatch_session(
    ws: &mut RelayWsClient,
    host: &Arc<dyn DispatchHost + Send + Sync + 'static>,
    inner: &Arc<BridgeInner>,
    lifecycle_rx: &mut tokio::sync::mpsc::UnboundedReceiver<WsLifecycleEvent>,
    audit: &AuditLogger,
) {
    // Snapshot the outbound sender before borrowing the inbound
    // receiver — `outbound_tx()` takes `&self` while `inbound_rx()`
    // takes `&mut self`, so the order matters to satisfy the
    // borrow-checker without an `unsafe` scope.
    let outbound_tx = ws.outbound_tx();
    let inbound_rx = ws.inbound_rx();
    loop {
        tokio::select! {
            // Inbound RPC.
            maybe_call = inbound_rx.recv() => {
                match maybe_call {
                    Some(call) => {
                        // Per-device tier lookup: the relay stamped
                        // `source_device_id` from the mobile peer's
                        // authenticated handshake, so we look the
                        // tier up against that — never against the
                        // primary's tier, which would let a
                        // view-only phone trigger a read-write
                        // command in mixed-tier topologies.
                        let tier = inner.resolve_tier(&call);
                        let result = dispatch_rpc(host.as_ref(), call, tier, audit).await;
                        let frame = Frame::RpcResult(result);
                        if let Some(tx) = outbound_tx.as_ref() {
                            if let Err(err) = tx.send(frame) {
                                warn!(
                                    target: "mobile_remote::bridge",
                                    %err,
                                    "outbound channel closed mid-session; ending session"
                                );
                                return;
                            }
                        } else {
                            warn!(
                                target: "mobile_remote::bridge",
                                "no outbound sender; dropping RpcResult"
                            );
                        }
                    }
                    None => {
                        info!(
                            target: "mobile_remote::bridge",
                            "inbound channel closed; ending dispatch session"
                        );
                        return;
                    }
                }
            }
            // Lifecycle signal.
            event = lifecycle_rx.recv() => {
                match event {
                    Some(WsLifecycleEvent::Connected) => continue,
                    Some(WsLifecycleEvent::Disconnected { reason }) => {
                        info!(
                            target: "mobile_remote::bridge",
                            %reason,
                            "ws disconnected; ending dispatch session"
                        );
                        return;
                    }
                    None => return,
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "bridge_tests.rs"]
mod tests;
