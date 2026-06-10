//! SQLite persistence for `PlanApprovalManager`.
//!
//! Schema — one row per session, replaced on new `mark_ready`:
//!
//! ```sql
//! CREATE TABLE pending_plan_approvals (
//!   session_id    TEXT PRIMARY KEY,
//!   tool_call_id  TEXT,
//!   plan_path     TEXT NOT NULL,
//!   plan_title    TEXT NOT NULL,
//!   plan_content  TEXT NOT NULL,
//!   created_at    INTEGER NOT NULL
//! ) WITHOUT ROWID;
//! ```
//!
//! Invariants enforced by this module + its single caller
//! (`PlanApprovalManager`):
//!
//! - At most one row per `session_id` (PK).
//! - Row presence mirrors `PlanApprovalManager::pending == Some(_)` for the
//!   same session. The manager only writes the DB while holding the
//!   per-session `pending` mutex, so there is no split-brain window.
//! - `rehydrate_from_db` ignores (and deletes) rows whose `plan_path` no
//!   longer exists on disk.

use rusqlite::{params, Connection, OptionalExtension, Result as SqliteResult};

use database::db::get_connection;

#[derive(Debug, Clone)]
pub struct PendingPlanRow {
    pub session_id: String,
    pub tool_call_id: Option<String>,
    pub plan_id: String,
    pub plan_revision_id: String,
    pub origin_tool_call_id: Option<String>,
    pub plan_path: String,
    pub plan_title: String,
    pub plan_content: String,
    pub created_at_ms: i64,
}

#[derive(Debug)]
pub enum StoreError {
    Sqlite(rusqlite::Error),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::Sqlite(err) => write!(f, "sqlite: {err}"),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<rusqlite::Error> for StoreError {
    fn from(value: rusqlite::Error) -> Self {
        StoreError::Sqlite(value)
    }
}

/// Initialize the `pending_plan_approvals` table. Called once per process
/// from `database::db::connection::init_all_schemas`.
pub fn init_schema(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS pending_plan_approvals (
            session_id    TEXT PRIMARY KEY,
            tool_call_id  TEXT,
            plan_id       TEXT,
            plan_revision_id TEXT,
            origin_tool_call_id TEXT,
            plan_path     TEXT NOT NULL,
            plan_title    TEXT NOT NULL,
            plan_content  TEXT NOT NULL,
            created_at    INTEGER NOT NULL
        ) WITHOUT ROWID;",
    )?;
    let _ = conn.execute(
        "ALTER TABLE pending_plan_approvals ADD COLUMN plan_id TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE pending_plan_approvals ADD COLUMN plan_revision_id TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE pending_plan_approvals ADD COLUMN origin_tool_call_id TEXT",
        [],
    );
    Ok(())
}

fn fallback_plan_id(session_id: &str, plan_path: &str) -> String {
    let suffix = std::path::Path::new(plan_path)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("plan")
        .replace(|character: char| !character.is_ascii_alphanumeric(), "-");
    format!("plan-{session_id}-{suffix}")
}

pub struct PlanApprovalStore;

impl PlanApprovalStore {
    pub fn load_by_session(session_id: &str) -> Result<Option<PendingPlanRow>, StoreError> {
        let conn = get_connection()?;
        let row = conn
            .query_row(
                "SELECT session_id, tool_call_id, plan_id, plan_revision_id, origin_tool_call_id,
                        plan_path, plan_title, plan_content, created_at
                 FROM pending_plan_approvals
                 WHERE session_id = ?1",
                params![session_id],
                |r| {
                    let loaded_session_id: String = r.get(0)?;
                    let tool_call_id: Option<String> = r.get(1)?;
                    let plan_path: String = r.get(5)?;
                    let fallback_plan_id = fallback_plan_id(&loaded_session_id, &plan_path);
                    let plan_id = r.get::<_, Option<String>>(2)?.unwrap_or(fallback_plan_id);
                    let plan_revision_id = r
                        .get::<_, Option<String>>(3)?
                        .or_else(|| tool_call_id.clone())
                        .unwrap_or_else(|| plan_id.clone());
                    Ok(PendingPlanRow {
                        session_id: loaded_session_id,
                        tool_call_id,
                        plan_id,
                        plan_revision_id,
                        origin_tool_call_id: r.get(4)?,
                        plan_path,
                        plan_title: r.get(6)?,
                        plan_content: r.get(7)?,
                        created_at_ms: r.get(8)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    pub fn upsert(row: &PendingPlanRow) -> Result<(), StoreError> {
        let conn = get_connection()?;
        conn.execute(
            "INSERT INTO pending_plan_approvals
                (session_id, tool_call_id, plan_id, plan_revision_id, origin_tool_call_id,
                 plan_path, plan_title, plan_content, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(session_id) DO UPDATE SET
                tool_call_id         = excluded.tool_call_id,
                plan_id              = excluded.plan_id,
                plan_revision_id     = excluded.plan_revision_id,
                origin_tool_call_id  = excluded.origin_tool_call_id,
                plan_path            = excluded.plan_path,
                plan_title           = excluded.plan_title,
                plan_content         = excluded.plan_content,
                created_at           = excluded.created_at",
            params![
                row.session_id,
                row.tool_call_id,
                row.plan_id,
                row.plan_revision_id,
                row.origin_tool_call_id,
                row.plan_path,
                row.plan_title,
                row.plan_content,
                row.created_at_ms,
            ],
        )?;
        Ok(())
    }

    pub fn delete_by_session(session_id: &str) -> Result<(), StoreError> {
        let conn = get_connection()?;
        conn.execute(
            "DELETE FROM pending_plan_approvals WHERE session_id = ?1",
            params![session_id],
        )?;
        Ok(())
    }

    /// Full-table scan used by the startup orphan GC. Returns every pending
    /// row across all sessions so the GC can validate plan-file existence,
    /// session existence, and exec mode in one pass.
    pub fn list_all() -> Result<Vec<PendingPlanRow>, StoreError> {
        let conn = get_connection()?;
        let mut stmt = conn.prepare(
            "SELECT session_id, tool_call_id, plan_id, plan_revision_id, origin_tool_call_id,
                    plan_path, plan_title, plan_content, created_at
             FROM pending_plan_approvals",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let loaded_session_id: String = r.get(0)?;
                let tool_call_id: Option<String> = r.get(1)?;
                let plan_path: String = r.get(5)?;
                let fallback_plan_id = fallback_plan_id(&loaded_session_id, &plan_path);
                let plan_id = r.get::<_, Option<String>>(2)?.unwrap_or(fallback_plan_id);
                let plan_revision_id = r
                    .get::<_, Option<String>>(3)?
                    .or_else(|| tool_call_id.clone())
                    .unwrap_or_else(|| plan_id.clone());
                Ok(PendingPlanRow {
                    session_id: loaded_session_id,
                    tool_call_id,
                    plan_id,
                    plan_revision_id,
                    origin_tool_call_id: r.get(4)?,
                    plan_path,
                    plan_title: r.get(6)?,
                    plan_content: r.get(7)?,
                    created_at_ms: r.get(8)?,
                })
            })?
            .collect::<SqliteResult<Vec<_>>>()?;
        Ok(rows)
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    //! Shared test harness for anything that touches the real sqlite
    //! connection via `get_connection()`.
    //!
    //! Delegates to the crate-wide `test_env::sandbox()`, which:
    //!  - Acquires the single process-wide home lock (poison-safe).
    //!  - Points `ORGII_HOME` and `HOME` at a fresh tempdir unique to
    //!    this test invocation.
    //!  - Primes the full DB schema so `get_connection()` inside the
    //!    sandbox returns a fully-migrated brand-new DB.
    //!  - Restores the previous env on drop.
    //!
    //! Use the returned `SandboxGuard` as the lifetime for the test:
    //! it serializes env mutation with every other sandboxed test in
    //! the binary (no more cross-module `ORGII_HOME` races) and guarantees
    //! the plan_approval schema exists even when a sibling test opened a
    //! sandbox first.
    use test_helpers::test_env::{sandbox, SandboxGuard};

    pub fn lock_and_prepare() -> SandboxGuard {
        let guard = sandbox();
        let conn = database::db::get_connection().expect("test sqlite connection");
        super::init_schema(&conn).expect("pending plan approvals schema");
        let _ = conn.execute("DELETE FROM pending_plan_approvals", []);
        guard
    }

    /// Path to the active sandbox's home directory. Valid only while
    /// the `SandboxGuard` returned by [`lock_and_prepare`] is alive;
    /// calling it outside a sandbox returns the caller's real `$HOME`
    /// (which is almost certainly not what the test wants).
    pub fn temp_home() -> std::path::PathBuf {
        std::env::var("ORGII_HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| {
                // Fallback for diagnostic clarity — a test calling
                // `temp_home()` outside a sandbox is a bug; returning
                // the default orgii root makes the failure loud.
                app_paths::orgii_root()
            })
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::lock_and_prepare;
    use super::*;

    fn sample_row(sid: &str, path: &str) -> PendingPlanRow {
        PendingPlanRow {
            session_id: sid.into(),
            tool_call_id: Some("call_x".into()),
            plan_id: format!("plan-{sid}"),
            plan_revision_id: "call_x".into(),
            origin_tool_call_id: Some("call_x".into()),
            plan_path: path.into(),
            plan_title: "Title".into(),
            plan_content: "content".into(),
            created_at_ms: 1_700_000_000_000,
        }
    }

    #[test]
    fn upsert_load_delete_round_trip() {
        let _lock = lock_and_prepare();

        let row = sample_row("sess_a", "/tmp/a.md");
        PlanApprovalStore::upsert(&row).unwrap();

        let loaded = PlanApprovalStore::load_by_session("sess_a")
            .unwrap()
            .unwrap();
        assert_eq!(loaded.session_id, "sess_a");
        assert_eq!(loaded.plan_path, "/tmp/a.md");
        assert_eq!(loaded.tool_call_id.as_deref(), Some("call_x"));
        assert_eq!(loaded.plan_revision_id, "call_x");
        assert_eq!(loaded.origin_tool_call_id.as_deref(), Some("call_x"));
        assert_eq!(loaded.plan_title, "Title");
        assert_eq!(loaded.plan_content, "content");
        assert_eq!(loaded.created_at_ms, 1_700_000_000_000);

        PlanApprovalStore::delete_by_session("sess_a").unwrap();
        assert!(PlanApprovalStore::load_by_session("sess_a")
            .unwrap()
            .is_none());
    }

    #[test]
    fn upsert_replaces_existing_row_same_session() {
        let _lock = lock_and_prepare();

        let mut row = sample_row("sess_b", "/tmp/one.md");
        PlanApprovalStore::upsert(&row).unwrap();
        row.plan_path = "/tmp/two.md".into();
        row.plan_title = "Second".into();
        PlanApprovalStore::upsert(&row).unwrap();

        let loaded = PlanApprovalStore::load_by_session("sess_b")
            .unwrap()
            .unwrap();
        assert_eq!(loaded.plan_path, "/tmp/two.md");
        assert_eq!(loaded.plan_title, "Second");

        // Exactly one row for this session.
        let conn = get_connection().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pending_plan_approvals WHERE session_id = ?1",
                params!["sess_b"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);

        PlanApprovalStore::delete_by_session("sess_b").unwrap();
    }

    #[test]
    fn delete_missing_row_is_noop() {
        let _lock = lock_and_prepare();
        PlanApprovalStore::delete_by_session("nope").unwrap();
    }
}
