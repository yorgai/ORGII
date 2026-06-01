//! Workspace persistence layer
//!
//! Stores Multi-repo Workspace presets in the shared `sessions.db` SQLite
//! database. Each workspace has a header row in `workspaces` and N folder
//! rows in `workspace_folders`.

use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};

use database::db::get_connection;

// ============================================
// Types
// ============================================

/// A single folder entry within a workspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFolderRecord {
    pub folder_path: String,
    pub folder_name: String,
    pub sort_order: i32,
    pub is_primary: bool,
    pub repo_id: Option<String>,
    pub kind: String,
}

/// Persisted workspace record with its folder list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub workspace_id: String,
    pub name: String,
    pub primary_repo_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub folders: Vec<WorkspaceFolderRecord>,
}

// ============================================
// CRUD Operations
// ============================================

/// Insert or update a workspace and its folder list.
/// Replaces all existing folders for the workspace atomically.
pub fn upsert_workspace(ws: &WorkspaceRecord) -> Result<(), String> {
    let conn = get_connection().map_err(|e| format!("DB error: {}", e))?;

    conn.execute(
        "INSERT INTO workspaces (workspace_id, name, primary_repo_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(workspace_id) DO UPDATE SET
           name            = excluded.name,
           primary_repo_id = excluded.primary_repo_id,
           updated_at      = excluded.updated_at",
        params![
            ws.workspace_id,
            ws.name,
            ws.primary_repo_id,
            ws.created_at,
            ws.updated_at,
        ],
    )
    .map_err(|e| format!("Failed to upsert workspace: {}", e))?;

    // Replace folder list
    conn.execute(
        "DELETE FROM workspace_folders WHERE workspace_id = ?1",
        [&ws.workspace_id],
    )
    .map_err(|e| format!("Failed to clear workspace folders: {}", e))?;

    for folder in &ws.folders {
        conn.execute(
            "INSERT INTO workspace_folders
             (workspace_id, folder_path, folder_name, sort_order, is_primary, repo_id, kind)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                ws.workspace_id,
                folder.folder_path,
                folder.folder_name,
                folder.sort_order,
                folder.is_primary as i32,
                folder.repo_id,
                folder.kind,
            ],
        )
        .map_err(|e| format!("Failed to insert workspace folder: {}", e))?;
    }

    Ok(())
}

/// List all workspaces with their folders, most recently updated first.
pub fn list_workspaces() -> Result<Vec<WorkspaceRecord>, String> {
    let conn = get_connection().map_err(|e| format!("DB error: {}", e))?;

    let mut ws_stmt = conn
        .prepare(
            "SELECT workspace_id, name, primary_repo_id, created_at, updated_at
             FROM workspaces
             ORDER BY updated_at DESC",
        )
        .map_err(|e| format!("Failed to prepare workspace query: {}", e))?;

    let workspaces: Vec<WorkspaceRecord> = ws_stmt
        .query_map([], |row| {
            Ok(WorkspaceRecord {
                workspace_id: row.get(0)?,
                name: row.get(1)?,
                primary_repo_id: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                folders: Vec::new(),
            })
        })
        .map_err(|e| format!("Failed to query workspaces: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read workspace row: {}", e))?;

    let mut result = Vec::with_capacity(workspaces.len());
    for mut ws in workspaces {
        ws.folders = list_workspace_folders(&conn, &ws.workspace_id)?;
        result.push(ws);
    }

    Ok(result)
}

/// Get a single workspace by ID with its folders.
pub fn get_workspace(workspace_id: &str) -> Result<Option<WorkspaceRecord>, String> {
    let conn = get_connection().map_err(|e| format!("DB error: {}", e))?;

    let result = conn.query_row(
        "SELECT workspace_id, name, primary_repo_id, created_at, updated_at
         FROM workspaces WHERE workspace_id = ?1",
        [workspace_id],
        |row| {
            Ok(WorkspaceRecord {
                workspace_id: row.get(0)?,
                name: row.get(1)?,
                primary_repo_id: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                folders: Vec::new(),
            })
        },
    );

    match result {
        Ok(mut ws) => {
            ws.folders = list_workspace_folders(&conn, &ws.workspace_id)?;
            Ok(Some(ws))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(err) => Err(format!("Failed to get workspace: {}", err)),
    }
}

/// Delete a workspace and its folders (cascade via FK or explicit delete).
pub fn delete_workspace(workspace_id: &str) -> Result<bool, String> {
    let conn = get_connection().map_err(|e| format!("DB error: {}", e))?;

    conn.execute(
        "DELETE FROM workspace_folders WHERE workspace_id = ?1",
        [workspace_id],
    )
    .map_err(|e| format!("Failed to delete workspace folders: {}", e))?;

    let deleted = conn
        .execute(
            "DELETE FROM workspaces WHERE workspace_id = ?1",
            [workspace_id],
        )
        .map_err(|e| format!("Failed to delete workspace: {}", e))?;

    Ok(deleted > 0)
}

/// Create a new workspace with folders. Returns the created record.
pub fn create_workspace(
    name: &str,
    folders: Vec<WorkspaceFolderRecord>,
) -> Result<WorkspaceRecord, String> {
    let now = Utc::now().to_rfc3339();
    let workspace_id = uuid::Uuid::new_v4().to_string();

    let primary_repo_id = folders
        .iter()
        .find(|f| f.is_primary)
        .and_then(|f| f.repo_id.clone());

    let ws = WorkspaceRecord {
        workspace_id,
        name: name.to_string(),
        primary_repo_id,
        created_at: now.clone(),
        updated_at: now,
        folders,
    };

    upsert_workspace(&ws)?;
    Ok(ws)
}

// ============================================
// Internal Helpers
// ============================================

fn list_workspace_folders(
    conn: &rusqlite::Connection,
    workspace_id: &str,
) -> Result<Vec<WorkspaceFolderRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT folder_path, folder_name, sort_order, is_primary, repo_id, kind
             FROM workspace_folders
             WHERE workspace_id = ?1
             ORDER BY sort_order ASC",
        )
        .map_err(|e| format!("Failed to prepare folder query: {}", e))?;

    let rows = stmt
        .query_map([workspace_id], |row| {
            Ok(WorkspaceFolderRecord {
                folder_path: row.get(0)?,
                folder_name: row.get(1)?,
                sort_order: row.get(2)?,
                is_primary: row.get::<_, i32>(3)? != 0,
                repo_id: row.get(4)?,
                kind: row
                    .get::<_, Option<String>>(5)?
                    .unwrap_or_else(|| "git".to_string()),
            })
        })
        .map_err(|e| format!("Failed to query workspace folders: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read workspace folder row: {}", e))?;

    Ok(rows)
}
