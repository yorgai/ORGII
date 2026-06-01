//! Per-process connection pool for DB Browser.
//!
//! Connections are keyed by a `connection_id` string generated from the file path.
//! Each connection is a `rusqlite::Connection` opened in read-write mode.
//! The pool is capped at `MAX_CONNECTIONS` to prevent leaks.

use rusqlite::{Connection, OpenFlags, Result as SqliteResult};
use std::collections::HashMap;
use std::sync::Mutex;

const MAX_CONNECTIONS: usize = 16;

static POOL: std::sync::LazyLock<Mutex<HashMap<String, Connection>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

fn connection_id_for(path: &str) -> String {
    format!("db:{}", path)
}

/// Open a connection. Returns the `connection_id`.
/// If already open, returns the existing ID.
pub fn open(path: &str) -> SqliteResult<String> {
    let id = connection_id_for(path);
    let mut pool = POOL.lock().unwrap_or_else(|e| e.into_inner());

    if pool.contains_key(&id) {
        return Ok(id);
    }

    // Evict oldest if at cap (simple FIFO)
    if pool.len() >= MAX_CONNECTIONS {
        if let Some(oldest_key) = pool.keys().next().cloned() {
            pool.remove(&oldest_key);
        }
    }

    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;

    // Tune for interactive browsing without touching the journal mode —
    // the user's file may intentionally use DELETE or MEMORY journal mode.
    conn.execute_batch(
        "PRAGMA synchronous = NORMAL;
         PRAGMA cache_size = -8000;",
    )?;

    pool.insert(id.clone(), conn);

    Ok(id)
}

/// Close a connection.
pub fn close(connection_id: &str) {
    let mut pool = POOL.lock().unwrap_or_else(|e| e.into_inner());
    pool.remove(connection_id);
}

/// Execute a closure with a reference to the connection.
/// Returns an error if the connection is not found.
pub fn with<F, T>(connection_id: &str, func: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> SqliteResult<T>,
{
    let pool = POOL.lock().unwrap_or_else(|e| e.into_inner());
    let conn = pool
        .get(connection_id)
        .ok_or_else(|| format!("DB connection not found: {}", connection_id))?;
    func(conn).map_err(|e| e.to_string())
}
