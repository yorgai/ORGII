//! Per-(project_slug, adapter_id) HMAC secret store for inbound
//! webhook verification.
//!
//! The `webhook_secrets` table is a small key-value store —
//! `(project_slug, adapter_id)` is the composite primary key, the
//! row carries the 32-byte secret hex-encoded and a rotation
//! timestamp. The flow is:
//!
//! 1. User clicks "Install webhook" in the SyncSection UI →
//!    [`generate_secret`] mints a fresh CSPRNG secret and
//!    [`upsert_secret`] persists it. The install command surfaces
//!    the secret + the listener URL to the user once so they can
//!    paste it into the remote provider's webhook configuration.
//! 2. Every inbound delivery hits the embedded listener
//!    (`sync::webhook_listener`), which calls [`get_secret`] to
//!    look up the secret and hands the body + headers to the
//!    adapter's `handle_webhook` for HMAC verification.
//! 3. Rotation: [`rotate_secret`] mints a new value and updates
//!    `last_rotated_at`. Old deliveries fail verification on the
//!    next inbound — the user must paste the new secret into the
//!    remote provider before deliveries succeed again.
//! 4. Detach: [`delete_secret`] drops the row when the user
//!    detaches the adapter from the project.
//!
//! All functions take a borrowed `Connection`; callers wrap the
//! call in `tokio::task::spawn_blocking` per the standard sync IO
//! pattern.
//!
//! # Secret length
//!
//! 32 bytes (= 64 hex chars) gives 256 bits of entropy, which is
//! standard for HMAC-SHA256 secrets and matches what every major
//! webhook provider expects (GitHub recommends 20+, Linear 32,
//! Stripe 32). Hex encoding (vs base64) keeps the printed value
//! safely paste-able into provider UIs that strip whitespace
//! aggressively.
//!
//! # Why a separate table (not a column on `projects`)
//!
//! Multiple webhook secrets per project are a near-certainty (e.g.
//! a project bound to GitHub today, attaching a Linear webhook
//! tomorrow). The composite key lets us add rows without column churn
//! and keeps the per-row rotation timestamp scoped correctly.

use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension};

use super::io;

/// Length of the HMAC secret in bytes. 32 bytes ⇒ 64 hex chars,
/// 256 bits of entropy.
pub const SECRET_LEN_BYTES: usize = 32;

/// Mint a fresh hex-encoded secret using the platform CSPRNG.
///
/// The result is `SECRET_LEN_BYTES * 2` hex characters; matches what
/// the sqlite column expects and what webhook providers display in
/// their setup UI. Pure function — no IO, safe to call outside a
/// `spawn_blocking` context.
pub fn generate_secret() -> String {
    let mut bytes = [0u8; SECRET_LEN_BYTES];
    rand::rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Upsert a secret for `(slug, adapter_id)` and stamp `last_rotated_at`.
///
/// Used both for the initial install (no prior row) and rotation
/// (prior row replaced). The `INSERT … ON CONFLICT … UPDATE` pattern
/// keeps the operation atomic so a concurrent reader never sees a
/// half-replaced row.
pub fn upsert_secret(
    c: &Connection,
    slug: &str,
    adapter_id: &str,
    secret_hex: &str,
    now_ms: i64,
) -> Result<(), String> {
    c.execute(
        "INSERT INTO webhook_secrets (project_slug, adapter_id, secret_hex, last_rotated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(project_slug, adapter_id) DO UPDATE SET
             secret_hex = excluded.secret_hex,
             last_rotated_at = excluded.last_rotated_at",
        params![slug, adapter_id, secret_hex, now_ms],
    )
    .map_err(|err| format!("DB error (upsert webhook secret): {}", err))?;
    Ok(())
}

/// Read the secret for `(slug, adapter_id)`. Returns `None` when no
/// webhook is installed for that pair (caller must reject the inbound
/// delivery as "no secret on file").
pub fn get_secret(
    c: &Connection,
    slug: &str,
    adapter_id: &str,
) -> Result<Option<WebhookSecret>, String> {
    c.query_row(
        "SELECT secret_hex, last_rotated_at FROM webhook_secrets
          WHERE project_slug = ?1 AND adapter_id = ?2",
        params![slug, adapter_id],
        |row| {
            Ok(WebhookSecret {
                secret_hex: row.get::<_, String>(0)?,
                last_rotated_at: row.get::<_, i64>(1)?,
            })
        },
    )
    .optional()
    .map_err(|err| format!("DB error (read webhook secret): {}", err))
}

/// Convenience wrapper: mint a new secret and persist it. Returns
/// the freshly-minted value so the caller can surface it to the UI.
pub fn rotate_secret(
    c: &Connection,
    slug: &str,
    adapter_id: &str,
    now_ms: i64,
) -> Result<String, String> {
    let secret = generate_secret();
    upsert_secret(c, slug, adapter_id, &secret, now_ms)?;
    Ok(secret)
}

/// Drop the secret row for `(slug, adapter_id)`. Idempotent: deleting
/// a non-existent row is a no-op (SQLite's DELETE returns 0 rows
/// affected, which we surface as `Ok(())` rather than an error so the
/// detach command can run unconditionally).
pub fn delete_secret(c: &Connection, slug: &str, adapter_id: &str) -> Result<(), String> {
    c.execute(
        "DELETE FROM webhook_secrets WHERE project_slug = ?1 AND adapter_id = ?2",
        params![slug, adapter_id],
    )
    .map_err(|err| format!("DB error (delete webhook secret): {}", err))?;
    Ok(())
}

/// Convenience: open a fresh connection + read the secret. Wraps the
/// pattern used by every command-layer caller so the listener doesn't
/// have to thread the connection itself.
pub fn read_via_pool(slug: &str, adapter_id: &str) -> Result<Option<WebhookSecret>, String> {
    let c = io::conn()?;
    get_secret(&c, slug, adapter_id)
}

/// One row from `webhook_secrets`.
#[derive(Debug, Clone)]
pub struct WebhookSecret {
    /// Hex-encoded 32-byte secret.
    pub secret_hex: String,
    /// Unix-epoch milliseconds of the most recent install/rotate.
    pub last_rotated_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::schema::init_webhook_secrets_table;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        init_webhook_secrets_table(&conn).expect("init webhook secrets");
        conn
    }

    #[test]
    fn generate_secret_returns_64_hex_chars() {
        let secret = generate_secret();
        assert_eq!(secret.len(), SECRET_LEN_BYTES * 2);
        assert!(secret.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn generate_secret_is_random() {
        // 1-in-2^256 collision probability; this would be flaky only
        // if the CSPRNG was deterministic, which would itself be a
        // security bug worth catching.
        let a = generate_secret();
        let b = generate_secret();
        assert_ne!(a, b);
    }

    #[test]
    fn upsert_then_get_round_trips() {
        let conn = test_db();
        upsert_secret(&conn, "alpha", "linear", "abc123", 1000).expect("upsert");

        let got = get_secret(&conn, "alpha", "linear")
            .expect("get")
            .expect("present");
        assert_eq!(got.secret_hex, "abc123");
        assert_eq!(got.last_rotated_at, 1000);
    }

    #[test]
    fn upsert_replaces_prior_row() {
        let conn = test_db();
        upsert_secret(&conn, "alpha", "linear", "old", 1000).expect("first upsert");
        upsert_secret(&conn, "alpha", "linear", "new", 2000).expect("second upsert");

        let got = get_secret(&conn, "alpha", "linear")
            .expect("get")
            .expect("present");
        assert_eq!(got.secret_hex, "new");
        assert_eq!(got.last_rotated_at, 2000);
    }

    #[test]
    fn rotate_yields_new_value() {
        let conn = test_db();
        upsert_secret(&conn, "alpha", "linear", "old-fixed", 1000).expect("seed");

        let rotated = rotate_secret(&conn, "alpha", "linear", 2000).expect("rotate");
        assert_ne!(rotated, "old-fixed");
        assert_eq!(rotated.len(), SECRET_LEN_BYTES * 2);

        let got = get_secret(&conn, "alpha", "linear")
            .expect("get")
            .expect("present");
        assert_eq!(got.secret_hex, rotated);
    }

    #[test]
    fn delete_is_idempotent() {
        let conn = test_db();
        delete_secret(&conn, "alpha", "linear").expect("first delete");
        delete_secret(&conn, "alpha", "linear").expect("second delete");
        assert!(get_secret(&conn, "alpha", "linear").expect("get").is_none());
    }

    #[test]
    fn get_returns_none_when_absent() {
        let conn = test_db();
        assert!(get_secret(&conn, "missing", "linear")
            .expect("get")
            .is_none());
    }

    #[test]
    fn separate_adapters_keep_separate_rows() {
        let conn = test_db();
        upsert_secret(&conn, "alpha", "linear", "linear-secret", 1000).expect("linear");
        upsert_secret(&conn, "alpha", "github", "gh-secret", 1000).expect("github");

        let l = get_secret(&conn, "alpha", "linear").unwrap().unwrap();
        let g = get_secret(&conn, "alpha", "github").unwrap().unwrap();
        assert_eq!(l.secret_hex, "linear-secret");
        assert_eq!(g.secret_hex, "gh-secret");
    }
}
