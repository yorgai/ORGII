//! Persistent blacklist for L3 reflection LLM calls.
//!
//! Once an `(account_id, model_id)` pair fails reflection (provider error,
//! quota exceeded, model not configured, etc.) it is recorded here and
//! all future reflection attempts for that pair are skipped indefinitely.
//!
//! This is intentionally persistent across process restarts: a broken
//! account/model combination does not silently heal on restart, and the
//! agent should not waste an LLM call (and pollute logs) once per session
//! end forever. The user must explicitly clear the row to re-enable
//! reflection for that pair (e.g. after rotating an API key).

use rusqlite::{params, Connection, OptionalExtension, Result as SqliteResult};

const BLACKLIST_KEY_NONE: &str = "<none>";

pub fn init_reflection_blacklist_table(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS reflection_blacklist (
            account_id      TEXT NOT NULL,
            model_id        TEXT NOT NULL,
            error           TEXT,
            failed_at       TEXT NOT NULL,
            PRIMARY KEY (account_id, model_id)
        );",
    )?;
    Ok(())
}

/// Returns Some(error) if this (account, model) pair is blacklisted; None otherwise.
pub fn check(
    conn: &Connection,
    account_id: Option<&str>,
    model_id: &str,
) -> SqliteResult<Option<String>> {
    let account_key = account_id.unwrap_or(BLACKLIST_KEY_NONE);
    let row: Option<Option<String>> = conn
        .query_row(
            "SELECT error FROM reflection_blacklist WHERE account_id = ?1 AND model_id = ?2",
            params![account_key, model_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?;
    Ok(row.map(|inner| inner.unwrap_or_default()))
}

/// Mark an (account, model) pair as blacklisted. Idempotent — replaces any
/// existing row so the most recent failure is recorded.
pub fn record(
    conn: &Connection,
    account_id: Option<&str>,
    model_id: &str,
    error: &str,
) -> SqliteResult<()> {
    let account_key = account_id.unwrap_or(BLACKLIST_KEY_NONE);
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR REPLACE INTO reflection_blacklist
            (account_id, model_id, error, failed_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![account_key, model_id, error, now],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_reflection_blacklist_table(&conn).unwrap();
        conn
    }

    #[test]
    fn check_returns_none_when_not_blacklisted() {
        let conn = fresh_conn();
        assert!(check(&conn, Some("acct-1"), "gpt-4o").unwrap().is_none());
    }

    #[test]
    fn record_then_check_returns_error() {
        let conn = fresh_conn();
        record(&conn, Some("acct-1"), "gpt-4o", "quota exceeded").unwrap();
        let got = check(&conn, Some("acct-1"), "gpt-4o").unwrap();
        assert_eq!(got.as_deref(), Some("quota exceeded"));
    }

    #[test]
    fn none_account_id_is_treated_as_distinct_key() {
        let conn = fresh_conn();
        record(&conn, None, "gpt-4o", "no provider").unwrap();
        assert!(check(&conn, None, "gpt-4o").unwrap().is_some());
        assert!(check(&conn, Some("acct-1"), "gpt-4o").unwrap().is_none());
    }

    #[test]
    fn record_is_idempotent_and_overwrites_error() {
        let conn = fresh_conn();
        record(&conn, Some("acct-1"), "gpt-4o", "first").unwrap();
        record(&conn, Some("acct-1"), "gpt-4o", "second").unwrap();
        let got = check(&conn, Some("acct-1"), "gpt-4o").unwrap();
        assert_eq!(got.as_deref(), Some("second"));
    }

    #[test]
    fn different_model_is_not_blacklisted() {
        let conn = fresh_conn();
        record(&conn, Some("acct-1"), "gpt-4o", "fail").unwrap();
        assert!(check(&conn, Some("acct-1"), "gpt-5").unwrap().is_none());
    }
}
