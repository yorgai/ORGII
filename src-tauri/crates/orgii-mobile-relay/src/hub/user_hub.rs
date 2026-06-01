//! Per-user routing actor.
//!
//! A `UserHub` owns the live mpsc senders for every connected desktop
//! and mobile peer belonging to a single `UserId`. Frames are routed
//! by matching the target ID against the appropriate map; broadcasts
//! fan out to every mobile sender for the user.
//!
//! The senders are typed `mpsc::UnboundedSender<Frame>` even though
//! Phase 2 has no WebSocket handler installed yet. The handle
//! abstraction is what a future WS handler plugs into — see Phase
//! 2.5/3 in the design doc.
//!
//! Routing is single-user only by construction: a `UserHub` is
//! retrieved from the [`super::registry::UserHubRegistry`] keyed by
//! `UserId`, so a mobile peer paired to user A can never address
//! peers belonging to user B.

use std::collections::HashMap;

use orgii_protocol::{DesktopId, DeviceId, Frame, RpcCall, RpcId, RpcResult, UserId};
use thiserror::Error;
use tokio::sync::{mpsc, RwLock};

/// Failure modes for [`UserHub::route_to_desktop`] /
/// [`UserHub::route_to_mobile`]. Wrapped into `RelayError::Protocol`
/// at the handler boundary so callers can return typed responses.
#[derive(Debug, Error)]
pub enum RouteError {
    /// No peer with the requested ID is currently registered.
    #[error("peer not connected")]
    PeerNotConnected,
    /// The peer's mpsc receiver was dropped (peer is in the middle of
    /// disconnecting). The hub will GC the entry on the next call.
    #[error("peer channel closed")]
    ChannelClosed,
    /// The inbound desktop result references an `RpcId` the relay has
    /// no pending mobile origin for. Either the call timed out and the
    /// originator already cleaned up, or the desktop fabricated an id.
    /// Either way the relay drops the result and warns.
    #[error("no pending mobile origin for rpc id")]
    UnknownRpcId,
}

pub struct UserHub {
    user_id: UserId,
    desktops: RwLock<HashMap<DesktopId, mpsc::UnboundedSender<Frame>>>,
    mobiles: RwLock<HashMap<DeviceId, mpsc::UnboundedSender<Frame>>>,
    /// In-flight mobile-originated RPC calls, keyed by `RpcId`. Filled
    /// in [`UserHub::forward_rpc_call`] right before the desktop
    /// receives the call; drained in [`UserHub::route_result_to_mobile`]
    /// when the desktop's `RpcResult` comes back. Without this map the
    /// relay would have no way to know which connected mobile peer
    /// originated a given result, since `RpcResult` only carries an
    /// `RpcId`.
    ///
    /// Entries are also pruned in [`UserHub::unregister_mobile_peer`]
    /// so a mobile reconnect doesn't accumulate orphaned correlations
    /// from a previous connection.
    pending_calls: RwLock<HashMap<RpcId, DeviceId>>,
}

impl UserHub {
    pub fn new(user_id: UserId) -> Self {
        Self {
            user_id,
            desktops: RwLock::new(HashMap::new()),
            mobiles: RwLock::new(HashMap::new()),
            pending_calls: RwLock::new(HashMap::new()),
        }
    }

    /// Owning `UserId` of this hub. Useful for logging.
    pub fn user_id(&self) -> &UserId {
        &self.user_id
    }

    pub async fn register_desktop(
        &self,
        desktop_id: DesktopId,
        sender: mpsc::UnboundedSender<Frame>,
    ) {
        let mut desks = self.desktops.write().await;
        desks.insert(desktop_id, sender);
    }

    /// Install the mpsc sender for a freshly-upgraded mobile WS peer.
    /// The handler must call [`UserHub::unregister_mobile_peer`] on
    /// disconnect so the entry doesn't leak.
    pub async fn register_mobile_peer(
        &self,
        device_id: DeviceId,
        sender: mpsc::UnboundedSender<Frame>,
    ) {
        let mut mobs = self.mobiles.write().await;
        mobs.insert(device_id, sender);
    }

    pub async fn unregister_desktop(&self, desktop_id: &DesktopId) {
        let mut desks = self.desktops.write().await;
        desks.remove(desktop_id);
    }

    /// Drop the mpsc sender for a mobile peer and prune any pending
    /// RPC correlations it owned. A reconnect under the same
    /// `DeviceId` therefore starts with a clean correlation map and
    /// never delivers stale results from a previous connection.
    pub async fn unregister_mobile_peer(&self, device_id: &DeviceId) {
        {
            let mut mobs = self.mobiles.write().await;
            mobs.remove(device_id);
        }
        let mut pending = self.pending_calls.write().await;
        pending.retain(|_id, dev| dev != device_id);
    }

    /// Send a frame to a specific desktop. Returns
    /// `RouteError::PeerNotConnected` if no desktop is registered
    /// under that ID, `RouteError::ChannelClosed` if the receiving
    /// half has been dropped.
    pub async fn route_to_desktop(
        &self,
        target: &DesktopId,
        frame: Frame,
    ) -> Result<(), RouteError> {
        let sender = {
            let desks = self.desktops.read().await;
            match desks.get(target) {
                Some(s) => s.clone(),
                None => return Err(RouteError::PeerNotConnected),
            }
        };
        sender.send(frame).map_err(|_| RouteError::ChannelClosed)
    }

    /// Forward a mobile-originated [`RpcCall`] to its destination
    /// desktop, stamping `source_device_id` from the inbound mobile
    /// peer's authenticated [`DeviceId`]. The relay is the single
    /// source of truth for this field — anything the mobile client
    /// already filled in is overwritten before forwarding.
    ///
    /// This is the canonical site where the per-device permission
    /// invariant is established: the desktop bridge looks the tier up
    /// against `source_device_id`, so if the relay forgot to stamp
    /// (or stamped the wrong device), every per-device tier check
    /// downstream collapses. Routing failures map to the same
    /// [`RouteError`] variants as [`route_to_desktop`].
    pub async fn forward_rpc_call(
        &self,
        inbound_device_id: &DeviceId,
        mut call: RpcCall,
    ) -> Result<(), RouteError> {
        call.source_device_id = inbound_device_id.clone();
        let target = call.target_desktop_id.clone();
        let rpc_id = call.id.clone();
        // Record the correlation BEFORE attempting to deliver, so a
        // racing result frame from the desktop is never received
        // before the map entry exists. If delivery fails we roll the
        // entry back so the map stays a tight upper bound on truly
        // in-flight calls.
        {
            let mut pending = self.pending_calls.write().await;
            pending.insert(rpc_id.clone(), inbound_device_id.clone());
        }
        match self.route_to_desktop(&target, Frame::RpcCall(call)).await {
            Ok(()) => Ok(()),
            Err(err) => {
                let mut pending = self.pending_calls.write().await;
                pending.remove(&rpc_id);
                Err(err)
            }
        }
    }

    /// Route a desktop-originated [`RpcResult`] back to the mobile peer
    /// that issued the matching call. Looks up the `RpcId` in the
    /// `pending_calls` correlation map, drains the entry, and forwards
    /// the wrapped [`Frame::RpcResult`] over the mobile's mpsc sender.
    ///
    /// Returns [`RouteError::UnknownRpcId`] when the result references
    /// an id we have no pending entry for (call timed out, mobile
    /// disconnected, or the desktop fabricated the id). Returns
    /// [`RouteError::PeerNotConnected`] / [`RouteError::ChannelClosed`]
    /// when the originating mobile is no longer reachable; in that
    /// case the correlation entry is still consumed (the result has
    /// nowhere to go either way).
    pub async fn route_result_to_mobile(&self, result: RpcResult) -> Result<(), RouteError> {
        let rpc_id = result.id().clone();
        let device_id = {
            let mut pending = self.pending_calls.write().await;
            match pending.remove(&rpc_id) {
                Some(d) => d,
                None => return Err(RouteError::UnknownRpcId),
            }
        };
        self.route_to_mobile(&device_id, Frame::RpcResult(result))
            .await
    }

    /// Snapshot of currently in-flight (`RpcId` → originating mobile
    /// `DeviceId`) correlations. Read-only; used by tests and future
    /// `/metrics` surfaces.
    pub async fn pending_call_count(&self) -> usize {
        self.pending_calls.read().await.len()
    }

    pub async fn route_to_mobile(
        &self,
        device_id: &DeviceId,
        frame: Frame,
    ) -> Result<(), RouteError> {
        let sender = {
            let mobs = self.mobiles.read().await;
            match mobs.get(device_id) {
                Some(s) => s.clone(),
                None => return Err(RouteError::PeerNotConnected),
            }
        };
        sender.send(frame).map_err(|_| RouteError::ChannelClosed)
    }

    /// Fanout: deliver `frame` to every connected mobile peer for
    /// this user. Used for `Frame::Event` and `Frame::DesktopStatus`
    /// broadcasts. Closed channels are silently skipped (the WS
    /// handler will GC them on its next tick); we deliberately don't
    /// hold the write lock here because that would serialize all
    /// fanouts.
    pub async fn broadcast_to_mobiles(&self, frame: Frame) {
        let snapshot: Vec<mpsc::UnboundedSender<Frame>> = {
            let mobs = self.mobiles.read().await;
            mobs.values().cloned().collect()
        };
        for sender in snapshot {
            let _ = sender.send(frame.clone());
        }
    }

    pub async fn list_connected_desktops(&self) -> Vec<DesktopId> {
        let desks = self.desktops.read().await;
        desks.keys().cloned().collect()
    }

    pub async fn list_connected_mobiles(&self) -> Vec<DeviceId> {
        let mobs = self.mobiles.read().await;
        mobs.keys().cloned().collect()
    }
}

impl From<RouteError> for crate::error::RelayError {
    fn from(err: RouteError) -> Self {
        crate::error::RelayError::Protocol(err.to_string())
    }
}
