//! Analytics — queries across `node_provenance` and `commit_lineage` to compute
//! per-session impact metrics.

use rusqlite::params;
use serde::Serialize;

use database::db::get_connection;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionImpact {
    pub session_id: String,
    pub files_touched: Vec<String>,
    pub functions_created: Vec<FunctionEntry>,
    pub commits_influenced: Vec<String>,
    pub total_lines_attributed: u32,
    pub first_edit_at: Option<i64>,
    pub last_commit_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionEntry {
    pub file: String,
    pub name: String,
    pub node_type: String,
    pub lines: (u32, u32),
}

pub fn get_provenance_session_ids() -> Result<Vec<String>, String> {
    let conn = get_connection().map_err(|err| format!("DB error: {}", err))?;
    let mut stmt = conn
        .prepare("SELECT DISTINCT session_id FROM node_provenance ORDER BY created_at DESC")
        .map_err(|err| format!("Prepare failed: {}", err))?;
    let rows = stmt
        .query_map([], |row| row.get(0))
        .map_err(|err| format!("Query failed: {}", err))?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_session_impact(session_id: &str) -> Result<SessionImpact, String> {
    let conn = get_connection().map_err(|err| format!("DB error: {}", err))?;

    let files_touched: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT DISTINCT file FROM node_provenance WHERE session_id = ?1")
            .map_err(|err| format!("Prepare failed: {}", err))?;
        let rows = stmt
            .query_map(params![session_id], |row| row.get(0))
            .map_err(|err| format!("Query failed: {}", err))?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let functions_created: Vec<FunctionEntry> = {
        let mut stmt = conn
            .prepare(
                "SELECT file, function_name, node_type, start_line, end_line
                 FROM node_provenance
                 WHERE session_id = ?1 AND function_name IS NOT NULL",
            )
            .map_err(|err| format!("Prepare failed: {}", err))?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(FunctionEntry {
                    file: row.get(0)?,
                    name: row.get(1)?,
                    node_type: row.get(2)?,
                    lines: (row.get(3)?, row.get(4)?),
                })
            })
            .map_err(|err| format!("Query failed: {}", err))?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let commits_influenced: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT cl.commit_id
                 FROM commit_lineage cl
                 JOIN node_provenance np ON cl.provenance_id = np.id
                 WHERE np.session_id = ?1",
            )
            .map_err(|err| format!("Prepare failed: {}", err))?;
        let rows = stmt
            .query_map(params![session_id], |row| row.get(0))
            .map_err(|err| format!("Query failed: {}", err))?;
        rows.filter_map(|r| r.ok()).collect()
    };

    let total_lines_attributed: u32 = conn
        .query_row(
            "SELECT COALESCE(SUM(
                CASE WHEN end_line < 2147483647
                     THEN end_line - start_line + 1
                     ELSE 0
                END
             ), 0) FROM node_provenance WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .map_err(|err| format!("Query failed: {}", err))?;

    let first_edit_at: Option<i64> = conn
        .query_row(
            "SELECT MIN(created_at) FROM node_provenance WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .map_err(|err| format!("Query failed: {}", err))?;

    let last_commit_at: Option<i64> = conn
        .query_row(
            "SELECT MAX(cl.created_at)
             FROM commit_lineage cl
             JOIN node_provenance np ON cl.provenance_id = np.id
             WHERE np.session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .map_err(|err| format!("Query failed: {}", err))?;

    Ok(SessionImpact {
        session_id: session_id.to_string(),
        files_touched,
        functions_created,
        commits_influenced,
        total_lines_attributed,
        first_edit_at,
        last_commit_at,
    })
}
