//! Database Connection Management
//!
//! Two physical SQLite files:
//! - `~/.orgii/sessions.db`           — sessions, CLI agents, inbox, dev
//!   records, lineage, orchestrator, plan approvals, agent-core unified
//!   session persistence. Entry point: `get_connection()`.
//! - `~/.orgii/projects/projects.db`  — projects, work items, labels,
//!   milestones, members. Entry point: `get_projects_connection()`.
//!
//! Splitting projects out lets the cross-device sync layer (Linear /
//! GitHub Issues / ORGII Cloud) treat the project DB as a self-contained
//! export bundle without touching the much larger and more sensitive
//! sessions DB. Cross-DB JOINs (e.g. work item ↔ session conversation)
//! remain possible via `ATTACH DATABASE` on whichever side reads.
//!
//! ## Schema-init dispatcher
//!
//! The actual `CREATE TABLE` DDL is owned by the `app` crate (each domain
//! module — `agent_sessions`, `inbox`, `dev_record`, `agent_core::*` —
//! contributes its own `init_*_tables`). At app startup, `app::run()` calls
//! [`register_sessions_init`] / [`register_projects_init`] with a function
//! pointer that walks every domain initializer in the right order. The
//! database crate never imports those modules; the dispatcher is just a
//! `OnceLock<InitFn>` per physical DB.
//!
//! If no initializer is registered (e.g. a test that only needs the
//! connection for raw SQL), the connection is returned with PRAGMAs
//! applied and no schema attempted.

use rusqlite::{Connection, Result as SqliteResult};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// Per-connection PRAGMA settings (must run on every new connection).
///
/// Touching these settings affects every caller of [`get_connection`]; the
/// projects DB layers `PRAGMA foreign_keys = ON` on top inside
/// [`get_projects_connection`].
pub fn configure_connection(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA cache_size = -64000;
         PRAGMA temp_store = MEMORY;
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(())
}

/// Resolve the path to `~/.orgii/sessions.db`, creating its parent directory
/// on demand and migrating an old `{data_local_dir}/orgii/cache/sessions.db`
/// once if it still exists.
///
/// The migration WAL-checkpoints the source first (TRUNCATE mode) so a
/// half-synced WAL can never produce a corrupt copy at the new path.
pub fn get_db_path() -> PathBuf {
    let new_path = app_paths::sessions_db();
    let new_dir = new_path.parent().unwrap_or(Path::new("."));

    std::fs::create_dir_all(new_dir).ok();

    if !new_path.exists() {
        let old_path = dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("orgii")
            .join("cache")
            .join("sessions.db");

        if old_path.exists() {
            // Checkpoint the WAL first so all data is in the main DB file.
            // This avoids copying a half-synced WAL which could produce a corrupt DB.
            if let Ok(old_conn) = Connection::open(&old_path) {
                // TRUNCATE mode flushes WAL into the main DB and removes the WAL file
                if let Err(err) = old_conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);") {
                    eprintln!(
                        "[DB Migration] WAL checkpoint failed (proceeding anyway): {}",
                        err
                    );
                }
                drop(old_conn);
            }

            // Copy the main DB file (WAL should be empty/removed after checkpoint)
            if let Err(err) = std::fs::copy(&old_path, &new_path) {
                eprintln!(
                    "[DB Migration] Failed to copy {} → {}: {}",
                    old_path.display(),
                    new_path.display(),
                    err
                );
            } else {
                println!(
                    "[DB Migration] Migrated sessions.db to {}",
                    new_path.display()
                );
                // Copy WAL/SHM files as a safety net (should be empty after checkpoint)
                for suffix in &["-wal", "-shm"] {
                    let old_extra = old_path.with_extension(format!("db{}", suffix));
                    let new_extra = new_path.with_extension(format!("db{}", suffix));
                    if old_extra.exists() {
                        std::fs::copy(&old_extra, &new_extra).ok();
                    }
                }
            }
        }
    }

    new_path
}

/// Type signature shared by the per-DB schema initializers registered from
/// the `app` crate. Function pointers (rather than trait objects) keep the
/// registration cell `Copy` and avoid an `Arc<dyn>` round trip.
pub type InitFn = fn(&Connection) -> SqliteResult<()>;

fn sessions_init_cell() -> &'static OnceLock<InitFn> {
    static CELL: OnceLock<InitFn> = OnceLock::new();
    &CELL
}

fn projects_init_cell() -> &'static OnceLock<InitFn> {
    static CELL: OnceLock<InitFn> = OnceLock::new();
    &CELL
}

/// Register the schema initializer for `~/.orgii/sessions.db`.
///
/// Called once from `app::run()` before any consumer opens a connection.
/// Subsequent calls are silently ignored (the cell is `OnceLock`); this
/// keeps tests safe — they may re-enter `run`-style setup and a second
/// register is a no-op rather than a panic.
pub fn register_sessions_init(init_fn: InitFn) {
    let _ = sessions_init_cell().set(init_fn);
}

/// Register the schema initializer for `~/.orgii/projects/projects.db`.
///
/// Same semantics as [`register_sessions_init`].
pub fn register_projects_init(init_fn: InitFn) {
    let _ = projects_init_cell().set(init_fn);
}

/// Set of physical DB paths that have already had their schema initialized
/// in this process. Schema DDL is idempotent (all statements use
/// `IF NOT EXISTS`) so re-initializing is safe — but running it once per
/// path saves work and avoids log spam on repeated connections.
///
/// We intentionally do NOT use `std::sync::Once` here: in production the
/// path is stable and hits the `Once` equivalent (first-seen insert into
/// the set), while in tests `ORGII_HOME` rotates per sandbox, so every
/// fresh tempdir picks up a new entry and runs init against its own
/// brand-new SQLite file. The `Once`-based implementation could not
/// express that, and poisoning the `Once` via any init panic would take
/// down the rest of the test suite.
fn initialized_paths() -> &'static Mutex<HashSet<PathBuf>> {
    static INITIALIZED: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    INITIALIZED.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Open a SQLite file at `db_path`, apply per-connection PRAGMAs, and run
/// `init_fn` exactly once per physical path per process.
///
/// On init failure the path is removed from the initialized set so the
/// next caller retries — a transient I/O blip on first touch should not
/// disable schema migration for the rest of the process lifetime.
fn open_with_init(db_path: &Path, init_fn: Option<InitFn>) -> SqliteResult<Connection> {
    let conn = Connection::open(db_path)?;
    configure_connection(&conn)?;

    let Some(init_fn) = init_fn else {
        return Ok(conn);
    };

    let needs_init = {
        let mut set = initialized_paths()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        set.insert(db_path.to_path_buf())
    };
    if needs_init {
        if let Err(err) = init_fn(&conn) {
            let mut set = initialized_paths()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            set.remove(db_path);
            tracing::error!(
                "[database::db] schema init failed for {}: {}",
                db_path.display(),
                err
            );
            return Err(err);
        }
    }

    Ok(conn)
}

/// Open a connection to `~/.orgii/sessions.db`.
///
/// Schema includes sessions, CLI agents, inbox, dev records, lineage,
/// orchestrator state, plan approvals, and the agent-core unified
/// session layer — but only when the `app` crate has called
/// [`register_sessions_init`] at startup. Without a registered initializer
/// the connection is returned with PRAGMAs applied and no schema attempted
/// (sufficient for raw-SQL tests).
///
/// # Example
/// ```ignore
/// use database::db::get_connection;
///
/// let conn = get_connection()?;
/// conn.execute("INSERT INTO ...", params![...])?;
/// ```
pub fn get_connection() -> SqliteResult<Connection> {
    open_with_init(&get_db_path(), sessions_init_cell().get().copied())
}

/// Open a connection to `~/.orgii/projects/projects.db`.
///
/// Schema includes projects, work items, labels, milestones, and
/// members. The parent directory is created on demand. Foreign-key
/// enforcement is enabled here (and only here) so the cascade-delete
/// rules in the project schema fire as designed.
///
/// # Example
/// ```ignore
/// use database::db::get_projects_connection;
///
/// let conn = get_projects_connection()?;
/// conn.execute("INSERT INTO projects ...", params![...])?;
/// ```
pub fn get_projects_connection() -> SqliteResult<Connection> {
    let path = app_paths::projects_db();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let conn = open_with_init(&path, projects_init_cell().get().copied())?;
    // Foreign-key enforcement is per-connection in SQLite. The `projects`
    // schema relies on `ON DELETE CASCADE` to keep work items, labels,
    // milestones, and members consistent; we opt in here without
    // touching `configure_connection`, which is shared with sessions.db
    // and modules that have not been audited for cascade safety.
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(conn)
}
