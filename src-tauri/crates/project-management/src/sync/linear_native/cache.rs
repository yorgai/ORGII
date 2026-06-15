use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};

use database::db::get_projects_connection;

const LINEAR_METADATA_CACHE_TTL_MS: i64 = 10 * 60 * 1000;
const LINEAR_METADATA_CACHE_MAX_ROWS: i64 = 500;
const ROOT_SCOPE_ID: &str = "root";

#[derive(Debug, Clone, Copy)]
pub(super) enum LinearCacheScope {
    Projects,
    Project,
    Teams,
    ProjectIssues,
    WorkflowStates,
}

impl LinearCacheScope {
    fn as_str(self) -> &'static str {
        match self {
            Self::Projects => "projects",
            Self::Project => "project",
            Self::Teams => "teams",
            Self::ProjectIssues => "project_issues",
            Self::WorkflowStates => "workflow_states",
        }
    }
}

pub(super) fn root_scope_id(cursor: Option<&str>) -> String {
    cursor.unwrap_or(ROOT_SCOPE_ID).to_string()
}

pub(super) async fn read<T>(
    connection_id: String,
    scope: LinearCacheScope,
    scope_id: String,
    force_refresh: bool,
) -> Result<Option<T>, String>
where
    T: DeserializeOwned + Send + 'static,
{
    if force_refresh {
        return Ok(None);
    }

    tokio::task::spawn_blocking(move || {
        let now_ms = current_time_ms()?;
        let connection = get_projects_connection().map_err(|err| format!("DB error: {err}"))?;
        let payload_json = connection
            .query_row(
                "SELECT payload_json
                 FROM linear_metadata_cache
                 WHERE connection_id = ?1
                   AND scope = ?2
                   AND scope_id = ?3
                   AND expires_at > ?4",
                params![connection_id, scope.as_str(), scope_id, now_ms],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|err| format!("DB error: {err}"))?;

        payload_json
            .map(|payload| serde_json::from_str(&payload).map_err(|err| err.to_string()))
            .transpose()
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

pub(super) async fn write<T>(
    connection_id: String,
    scope: LinearCacheScope,
    scope_id: String,
    value: T,
) -> Result<(), String>
where
    T: Serialize + Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        let now_ms = current_time_ms()?;
        let payload_json = serde_json::to_string(&value).map_err(|err| err.to_string())?;
        let connection = get_projects_connection().map_err(|err| format!("DB error: {err}"))?;
        connection
            .execute(
                "INSERT INTO linear_metadata_cache (
                    connection_id, scope, scope_id, payload_json, fetched_at, expires_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(connection_id, scope, scope_id) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    fetched_at = excluded.fetched_at,
                    expires_at = excluded.expires_at",
                params![
                    connection_id,
                    scope.as_str(),
                    scope_id,
                    payload_json,
                    now_ms,
                    now_ms + LINEAR_METADATA_CACHE_TTL_MS,
                ],
            )
            .map_err(|err| format!("DB error: {err}"))?;
        prune(&connection, now_ms)?;
        Ok(())
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

pub(super) async fn invalidate_scope(
    connection_id: String,
    scope: LinearCacheScope,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let connection = get_projects_connection().map_err(|err| format!("DB error: {err}"))?;
        connection
            .execute(
                "DELETE FROM linear_metadata_cache WHERE connection_id = ?1 AND scope = ?2",
                params![connection_id, scope.as_str()],
            )
            .map_err(|err| format!("DB error: {err}"))?;
        Ok(())
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

pub(super) async fn invalidate_record(
    connection_id: String,
    scope: LinearCacheScope,
    scope_id: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let connection = get_projects_connection().map_err(|err| format!("DB error: {err}"))?;
        connection
            .execute(
                "DELETE FROM linear_metadata_cache
                 WHERE connection_id = ?1 AND scope = ?2 AND scope_id = ?3",
                params![connection_id, scope.as_str(), scope_id],
            )
            .map_err(|err| format!("DB error: {err}"))?;
        Ok(())
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

fn prune(connection: &rusqlite::Connection, now_ms: i64) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM linear_metadata_cache WHERE expires_at <= ?1",
            params![now_ms],
        )
        .map_err(|err| format!("DB error: {err}"))?;
    connection
        .execute(
            "DELETE FROM linear_metadata_cache
             WHERE rowid IN (
                 SELECT rowid
                 FROM linear_metadata_cache
                 ORDER BY fetched_at ASC
                 LIMIT MAX((SELECT COUNT(*) FROM linear_metadata_cache) - ?1, 0)
             )",
            params![LINEAR_METADATA_CACHE_MAX_ROWS],
        )
        .map_err(|err| format!("DB error: {err}"))?;
    Ok(())
}

fn current_time_ms() -> Result<i64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .map_err(|err| format!("System clock error: {err}"))
}
