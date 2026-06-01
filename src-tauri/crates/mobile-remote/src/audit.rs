//! Per-call audit log for mobile-remote RPC dispatch.
//!
//! Phase 6 onwards: dispatch sites pass the originating [`DeviceId`]
//! (stamped by the relay onto `RpcCall.source_device_id`) as the
//! `device_label` so the audit trail records "who did this" rather
//! than "where it landed".
//!
//! Phase 7 (this module): the logger now also fans every event out
//! to the relay's `POST /audit/record` endpoint so the relay-side
//! SQLite audit log captures the same row it captures for the read
//! endpoint at `GET /audit`. The HTTP call is fire-and-forget — we
//! `tokio::spawn` it inside `log` and never `await` the join handle
//! — because the dispatch hot path must not pay for an SSL
//! handshake or a relay round trip. Network failures are swallowed
//! at `warn` level; losing an audit row is preferable to delaying
//! user traffic.
//!
//! ## Why not the WS frame?
//!
//! Audit goes over a separate HTTP POST rather than `Frame::*` so
//! the WS handler stays purely about RPC routing and audit events
//! survive WS reconnects. The relay's `AuditWriter::record` is
//! itself non-blocking, so the end-to-end pipeline is:
//!
//! 1. Desktop `AuditLogger::log` returns immediately after spawning.
//! 2. Spawned task POSTs the row; relay returns `202 Accepted`.
//! 3. Relay's `AuditWriter` writes to SQLite asynchronously.
//!
//! No layer in this chain sits on the dispatch hot path.

use orgii_protocol::UserId;
use reqwest::Client;
use tracing::{info, warn};

use crate::relay_client::{AuditHttpClient, AuditRecordRequest};

/// Per-call audit sink.
///
/// Cloning is cheap — `reqwest::Client` and `AuditHttpClient` are
/// both `Arc`-backed and the strings are short. Construct once on
/// bridge startup and hand clones to every dispatch site.
#[derive(Debug, Clone)]
pub struct AuditLogger {
    client: AuditHttpClient,
}

impl AuditLogger {
    /// Build a logger that POSTs to `{relay_url}/audit/record`.
    /// `relay_url` must NOT have a trailing slash; the http module
    /// composes paths via `format!`.
    pub fn new(relay_url: String, user_id: UserId, http: Client) -> Self {
        let client = AuditHttpClient::new(relay_url, user_id, http);
        Self { client }
    }

    /// Emit one audit record.
    ///
    /// `device_label` is the originating mobile [`orgii_protocol::DeviceId`]
    /// as a string (the actor that sent the call), `command` is the
    /// canonical command name, `ok` is the dispatch outcome, and
    /// `latency_ms` is the wall-clock duration the host took to
    /// produce a result.
    ///
    /// This emits the local tracing line synchronously and then
    /// spawns a fire-and-forget task to POST the same row to the
    /// relay. The async POST does NOT block the caller — dispatch
    /// must remain on its hot path.
    pub async fn log(&self, device_label: &str, command: &str, ok: bool, latency_ms: u64) {
        if ok {
            info!(
                target: "mobile_remote::audit",
                device = %device_label,
                %command,
                latency_ms,
                "rpc dispatched ok",
            );
        } else {
            warn!(
                target: "mobile_remote::audit",
                device = %device_label,
                %command,
                latency_ms,
                "rpc dispatch failed",
            );
        }

        let body = AuditRecordRequest {
            user_id: self.client.user_id().as_str().to_owned(),
            source_device_id: device_label.to_owned(),
            command: command.to_owned(),
            ok,
            latency_ms,
            ts_ms: now_ms(),
        };
        let client = self.client.clone();
        tokio::spawn(async move {
            if let Err(err) = client.record_audit(&body).await {
                warn!(
                    target: "mobile_remote::audit",
                    %err,
                    "relay /audit/record post failed; row not persisted"
                );
            }
        });
    }
}

/// Current Unix epoch in milliseconds, clamped to `i64` for parity
/// with the relay's `ts_ms: i64` column. Returns `0` for the
/// pre-epoch case rather than panicking; that branch is unreachable
/// on any real wall clock.
fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::install_crypto_provider_for_tests;

    fn test_logger() -> AuditLogger {
        install_crypto_provider_for_tests();
        AuditLogger::new(
            "http://127.0.0.1:1".to_owned(),
            UserId::new("local-user"),
            Client::new(),
        )
    }

    #[tokio::test]
    async fn log_does_not_panic_on_ok_call() {
        let logger = test_logger();
        logger.log("device-abc", "sessions_list", true, 42).await;
    }

    #[tokio::test]
    async fn log_does_not_panic_on_failed_call() {
        let logger = test_logger();
        logger
            .log("device-abc", "session_create", false, 1234)
            .await;
    }

    #[tokio::test]
    async fn logger_is_clone_and_share_safe() {
        let logger = test_logger();
        let cloned = logger.clone();
        cloned.log("d", "c", true, 1).await;
        logger.log("d", "c", true, 1).await;
    }

    #[test]
    fn now_ms_is_positive_after_epoch() {
        assert!(now_ms() > 0);
    }
}
