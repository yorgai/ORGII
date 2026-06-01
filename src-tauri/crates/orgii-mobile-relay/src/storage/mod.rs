//! Persistent storage for the relay.
//!
//! The trait surface here is the contract every backend
//! ([`SqliteStorage`], [`MemoryStorage`]) must satisfy. Tests in
//! `storage_tests.rs` exercise both implementations through the same
//! generic helper so divergence is caught at compile-time.
//!
//! All methods are `async` per the workspace rule on Tauri / IO
//! commands not blocking the executor. SQLite is sync internally but
//! we always cross the `tokio::task::spawn_blocking` boundary.

pub mod memory;
pub mod schema;
pub mod sqlite;
pub mod types;

use async_trait::async_trait;
use orgii_protocol::{ConfirmingSide, DesktopId, DeviceId, PairingCode, UserId};

pub use memory::MemoryStorage;
pub use sqlite::SqliteStorage;
pub use types::{AuditEntry, ConnectionHistoryEntry, PairedDevice, PeerKind, PendingPairing};

use crate::audit::{AuditQuery, AuditRecord};
use crate::error::RelayError;

/// Persistent storage contract. See module docs for backend
/// selection rationale.
///
/// Errors are wrapped as [`RelayError::Storage`]; the variants are
/// intentionally string-typed so SQLite-specific error codes don't
/// leak across the trait boundary.
#[async_trait]
pub trait Storage: Send + Sync + 'static {
    async fn upsert_paired_device(&self, dev: PairedDevice) -> Result<(), RelayError>;
    async fn get_paired_device(
        &self,
        device_id: &DeviceId,
    ) -> Result<Option<PairedDevice>, RelayError>;
    async fn list_paired_devices_for_user(
        &self,
        user_id: &UserId,
    ) -> Result<Vec<PairedDevice>, RelayError>;
    /// Distinct desktops the given user has at least one paired mobile
    /// device for. Used by the mobile WS upgrade handler to decide
    /// whether the requested `desktop_id` is even reachable for this
    /// user. Order is unspecified; the caller is expected to do
    /// membership checks, not iterate in display order.
    async fn list_paired_desktops_for_user(
        &self,
        user_id: &UserId,
    ) -> Result<Vec<DesktopId>, RelayError>;
    async fn revoke_paired_device(&self, device_id: &DeviceId) -> Result<(), RelayError>;
    async fn set_primary_desktop(
        &self,
        user_id: &UserId,
        desktop_id: &DesktopId,
    ) -> Result<(), RelayError>;
    async fn update_device_last_seen(
        &self,
        device_id: &DeviceId,
        ts_ms: i64,
    ) -> Result<(), RelayError>;

    async fn insert_pending_pairing(&self, p: PendingPairing) -> Result<(), RelayError>;
    async fn get_pending_pairing(
        &self,
        code: &PairingCode,
    ) -> Result<Option<PendingPairing>, RelayError>;
    async fn mark_pairing_claimed(
        &self,
        code: &PairingCode,
        by_device: &DeviceId,
    ) -> Result<(), RelayError>;
    async fn mark_pairing_confirmed(
        &self,
        code: &PairingCode,
        side: ConfirmingSide,
    ) -> Result<(), RelayError>;
    async fn delete_pending_pairing(&self, code: &PairingCode) -> Result<(), RelayError>;
    /// Removes all pairings whose `expires_at_ms < now_ms`. Returns
    /// the number of rows actually deleted.
    async fn delete_expired_pairings(&self, now_ms: i64) -> Result<u64, RelayError>;

    async fn append_audit(&self, entry: AuditEntry) -> Result<(), RelayError>;
    /// Newest-first, capped at `limit`.
    async fn list_audit_for_user(
        &self,
        user_id: &UserId,
        limit: u32,
    ) -> Result<Vec<AuditEntry>, RelayError>;

    /// Append an [`AuditRecord`] to the relay-local audit log. The
    /// `id` field on the input is ignored; storage backends assign
    /// the primary key on insert and do not surface it back through
    /// this method (read it back via [`Self::audit_query`]).
    async fn audit_record(&self, record: AuditRecord) -> Result<(), RelayError>;

    /// Filtered query against the audit log. Results are ordered
    /// newest-first by `ts_ms` with a stable tie-breaker on `id`.
    /// The filter's `user_id` MUST be honored — it is the caller's
    /// authenticated identity, not a free dimension.
    async fn audit_query(&self, filter: AuditQuery) -> Result<Vec<AuditRecord>, RelayError>;

    async fn record_connection_open(
        &self,
        entry: ConnectionHistoryEntry,
    ) -> Result<i64, RelayError>;
    async fn record_connection_close(
        &self,
        row_id: i64,
        ts_ms: i64,
        bytes_sent: u64,
        bytes_received: u64,
    ) -> Result<(), RelayError>;
}

#[cfg(test)]
#[path = "storage_tests.rs"]
mod tests;
