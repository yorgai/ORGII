//! `rusqlite`-backed implementation of [`Storage`].
//!
//! `rusqlite` is synchronous, so every method wraps the actual DB call
//! in `tokio::task::spawn_blocking` and holds the connection behind a
//! `tokio::sync::Mutex`. The mutex serializes access (SQLite has its
//! own row-level locking but only one Rust borrow can hold the
//! `Connection` at once, by ownership rules); for Phase 2 traffic
//! volumes (a few HTTP requests per second peak) this is plenty.
//!
//! When the relay later needs more parallelism the right move is to
//! switch to `r2d2_sqlite` or to migrate the whole storage layer to
//! `sqlx::SqlitePool`. Both are out of scope here.

use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use orgii_protocol::{
    ConfirmationPhrase, DesktopId, DeviceId, PairingCode, PermissionTier, UserId,
};
use rusqlite::{params, Connection, OptionalExtension};
use tokio::sync::Mutex;

use super::schema::{MIGRATIONS, SCHEMA_MIGRATIONS_DDL};
use super::types::{AuditEntry, ConnectionHistoryEntry, PairedDevice, PendingPairing};
use super::{ConfirmingSide, Storage};
use crate::audit::{AuditQuery, AuditRecord};
use crate::error::RelayError;

type StorageResult<T> = Result<T, RelayError>;

/// File-backed (or `:memory:`) `Storage` implementation. Wrap in
/// `Arc<dyn Storage>` for sharing across handler tasks.
pub struct SqliteStorage {
    conn: Arc<Mutex<Connection>>,
}

impl SqliteStorage {
    /// Open or create the SQLite database at `path` and run any
    /// pending migrations. Pass [`Path::new(":memory:")`] for tests.
    pub async fn open(path: impl AsRef<Path>) -> StorageResult<Self> {
        let path = path.as_ref().to_path_buf();
        let conn = tokio::task::spawn_blocking(move || -> StorageResult<Connection> {
            let conn = Connection::open(&path).map_err(map_err)?;
            // PRAGMAs that materially affect durability + concurrency
            // for a long-lived single-writer process.
            conn.execute_batch(
                "PRAGMA journal_mode=WAL;
                 PRAGMA synchronous=NORMAL;
                 PRAGMA foreign_keys=ON;",
            )
            .map_err(map_err)?;
            run_migrations_blocking(&conn)?;
            Ok(conn)
        })
        .await
        .map_err(|err| RelayError::Storage(format!("spawn_blocking join error: {err}")))??;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Convenience for tests / ephemeral demos.
    pub async fn open_in_memory() -> StorageResult<Self> {
        Self::open(":memory:").await
    }

    async fn with_conn<F, T>(&self, work: F) -> StorageResult<T>
    where
        F: FnOnce(&Connection) -> StorageResult<T> + Send + 'static,
        T: Send + 'static,
    {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let guard = conn.blocking_lock();
            work(&guard)
        })
        .await
        .map_err(|err| RelayError::Storage(format!("spawn_blocking join error: {err}")))?
    }
}

/// Apply every pending entry in [`MIGRATIONS`] in order. Idempotent:
/// already-applied versions are skipped.
fn run_migrations_blocking(conn: &Connection) -> StorageResult<()> {
    conn.execute_batch(SCHEMA_MIGRATIONS_DDL).map_err(map_err)?;

    let applied: std::collections::HashSet<i64> = conn
        .prepare("SELECT id FROM schema_migrations")
        .map_err(map_err)?
        .query_map([], |row| row.get::<_, i64>(0))
        .map_err(map_err)?
        .collect::<Result<std::collections::HashSet<_>, _>>()
        .map_err(map_err)?;

    for (version, sql) in MIGRATIONS {
        if applied.contains(version) {
            continue;
        }
        conn.execute_batch(sql).map_err(map_err)?;
        let now_ms = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO schema_migrations(id, applied_at_ms) VALUES (?1, ?2)",
            params![version, now_ms],
        )
        .map_err(map_err)?;
    }
    Ok(())
}

fn map_err(err: rusqlite::Error) -> RelayError {
    RelayError::Storage(err.to_string())
}

fn parse_tier(s: &str) -> StorageResult<PermissionTier> {
    match s {
        "read_only" => Ok(PermissionTier::ReadOnly),
        "full" => Ok(PermissionTier::Full),
        other => Err(RelayError::Storage(format!(
            "invalid permission tier in DB: {other}"
        ))),
    }
}

fn tier_str(tier: PermissionTier) -> &'static str {
    match tier {
        PermissionTier::ReadOnly => "read_only",
        PermissionTier::Full => "full",
    }
}

#[async_trait]
impl Storage for SqliteStorage {
    async fn upsert_paired_device(&self, dev: PairedDevice) -> StorageResult<()> {
        self.with_conn(move |conn| {
            conn.execute(
                "INSERT INTO paired_devices (
                    device_id, user_id, desktop_id, label, tier,
                    paired_at_ms, last_seen_ms, is_primary, device_pubkey_fingerprint
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(device_id) DO UPDATE SET
                    user_id = excluded.user_id,
                    desktop_id = excluded.desktop_id,
                    label = excluded.label,
                    tier = excluded.tier,
                    paired_at_ms = excluded.paired_at_ms,
                    last_seen_ms = excluded.last_seen_ms,
                    is_primary = excluded.is_primary,
                    device_pubkey_fingerprint = excluded.device_pubkey_fingerprint",
                params![
                    dev.device_id.as_str(),
                    dev.user_id.as_str(),
                    dev.desktop_id.as_str(),
                    dev.label,
                    tier_str(dev.tier),
                    dev.paired_at_ms,
                    dev.last_seen_ms,
                    dev.is_primary as i64,
                    dev.device_pubkey_fingerprint,
                ],
            )
            .map_err(map_err)?;
            Ok(())
        })
        .await
    }

    async fn get_paired_device(&self, device_id: &DeviceId) -> StorageResult<Option<PairedDevice>> {
        let device_id_str = device_id.as_str().to_owned();
        self.with_conn(move |conn| {
            let row = conn
                .query_row(
                    "SELECT device_id, user_id, desktop_id, label, tier,
                            paired_at_ms, last_seen_ms, is_primary, device_pubkey_fingerprint
                     FROM paired_devices WHERE device_id = ?1",
                    params![device_id_str],
                    row_to_paired_device,
                )
                .optional()
                .map_err(map_err)?;
            row.transpose()
        })
        .await
    }

    async fn list_paired_devices_for_user(
        &self,
        user_id: &UserId,
    ) -> StorageResult<Vec<PairedDevice>> {
        let user_id_str = user_id.as_str().to_owned();
        self.with_conn(move |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT device_id, user_id, desktop_id, label, tier,
                            paired_at_ms, last_seen_ms, is_primary, device_pubkey_fingerprint
                     FROM paired_devices WHERE user_id = ?1
                     ORDER BY paired_at_ms ASC",
                )
                .map_err(map_err)?;
            let rows = stmt
                .query_map(params![user_id_str], row_to_paired_device)
                .map_err(map_err)?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(map_err)??);
            }
            Ok(out)
        })
        .await
    }

    async fn list_paired_desktops_for_user(
        &self,
        user_id: &UserId,
    ) -> StorageResult<Vec<DesktopId>> {
        let user_id_str = user_id.as_str().to_owned();
        self.with_conn(move |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT DISTINCT desktop_id FROM paired_devices
                     WHERE user_id = ?1
                     ORDER BY desktop_id ASC",
                )
                .map_err(map_err)?;
            let rows = stmt
                .query_map(params![user_id_str], |row| {
                    let desktop_id: String = row.get(0)?;
                    Ok(DesktopId::new(desktop_id))
                })
                .map_err(map_err)?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(map_err)?);
            }
            Ok(out)
        })
        .await
    }

    async fn revoke_paired_device(&self, device_id: &DeviceId) -> StorageResult<()> {
        let device_id_str = device_id.as_str().to_owned();
        self.with_conn(move |conn| {
            conn.execute(
                "DELETE FROM paired_devices WHERE device_id = ?1",
                params![device_id_str],
            )
            .map_err(map_err)?;
            Ok(())
        })
        .await
    }

    async fn set_primary_desktop(
        &self,
        user_id: &UserId,
        desktop_id: &DesktopId,
    ) -> StorageResult<()> {
        let user_id_str = user_id.as_str().to_owned();
        let desktop_id_str = desktop_id.as_str().to_owned();
        self.with_conn(move |conn| {
            let tx = conn.unchecked_transaction().map_err(map_err)?;
            tx.execute(
                "UPDATE paired_devices SET is_primary = 0 WHERE user_id = ?1",
                params![user_id_str],
            )
            .map_err(map_err)?;
            tx.execute(
                "UPDATE paired_devices SET is_primary = 1
                 WHERE user_id = ?1 AND desktop_id = ?2",
                params![user_id_str, desktop_id_str],
            )
            .map_err(map_err)?;
            tx.commit().map_err(map_err)?;
            Ok(())
        })
        .await
    }

    async fn update_device_last_seen(&self, device_id: &DeviceId, ts_ms: i64) -> StorageResult<()> {
        let device_id_str = device_id.as_str().to_owned();
        self.with_conn(move |conn| {
            conn.execute(
                "UPDATE paired_devices SET last_seen_ms = ?2 WHERE device_id = ?1",
                params![device_id_str, ts_ms],
            )
            .map_err(map_err)?;
            Ok(())
        })
        .await
    }

    async fn insert_pending_pairing(&self, p: PendingPairing) -> StorageResult<()> {
        self.with_conn(move |conn| {
            // Upsert semantics so the handler can mutate fields on the
            // same primary key (claim adds the mobile fingerprint;
            // confirm flips the per-side flags). The
            // `MemoryStorage` impl is also upsert by HashMap
            // construction so both backends behave identically.
            conn.execute(
                "INSERT INTO pending_pairings (
                    pairing_code, user_id, desktop_id, requested_tier,
                    confirmation_phrase, expires_at_ms,
                    claimed_by_device_id, confirmed_by_desktop, confirmed_by_mobile,
                    device_label, device_pubkey_fingerprint, desktop_pubkey_fingerprint
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(pairing_code) DO UPDATE SET
                    user_id = excluded.user_id,
                    desktop_id = excluded.desktop_id,
                    requested_tier = excluded.requested_tier,
                    confirmation_phrase = excluded.confirmation_phrase,
                    expires_at_ms = excluded.expires_at_ms,
                    claimed_by_device_id = excluded.claimed_by_device_id,
                    confirmed_by_desktop = excluded.confirmed_by_desktop,
                    confirmed_by_mobile = excluded.confirmed_by_mobile,
                    device_label = excluded.device_label,
                    device_pubkey_fingerprint = excluded.device_pubkey_fingerprint,
                    desktop_pubkey_fingerprint = excluded.desktop_pubkey_fingerprint",
                params![
                    p.pairing_code.as_str(),
                    p.user_id.as_str(),
                    p.desktop_id.as_str(),
                    tier_str(p.requested_tier),
                    p.confirmation_phrase.as_str(),
                    p.expires_at_ms,
                    p.claimed_by_device_id
                        .as_ref()
                        .map(|d| d.as_str().to_owned()),
                    p.confirmed_by_desktop as i64,
                    p.confirmed_by_mobile as i64,
                    p.device_label,
                    p.device_pubkey_fingerprint,
                    p.desktop_pubkey_fingerprint,
                ],
            )
            .map_err(map_err)?;
            Ok(())
        })
        .await
    }

    async fn get_pending_pairing(
        &self,
        code: &PairingCode,
    ) -> StorageResult<Option<PendingPairing>> {
        let code_str = code.as_str().to_owned();
        self.with_conn(move |conn| {
            let row = conn
                .query_row(
                    "SELECT pairing_code, user_id, desktop_id, requested_tier,
                            confirmation_phrase, expires_at_ms,
                            claimed_by_device_id, confirmed_by_desktop, confirmed_by_mobile,
                            device_label, device_pubkey_fingerprint, desktop_pubkey_fingerprint
                     FROM pending_pairings WHERE pairing_code = ?1",
                    params![code_str],
                    row_to_pending_pairing,
                )
                .optional()
                .map_err(map_err)?;
            row.transpose()
        })
        .await
    }

    async fn mark_pairing_claimed(
        &self,
        code: &PairingCode,
        by_device: &DeviceId,
    ) -> StorageResult<()> {
        let code_str = code.as_str().to_owned();
        let device_str = by_device.as_str().to_owned();
        self.with_conn(move |conn| {
            let updated = conn
                .execute(
                    "UPDATE pending_pairings SET claimed_by_device_id = ?2
                     WHERE pairing_code = ?1",
                    params![code_str, device_str],
                )
                .map_err(map_err)?;
            if updated == 0 {
                return Err(RelayError::Storage(
                    "mark_pairing_claimed: no pending pairing for code".to_owned(),
                ));
            }
            Ok(())
        })
        .await
    }

    async fn mark_pairing_confirmed(
        &self,
        code: &PairingCode,
        side: ConfirmingSide,
    ) -> StorageResult<()> {
        let code_str = code.as_str().to_owned();
        self.with_conn(move |conn| {
            let column = match side {
                ConfirmingSide::Desktop => "confirmed_by_desktop",
                ConfirmingSide::Mobile => "confirmed_by_mobile",
            };
            let sql = format!("UPDATE pending_pairings SET {column} = 1 WHERE pairing_code = ?1");
            let updated = conn.execute(&sql, params![code_str]).map_err(map_err)?;
            if updated == 0 {
                return Err(RelayError::Storage(
                    "mark_pairing_confirmed: no pending pairing for code".to_owned(),
                ));
            }
            Ok(())
        })
        .await
    }

    async fn delete_pending_pairing(&self, code: &PairingCode) -> StorageResult<()> {
        let code_str = code.as_str().to_owned();
        self.with_conn(move |conn| {
            conn.execute(
                "DELETE FROM pending_pairings WHERE pairing_code = ?1",
                params![code_str],
            )
            .map_err(map_err)?;
            Ok(())
        })
        .await
    }

    async fn delete_expired_pairings(&self, now_ms: i64) -> StorageResult<u64> {
        self.with_conn(move |conn| {
            let removed = conn
                .execute(
                    "DELETE FROM pending_pairings WHERE expires_at_ms < ?1",
                    params![now_ms],
                )
                .map_err(map_err)?;
            Ok(removed as u64)
        })
        .await
    }

    async fn append_audit(&self, entry: AuditEntry) -> StorageResult<()> {
        self.with_conn(move |conn| {
            conn.execute(
                "INSERT INTO audit_log (
                    user_id, device_id, command, ok, latency_ms,
                    occurred_at_ms, error_message
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    entry.user_id.as_str(),
                    entry.device_id.as_ref().map(|d| d.as_str().to_owned()),
                    entry.command,
                    entry.ok as i64,
                    entry.latency_ms,
                    entry.occurred_at_ms,
                    entry.error_message,
                ],
            )
            .map_err(map_err)?;
            Ok(())
        })
        .await
    }

    async fn list_audit_for_user(
        &self,
        user_id: &UserId,
        limit: u32,
    ) -> StorageResult<Vec<AuditEntry>> {
        let user_id_str = user_id.as_str().to_owned();
        self.with_conn(move |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT user_id, device_id, command, ok, latency_ms,
                            occurred_at_ms, error_message
                     FROM audit_log WHERE user_id = ?1
                     ORDER BY occurred_at_ms DESC, id DESC
                     LIMIT ?2",
                )
                .map_err(map_err)?;
            let rows = stmt
                .query_map(params![user_id_str, limit as i64], row_to_audit_entry)
                .map_err(map_err)?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(map_err)??);
            }
            Ok(out)
        })
        .await
    }

    async fn audit_record(&self, record: AuditRecord) -> StorageResult<()> {
        // The schema's INTEGER `latency_ms` column is signed, so the
        // u64 input is bounds-checked here. In practice a single
        // dispatch latency that overflows i64 milliseconds is a bug,
        // not a real value — clamp to i64::MAX rather than truncate.
        let latency_signed: i64 = i64::try_from(record.latency_ms).unwrap_or(i64::MAX);
        self.with_conn(move |conn| {
            conn.execute(
                "INSERT INTO audit_log (
                    user_id, device_id, command, ok, latency_ms,
                    occurred_at_ms, error_message
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    record.user_id.as_str(),
                    record.device_id.as_str(),
                    record.command,
                    record.ok as i64,
                    latency_signed,
                    record.ts_ms,
                    record.error,
                ],
            )
            .map_err(map_err)?;
            Ok(())
        })
        .await
    }

    async fn audit_query(&self, filter: AuditQuery) -> StorageResult<Vec<AuditRecord>> {
        let limit = filter.effective_limit();
        let user_id_str = filter.user_id.as_str().to_owned();
        let device_id_str = filter.device_id.as_ref().map(|d| d.as_str().to_owned());
        let command = filter.command.clone();
        let since_ts_ms = filter.since_ts_ms;
        let ok_only = filter.ok_only;
        self.with_conn(move |conn| {
            let mut sql = String::from(
                "SELECT id, user_id, device_id, command, ok, latency_ms,
                        occurred_at_ms, error_message
                 FROM audit_log
                 WHERE user_id = ?1
                       AND device_id IS NOT NULL",
            );
            // Boxed `Send` trait objects so the whole closure stays
            // `Send` for `spawn_blocking`. Each push appends one bind
            // and bumps the placeholder index.
            let mut binds: Vec<Box<dyn rusqlite::ToSql + Send>> = vec![Box::new(user_id_str)];
            if let Some(device) = device_id_str {
                binds.push(Box::new(device));
                sql.push_str(&format!(" AND device_id = ?{}", binds.len()));
            }
            if let Some(cmd) = command {
                binds.push(Box::new(cmd));
                sql.push_str(&format!(" AND command = ?{}", binds.len()));
            }
            if let Some(ts) = since_ts_ms {
                binds.push(Box::new(ts));
                sql.push_str(&format!(" AND occurred_at_ms >= ?{}", binds.len()));
            }
            if let Some(only) = ok_only {
                binds.push(Box::new(only as i64));
                sql.push_str(&format!(" AND ok = ?{}", binds.len()));
            }
            sql.push_str(" ORDER BY occurred_at_ms DESC, id DESC");
            binds.push(Box::new(limit as i64));
            sql.push_str(&format!(" LIMIT ?{}", binds.len()));

            let mut stmt = conn.prepare(&sql).map_err(map_err)?;
            let bind_refs: Vec<&dyn rusqlite::ToSql> = binds
                .iter()
                .map(|b| b.as_ref() as &dyn rusqlite::ToSql)
                .collect();
            let rows = stmt
                .query_map(bind_refs.as_slice(), row_to_audit_record)
                .map_err(map_err)?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(map_err)??);
            }
            Ok(out)
        })
        .await
    }

    async fn record_connection_open(&self, entry: ConnectionHistoryEntry) -> StorageResult<i64> {
        self.with_conn(move |conn| {
            conn.execute(
                "INSERT INTO connection_history (
                    user_id, peer_role, peer_id, connected_at_ms,
                    disconnected_at_ms, bytes_sent, bytes_received
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    entry.user_id.as_str(),
                    entry.peer_role.as_str(),
                    entry.peer_id,
                    entry.connected_at_ms,
                    entry.disconnected_at_ms,
                    entry.bytes_sent as i64,
                    entry.bytes_received as i64,
                ],
            )
            .map_err(map_err)?;
            Ok(conn.last_insert_rowid())
        })
        .await
    }

    async fn record_connection_close(
        &self,
        row_id: i64,
        ts_ms: i64,
        bytes_sent: u64,
        bytes_received: u64,
    ) -> StorageResult<()> {
        self.with_conn(move |conn| {
            let updated = conn
                .execute(
                    "UPDATE connection_history
                     SET disconnected_at_ms = ?2, bytes_sent = ?3, bytes_received = ?4
                     WHERE id = ?1",
                    params![row_id, ts_ms, bytes_sent as i64, bytes_received as i64],
                )
                .map_err(map_err)?;
            if updated == 0 {
                return Err(RelayError::Storage(format!(
                    "record_connection_close: no connection_history row with id {row_id}"
                )));
            }
            Ok(())
        })
        .await
    }
}

/// Row → struct mappers. Each returns `rusqlite::Result<StorageResult<T>>`
/// so column-extraction errors stay as `rusqlite::Error` (the type
/// `query_map` requires) while domain-validation errors (e.g. an
/// unknown tier string) bubble up as `RelayError::Storage`.
fn row_to_paired_device(row: &rusqlite::Row<'_>) -> rusqlite::Result<StorageResult<PairedDevice>> {
    let device_id: String = row.get(0)?;
    let user_id: String = row.get(1)?;
    let desktop_id: String = row.get(2)?;
    let label: String = row.get(3)?;
    let tier_raw: String = row.get(4)?;
    let paired_at_ms: i64 = row.get(5)?;
    let last_seen_ms: Option<i64> = row.get(6)?;
    let is_primary_raw: i64 = row.get(7)?;
    let device_pubkey_fingerprint: String = row.get(8)?;
    Ok(parse_tier(&tier_raw).map(|tier| PairedDevice {
        device_id: DeviceId::new(device_id),
        user_id: UserId::new(user_id),
        desktop_id: DesktopId::new(desktop_id),
        label,
        tier,
        paired_at_ms,
        last_seen_ms,
        is_primary: is_primary_raw != 0,
        device_pubkey_fingerprint,
    }))
}

fn row_to_pending_pairing(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<StorageResult<PendingPairing>> {
    let pairing_code: String = row.get(0)?;
    let user_id: String = row.get(1)?;
    let desktop_id: String = row.get(2)?;
    let tier_raw: String = row.get(3)?;
    let confirmation_phrase: String = row.get(4)?;
    let expires_at_ms: i64 = row.get(5)?;
    let claimed_raw: Option<String> = row.get(6)?;
    let confirmed_desktop_raw: i64 = row.get(7)?;
    let confirmed_mobile_raw: i64 = row.get(8)?;
    let device_label: Option<String> = row.get(9)?;
    let device_pubkey_fingerprint: Option<String> = row.get(10)?;
    let desktop_pubkey_fingerprint: String = row.get(11)?;
    Ok(parse_tier(&tier_raw).map(|requested_tier| PendingPairing {
        pairing_code: PairingCode::new(pairing_code),
        user_id: UserId::new(user_id),
        desktop_id: DesktopId::new(desktop_id),
        requested_tier,
        confirmation_phrase: ConfirmationPhrase::new(confirmation_phrase),
        expires_at_ms,
        claimed_by_device_id: claimed_raw.map(DeviceId::new),
        confirmed_by_desktop: confirmed_desktop_raw != 0,
        confirmed_by_mobile: confirmed_mobile_raw != 0,
        device_label,
        device_pubkey_fingerprint,
        desktop_pubkey_fingerprint,
    }))
}

fn row_to_audit_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<StorageResult<AuditEntry>> {
    let user_id: String = row.get(0)?;
    let device_raw: Option<String> = row.get(1)?;
    let command: String = row.get(2)?;
    let ok_raw: i64 = row.get(3)?;
    let latency_ms: i64 = row.get(4)?;
    let occurred_at_ms: i64 = row.get(5)?;
    let error_message: Option<String> = row.get(6)?;
    Ok(Ok(AuditEntry {
        user_id: UserId::new(user_id),
        device_id: device_raw.map(DeviceId::new),
        command,
        ok: ok_raw != 0,
        latency_ms,
        occurred_at_ms,
        error_message,
    }))
}

/// Column order matches the SELECT in `audit_query`. The `audit_log`
/// row's `device_id` column is nullable for backward-compat with
/// `append_audit` (which allowed system events with no device); the
/// `audit_query` SQL filters those rows out via `device_id IS NOT
/// NULL`, so an unwrap here is unreachable on rows the query returns.
/// We still bail with a typed error rather than panic to keep the
/// production path `unwrap`-free per workspace rules.
fn row_to_audit_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<StorageResult<AuditRecord>> {
    let id: i64 = row.get(0)?;
    let user_id: String = row.get(1)?;
    let device_raw: Option<String> = row.get(2)?;
    let command: String = row.get(3)?;
    let ok_raw: i64 = row.get(4)?;
    let latency_signed: i64 = row.get(5)?;
    let ts_ms: i64 = row.get(6)?;
    let error: Option<String> = row.get(7)?;
    Ok(match device_raw {
        Some(device) => Ok(AuditRecord {
            id,
            ts_ms,
            user_id: UserId::new(user_id),
            device_id: DeviceId::new(device),
            command,
            ok: ok_raw != 0,
            latency_ms: latency_signed.max(0) as u64,
            error,
        }),
        None => Err(RelayError::Storage(format!(
            "audit_log row id={id} has NULL device_id but was returned by audit_query"
        ))),
    })
}
