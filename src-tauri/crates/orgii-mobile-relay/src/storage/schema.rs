//! Embedded SQL migrations for the relay-local SQLite database.
//!
//! Each entry in [`MIGRATIONS`] is a `(version, sql)` pair applied in
//! order. The version is recorded in the `schema_migrations` table so
//! re-running on an already-bootstrapped DB is a no-op.
//!
//! There is intentionally NO third-party migration crate here:
//! - The schema is small (four tables in Phase 2).
//! - The relay binary must boot in <100 ms per the design doc, and a
//!   migration framework adds binary size + startup work for no
//!   benefit at this scale.
//!
//! To add a new migration: append a new `(N, sql)` tuple. NEVER edit
//! an existing tuple — that breaks idempotency for users who already
//! have the previous version applied.

/// Migration table bootstrap. Idempotent; runs on every connection
/// open before [`MIGRATIONS`] is consulted.
pub const SCHEMA_MIGRATIONS_DDL: &str = "
CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    applied_at_ms INTEGER NOT NULL
);
";

/// Ordered, append-only migration list. The integer is the canonical
/// version recorded in `schema_migrations.id`.
pub const MIGRATIONS: &[(i64, &str)] = &[(
    1,
    "
CREATE TABLE paired_devices (
    device_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    desktop_id TEXT NOT NULL,
    label TEXT NOT NULL,
    tier TEXT NOT NULL,
    paired_at_ms INTEGER NOT NULL,
    last_seen_ms INTEGER,
    is_primary INTEGER NOT NULL,
    device_pubkey_fingerprint TEXT NOT NULL
);

CREATE INDEX idx_paired_devices_user ON paired_devices(user_id);
CREATE INDEX idx_paired_devices_desktop ON paired_devices(desktop_id);

CREATE TABLE pending_pairings (
    pairing_code TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    desktop_id TEXT NOT NULL,
    requested_tier TEXT NOT NULL,
    confirmation_phrase TEXT NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    claimed_by_device_id TEXT,
    confirmed_by_desktop INTEGER NOT NULL DEFAULT 0,
    confirmed_by_mobile INTEGER NOT NULL DEFAULT 0,
    device_label TEXT,
    device_pubkey_fingerprint TEXT,
    desktop_pubkey_fingerprint TEXT NOT NULL
);

CREATE INDEX idx_pending_pairings_expiry ON pending_pairings(expires_at_ms);

CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    device_id TEXT,
    command TEXT NOT NULL,
    ok INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    occurred_at_ms INTEGER NOT NULL,
    error_message TEXT
);

CREATE INDEX idx_audit_log_user_time ON audit_log(user_id, occurred_at_ms DESC);

CREATE TABLE connection_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    peer_role TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    connected_at_ms INTEGER NOT NULL,
    disconnected_at_ms INTEGER,
    bytes_sent INTEGER NOT NULL DEFAULT 0,
    bytes_received INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_connection_history_user ON connection_history(user_id);
",
)];
