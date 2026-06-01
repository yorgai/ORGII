//! In-memory `Storage` implementation for tests and ephemeral demos.
//!
//! This is the trait's correctness reference: every test in
//! `storage_tests.rs` is run against both `MemoryStorage` and
//! `SqliteStorage` so a method that "passes against memory but fails
//! against SQLite" is caught immediately.
//!
//! The implementation uses a single `tokio::sync::Mutex<Inner>`
//! instead of fine-grained locks because tests are sequential and the
//! relay's hot-path concurrency project lives in the `hub` module, not
//! here.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use orgii_protocol::{DesktopId, DeviceId, PairingCode, UserId};
use tokio::sync::Mutex;

use super::types::{AuditEntry, ConnectionHistoryEntry, PairedDevice, PendingPairing};
use super::{ConfirmingSide, Storage};
use crate::audit::{AuditQuery, AuditRecord};
use crate::error::RelayError;

#[derive(Default)]
struct Inner {
    paired: HashMap<DeviceId, PairedDevice>,
    pending: HashMap<PairingCode, PendingPairing>,
    audit: Vec<(i64, AuditEntry)>,
    audit_records: Vec<AuditRecord>,
    connections: HashMap<i64, ConnectionHistoryEntry>,
    next_audit_seq: i64,
    next_audit_record_id: i64,
    next_conn_id: i64,
}

#[derive(Default)]
pub struct MemoryStorage {
    inner: Arc<Mutex<Inner>>,
}

impl MemoryStorage {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl Storage for MemoryStorage {
    async fn upsert_paired_device(&self, dev: PairedDevice) -> Result<(), RelayError> {
        let mut inner = self.inner.lock().await;
        inner.paired.insert(dev.device_id.clone(), dev);
        Ok(())
    }

    async fn get_paired_device(
        &self,
        device_id: &DeviceId,
    ) -> Result<Option<PairedDevice>, RelayError> {
        let inner = self.inner.lock().await;
        Ok(inner.paired.get(device_id).cloned())
    }

    async fn list_paired_devices_for_user(
        &self,
        user_id: &UserId,
    ) -> Result<Vec<PairedDevice>, RelayError> {
        let inner = self.inner.lock().await;
        let mut out: Vec<PairedDevice> = inner
            .paired
            .values()
            .filter(|d| d.user_id == *user_id)
            .cloned()
            .collect();
        out.sort_by_key(|d| d.paired_at_ms);
        Ok(out)
    }

    async fn list_paired_desktops_for_user(
        &self,
        user_id: &UserId,
    ) -> Result<Vec<DesktopId>, RelayError> {
        let inner = self.inner.lock().await;
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for dev in inner.paired.values() {
            if dev.user_id == *user_id && seen.insert(dev.desktop_id.clone()) {
                out.push(dev.desktop_id.clone());
            }
        }
        out.sort_by(|a, b| a.as_str().cmp(b.as_str()));
        Ok(out)
    }

    async fn revoke_paired_device(&self, device_id: &DeviceId) -> Result<(), RelayError> {
        let mut inner = self.inner.lock().await;
        inner.paired.remove(device_id);
        Ok(())
    }

    async fn set_primary_desktop(
        &self,
        user_id: &UserId,
        desktop_id: &DesktopId,
    ) -> Result<(), RelayError> {
        let mut inner = self.inner.lock().await;
        for dev in inner.paired.values_mut() {
            if dev.user_id == *user_id {
                dev.is_primary = dev.desktop_id == *desktop_id;
            }
        }
        Ok(())
    }

    async fn update_device_last_seen(
        &self,
        device_id: &DeviceId,
        ts_ms: i64,
    ) -> Result<(), RelayError> {
        let mut inner = self.inner.lock().await;
        if let Some(dev) = inner.paired.get_mut(device_id) {
            dev.last_seen_ms = Some(ts_ms);
        }
        Ok(())
    }

    async fn insert_pending_pairing(&self, p: PendingPairing) -> Result<(), RelayError> {
        let mut inner = self.inner.lock().await;
        inner.pending.insert(p.pairing_code.clone(), p);
        Ok(())
    }

    async fn get_pending_pairing(
        &self,
        code: &PairingCode,
    ) -> Result<Option<PendingPairing>, RelayError> {
        let inner = self.inner.lock().await;
        Ok(inner.pending.get(code).cloned())
    }

    async fn mark_pairing_claimed(
        &self,
        code: &PairingCode,
        by_device: &DeviceId,
    ) -> Result<(), RelayError> {
        let mut inner = self.inner.lock().await;
        match inner.pending.get_mut(code) {
            Some(p) => {
                p.claimed_by_device_id = Some(by_device.clone());
                Ok(())
            }
            None => Err(RelayError::Storage(
                "mark_pairing_claimed: no pending pairing for code".to_owned(),
            )),
        }
    }

    async fn mark_pairing_confirmed(
        &self,
        code: &PairingCode,
        side: ConfirmingSide,
    ) -> Result<(), RelayError> {
        let mut inner = self.inner.lock().await;
        match inner.pending.get_mut(code) {
            Some(p) => {
                match side {
                    ConfirmingSide::Desktop => p.confirmed_by_desktop = true,
                    ConfirmingSide::Mobile => p.confirmed_by_mobile = true,
                }
                Ok(())
            }
            None => Err(RelayError::Storage(
                "mark_pairing_confirmed: no pending pairing for code".to_owned(),
            )),
        }
    }

    async fn delete_pending_pairing(&self, code: &PairingCode) -> Result<(), RelayError> {
        let mut inner = self.inner.lock().await;
        inner.pending.remove(code);
        Ok(())
    }

    async fn delete_expired_pairings(&self, now_ms: i64) -> Result<u64, RelayError> {
        let mut inner = self.inner.lock().await;
        let before = inner.pending.len();
        inner.pending.retain(|_, p| p.expires_at_ms >= now_ms);
        Ok((before - inner.pending.len()) as u64)
    }

    async fn append_audit(&self, entry: AuditEntry) -> Result<(), RelayError> {
        let mut inner = self.inner.lock().await;
        inner.next_audit_seq += 1;
        let seq = inner.next_audit_seq;
        inner.audit.push((seq, entry));
        Ok(())
    }

    async fn list_audit_for_user(
        &self,
        user_id: &UserId,
        limit: u32,
    ) -> Result<Vec<AuditEntry>, RelayError> {
        let inner = self.inner.lock().await;
        let mut filtered: Vec<&(i64, AuditEntry)> = inner
            .audit
            .iter()
            .filter(|(_, e)| e.user_id == *user_id)
            .collect();
        // Newest first by occurred_at_ms then by insertion sequence as
        // a tie-breaker, matching the SQLite ORDER BY clause.
        filtered.sort_by(|a, b| {
            b.1.occurred_at_ms
                .cmp(&a.1.occurred_at_ms)
                .then(b.0.cmp(&a.0))
        });
        Ok(filtered
            .into_iter()
            .take(limit as usize)
            .map(|(_, e)| e.clone())
            .collect())
    }

    async fn audit_record(&self, record: AuditRecord) -> Result<(), RelayError> {
        let mut inner = self.inner.lock().await;
        inner.next_audit_record_id += 1;
        let assigned = AuditRecord {
            id: inner.next_audit_record_id,
            ..record
        };
        inner.audit_records.push(assigned);
        Ok(())
    }

    async fn audit_query(&self, filter: AuditQuery) -> Result<Vec<AuditRecord>, RelayError> {
        let limit = filter.effective_limit() as usize;
        let inner = self.inner.lock().await;
        let mut filtered: Vec<&AuditRecord> = inner
            .audit_records
            .iter()
            .filter(|r| r.user_id == filter.user_id)
            .filter(|r| {
                filter
                    .device_id
                    .as_ref()
                    .map(|d| r.device_id == *d)
                    .unwrap_or(true)
            })
            .filter(|r| {
                filter
                    .command
                    .as_ref()
                    .map(|c| r.command == *c)
                    .unwrap_or(true)
            })
            .filter(|r| filter.since_ts_ms.map(|ts| r.ts_ms >= ts).unwrap_or(true))
            .filter(|r| filter.ok_only.map(|only| r.ok == only).unwrap_or(true))
            .collect();
        // Newest first by ts_ms with id as tie-breaker, mirroring the
        // SQLite ORDER BY clause exactly so the contract test set
        // catches divergence.
        filtered.sort_by(|left, right| right.ts_ms.cmp(&left.ts_ms).then(right.id.cmp(&left.id)));
        Ok(filtered.into_iter().take(limit).cloned().collect())
    }

    async fn record_connection_open(
        &self,
        entry: ConnectionHistoryEntry,
    ) -> Result<i64, RelayError> {
        let mut inner = self.inner.lock().await;
        inner.next_conn_id += 1;
        let id = inner.next_conn_id;
        inner.connections.insert(id, entry);
        Ok(id)
    }

    async fn record_connection_close(
        &self,
        row_id: i64,
        ts_ms: i64,
        bytes_sent: u64,
        bytes_received: u64,
    ) -> Result<(), RelayError> {
        let mut inner = self.inner.lock().await;
        match inner.connections.get_mut(&row_id) {
            Some(entry) => {
                entry.disconnected_at_ms = Some(ts_ms);
                entry.bytes_sent = bytes_sent;
                entry.bytes_received = bytes_received;
                Ok(())
            }
            None => Err(RelayError::Storage(format!(
                "record_connection_close: no connection_history row with id {row_id}"
            ))),
        }
    }
}
