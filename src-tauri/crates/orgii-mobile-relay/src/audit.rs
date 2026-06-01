//! Append-only audit log domain types and the non-blocking writer
//! service that backs them.
//!
//! ## Why a writer service?
//!
//! The mobile-remote-control design requires that audit log writes do
//! NOT sit on the hot path of RPC dispatch. A 10ms SQLite fsync stall
//! would otherwise be observable as a 10ms tail-latency spike on every
//! routed frame. [`AuditWriter::record`] therefore returns synchronously
//! and spawns the actual `Storage::audit_record` call onto a tokio task.
//! Storage failures are logged via `tracing::error!` rather than
//! propagated — losing an audit row is preferable to delaying user
//! traffic.
//!
//! ## Why a separate `AuditRecord` struct (not the legacy `AuditEntry`)?
//!
//! The query API needs the auto-increment primary key (`id`) to support
//! pagination and to give clients a stable per-row identifier. The
//! field naming (`ts_ms`, `latency_ms: u64`) matches the wire format
//! consumed by the read endpoint in `handlers::audit_handler`.
//!
//! ## User scoping
//!
//! Every record carries a `user_id`. The read endpoint uses the
//! `X-User-Id` header to populate `AuditQuery::user_id` server-side,
//! which guarantees a caller can only ever see their own rows even if
//! a typo or stale client sends a different filter. See
//! `handlers::audit_handler` for the auth boilerplate.
//!
//! ## Append-only
//!
//! There is intentionally NO delete / clear method in this module or
//! in the [`Storage`] trait. The audit table is append-only by design;
//! retention is handled out-of-band (e.g., a future `VACUUM` job that
//! drops rows older than N days) and is out of scope for this module.

use std::sync::Arc;

use orgii_protocol::{DeviceId, UserId};
use serde::{Deserialize, Serialize};

use crate::storage::Storage;

/// Default cap on `AuditQuery::limit` when the caller doesn't specify
/// one. Mirrored in the handler rustdoc so the wire contract is
/// discoverable from either side.
pub const AUDIT_QUERY_DEFAULT_LIMIT: u32 = 100;

/// Server-side hard cap on `AuditQuery::limit`. Anything larger is
/// silently clamped down — see [`AuditQuery::effective_limit`]. The cap
/// keeps a single buggy or malicious request from pulling the entire
/// audit table into memory.
pub const AUDIT_QUERY_MAX_LIMIT: u32 = 1000;

/// One row in the relay-local `audit_log` table. Append-only.
///
/// `id` is the SQLite-assigned primary key. It is `0` on records that
/// have not yet been persisted (the [`Storage::audit_record`] impl
/// ignores the field on insert) and is filled in on read by
/// [`Storage::audit_query`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditRecord {
    /// Auto-increment primary key. `0` for unsaved records.
    pub id: i64,
    /// Unix epoch milliseconds at which the audited event occurred.
    /// The field name `ts_ms` is the canonical wire name spec'd in
    /// the design doc.
    pub ts_ms: i64,
    /// Account / tenant the audited action belongs to. Always set; the
    /// read endpoint enforces that callers only see their own rows.
    pub user_id: UserId,
    /// Mobile device that issued the RPC. Required (unlike the legacy
    /// system-event audit row) so every entry is traceable to a peer.
    pub device_id: DeviceId,
    /// Canonical command name (e.g. `"session.send_message"`). Free-form
    /// `String` deliberately — the relay does not own the command
    /// vocabulary, the dispatch layer does.
    pub command: String,
    /// Whether the dispatch ultimately succeeded.
    pub ok: bool,
    /// Wall-clock latency observed by the relay between request frame
    /// receipt and response frame send.
    pub latency_ms: u64,
    /// Error message captured when `ok == false`. `None` on success.
    pub error: Option<String>,
}

/// Filter passed to [`Storage::audit_query`].
///
/// Every dimension other than `user_id` is optional; callers compose
/// only the ones they care about. The `user_id` is set by the handler
/// from the `X-User-Id` header — it is NOT a client-supplied query
/// parameter.
///
/// There is intentionally no `Default` impl. Construct via
/// [`AuditQuery::for_user`] and then mutate the optional fields with
/// struct-update syntax. A `Default` would require a sentinel
/// `UserId`, which is exactly the kind of empty-string footgun this
/// crate avoids elsewhere.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditQuery {
    /// Always populated by the handler from `X-User-Id`. Storage
    /// implementations MUST scope every result to this user; callers
    /// MUST NOT bypass it.
    pub user_id: UserId,
    pub device_id: Option<DeviceId>,
    pub command: Option<String>,
    pub since_ts_ms: Option<i64>,
    /// Max rows to return. `None` => [`AUDIT_QUERY_DEFAULT_LIMIT`].
    /// Capped at [`AUDIT_QUERY_MAX_LIMIT`].
    pub limit: Option<u32>,
    /// `Some(true)` => only successes. `Some(false)` => only failures.
    /// `None` => no filter.
    pub ok_only: Option<bool>,
}

impl AuditQuery {
    /// Construct a query scoped to a specific user with all other
    /// dimensions set to "no filter".
    pub fn for_user(user_id: UserId) -> Self {
        Self {
            user_id,
            device_id: None,
            command: None,
            since_ts_ms: None,
            limit: None,
            ok_only: None,
        }
    }

    /// Resolved limit after applying both the default and the
    /// server-side cap.
    pub fn effective_limit(&self) -> u32 {
        let raw = self.limit.unwrap_or(AUDIT_QUERY_DEFAULT_LIMIT);
        raw.min(AUDIT_QUERY_MAX_LIMIT)
    }
}

/// Non-blocking writer in front of [`Storage::audit_record`].
///
/// Cloning is cheap — the inner state is an `Arc`. Construct one in
/// the relay startup path and hand clones to every actor that wants to
/// emit audit rows.
#[derive(Clone)]
pub struct AuditWriter {
    storage: Arc<dyn Storage>,
}

impl AuditWriter {
    pub fn new(storage: Arc<dyn Storage>) -> Self {
        Self { storage }
    }

    /// Spawn a background task that persists `record`. Returns
    /// immediately. Storage failures are logged at `error` level and
    /// then dropped — the design doc explicitly forbids audit write
    /// failures from affecting dispatch latency.
    pub fn record(&self, record: AuditRecord) {
        let storage = self.storage.clone();
        tokio::spawn(async move {
            if let Err(err) = storage.audit_record(record).await {
                tracing::error!(error = %err, "audit write failed");
            }
        });
    }

    /// Read-through query helper. Currently a thin pass-through to
    /// [`Storage::audit_query`] — exposed on the writer so callers
    /// only need a single handle for both write + read.
    pub async fn query(
        &self,
        filter: AuditQuery,
    ) -> Result<Vec<AuditRecord>, crate::error::RelayError> {
        self.storage.audit_query(filter).await
    }
}

#[cfg(test)]
#[path = "audit_tests.rs"]
mod tests;
