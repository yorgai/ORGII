//! Repository persistence layer
//!
//! Stores tracked repositories in the shared `sessions.db` SQLite database
//! (same DB as agent_sessions, events, `code_sessions` table, etc.).
//!
//! Uses `session::cache::get_connection()` — no separate DB file needed.

use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};

// Re-use the shared database connection
use database::db::get_connection;

// ============================================
// Types
// ============================================

/// Distinguishes git repositories from plain work folders.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RepoKind {
    Git,
    Folder,
}

impl RepoKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            RepoKind::Git => "git",
            RepoKind::Folder => "folder",
        }
    }

    pub fn from_db(value: Option<String>) -> Self {
        match value.as_deref() {
            Some("folder") => RepoKind::Folder,
            _ => RepoKind::Git,
        }
    }
}

/// Persisted repository record.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRecord {
    pub repo_id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
    pub updated_at: String,
    pub visibility: Option<String>,
    pub kind: RepoKind,
}

// ============================================
// CRUD Operations
// ============================================

/// Insert or update a repository.
pub fn upsert_repo(repo: &RepoRecord) -> Result<(), String> {
    let conn = get_connection().map_err(|e| format!("DB error: {}", e))?;
    conn.execute(
        "INSERT INTO repos (repo_id, name, path, created_at, updated_at, visibility, kind)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(repo_id) DO UPDATE SET
           name       = excluded.name,
           path       = excluded.path,
           updated_at = excluded.updated_at,
           visibility = excluded.visibility,
           kind       = excluded.kind",
        params![
            repo.repo_id,
            repo.name,
            repo.path,
            repo.created_at,
            repo.updated_at,
            repo.visibility,
            repo.kind.as_str(),
        ],
    )
    .map_err(|e| format!("Failed to upsert repo: {}", e))?;
    Ok(())
}

/// List all tracked repositories, most recently updated first.
pub fn list_repos() -> Result<Vec<RepoRecord>, String> {
    let conn = get_connection().map_err(|e| format!("DB error: {}", e))?;
    let mut stmt = conn
        .prepare(
            "SELECT repo_id, name, path, created_at, updated_at, visibility, kind
             FROM repos
             ORDER BY updated_at DESC",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(RepoRecord {
                repo_id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                visibility: row.get(5)?,
                kind: RepoKind::from_db(row.get(6)?),
            })
        })
        .map_err(|e| format!("Failed to query repos: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read repo row: {}", e))?;

    Ok(rows)
}

/// Get a single repository by ID.
pub fn get_repo(repo_id: &str) -> Result<Option<RepoRecord>, String> {
    let conn = get_connection().map_err(|e| format!("DB error: {}", e))?;
    let result = conn.query_row(
        "SELECT repo_id, name, path, created_at, updated_at, visibility, kind
         FROM repos WHERE repo_id = ?1",
        [repo_id],
        |row| {
            Ok(RepoRecord {
                repo_id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                visibility: row.get(5)?,
                kind: RepoKind::from_db(row.get(6)?),
            })
        },
    );

    match result {
        Ok(record) => Ok(Some(record)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(err) => Err(format!("Failed to get repo: {}", err)),
    }
}

/// Update visibility for a repository by path.
pub fn update_repo_visibility(path: &str, visibility: &str) -> Result<(), String> {
    let conn = get_connection().map_err(|e| format!("DB error: {}", e))?;
    conn.execute(
        "UPDATE repos SET visibility = ?1 WHERE path = ?2",
        params![visibility, path],
    )
    .map_err(|e| format!("Failed to update visibility: {}", e))?;
    Ok(())
}

/// Delete a repository by ID.
pub fn delete_repo(repo_id: &str) -> Result<bool, String> {
    let conn = get_connection().map_err(|e| format!("DB error: {}", e))?;
    let deleted = conn
        .execute("DELETE FROM repos WHERE repo_id = ?1", [repo_id])
        .map_err(|e| format!("Failed to delete repo: {}", e))?;
    Ok(deleted > 0)
}

/// Insert a new repo if not already tracked, or update name + updated_at if it exists.
///
/// Uses a single atomic UPSERT to avoid TOCTOU race conditions.
/// Returns the resulting record.
pub fn ensure_repo(
    repo_id: &str,
    name: &str,
    path: &str,
    kind: RepoKind,
) -> Result<RepoRecord, String> {
    let now = Utc::now().to_rfc3339();
    let conn = get_connection().map_err(|e| format!("DB error: {}", e))?;

    // Atomic upsert: insert if new, update name + updated_at if exists
    conn.execute(
        "INSERT INTO repos (repo_id, name, path, created_at, updated_at, kind)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(repo_id) DO UPDATE SET
           name       = excluded.name,
           updated_at = excluded.updated_at,
           kind       = excluded.kind
         ",
        params![repo_id, name, path, now, now, kind.as_str()],
    )
    .map_err(|e| format!("Failed to upsert repo: {}", e))?;

    // Also handle conflict on path (different repo_id, same path)
    // The UNIQUE index on path would cause the insert to fail if a different
    // repo_id points to the same path. Handle by trying a path-based upsert too.
    conn.execute(
        "INSERT INTO repos (repo_id, name, path, created_at, updated_at, kind)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(path) DO UPDATE SET
           name       = excluded.name,
           updated_at = excluded.updated_at,
           kind       = excluded.kind
         ",
        params![repo_id, name, path, now, now, kind.as_str()],
    )
    .ok(); // Best-effort: if repo_id was already the same, first insert succeeded

    // Read back the record (either newly created or existing)
    get_repo(repo_id)?
        .or_else(|| {
            // Fallback: might have been stored under a different repo_id (path match)
            let conn = get_connection().ok()?;
            conn.query_row(
                "SELECT repo_id, name, path, created_at, updated_at, visibility, kind FROM repos WHERE path = ?1",
                [path],
                |row| Ok(RepoRecord {
                    repo_id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                    visibility: row.get(5)?,
                    kind: RepoKind::from_db(row.get(6)?),
                }),
            ).ok()
        })
        .ok_or_else(|| "Failed to read back upserted repo".to_string())
}
