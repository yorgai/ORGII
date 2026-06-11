//! Read-only database queries against `projects.db`.
//!
//! All functions here perform only SELECT operations. Types that are purely
//! owned by the read surface (`SyncCursor`, `AdapterBinding`, `ProjectBinding`)
//! live here too.

use rusqlite::{params, Connection, OptionalExtension};

use super::super::types::{EntityType, OutboxEntry, OutboxOp, OutboxProblemRow, OutboxStatus};

// ── Value types ──────────────────────────────────────────────────────────────

/// Per-project pull cursor — what the worker persists between pull
/// cycles so adapters can ask the remote API for "everything since
/// `last_pull_at`" without re-walking the full backlog.
///
/// `last_pull_at` is Unix-epoch milliseconds. `cursor_blob` is an
/// opaque string the adapter chose (e.g. Linear's GraphQL pagination
/// cursor); the framework treats it as a black box.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SyncCursor {
    pub last_pull_at: Option<i64>,
    pub cursor_blob: Option<String>,
}

/// One row of the per-project adapter binding view used by the
/// worker's pull cycle to enumerate projects that need a pull pass.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdapterBinding {
    pub adapter_id: String,
    pub config_json: Option<String>,
    pub connection_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectBinding {
    pub project_slug: String,
    pub adapter_id: String,
    /// Raw `projects.sync_config_json` — adapter-specific connection
    /// config (e.g. GitHub's `{ owner, repo }`). Forwarded to
    /// [`super::super::adapter::SyncContext::config_json`].
    pub config_json: Option<String>,
    /// Global project-sync connection account selected by the project.
    pub connection_id: String,
    /// Wall-clock millis of the most recent successful webhook
    /// delivery for this project (across **any** adapter). Used
    /// to skip a poll cycle when a webhook landed inside the
    /// freshness window — see [`super::super::worker::pull_cycle`].
    /// `None` when the project has never received a webhook.
    pub last_webhook_at: Option<i64>,
}

// ── Row mappers ───────────────────────────────────────────────────────────────

pub(super) fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxEntry> {
    let entity_type_str: String = row.get(2)?;
    let op_str: String = row.get(4)?;
    let status_str: String = row.get(11)?;

    let entity_type = EntityType::from_db_str(&entity_type_str).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, err.into())
    })?;
    let op = OutboxOp::from_db_str(&op_str).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, err.into())
    })?;
    let status = OutboxStatus::from_db_str(&status_str).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(11, rusqlite::types::Type::Text, err.into())
    })?;

    Ok(OutboxEntry {
        id: Some(row.get(0)?),
        project_slug: row.get(1)?,
        entity_type,
        entity_id: row.get(3)?,
        op,
        field_path: row.get(5)?,
        payload_json: row.get(6)?,
        created_at: row.get(7)?,
        retry_count: row.get(8)?,
        last_attempted_at: row.get(9)?,
        last_error: row.get(10)?,
        status,
    })
}

pub(super) fn row_to_problem(row: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxProblemRow> {
    let entity_type_str: String = row.get(1)?;
    let op_str: String = row.get(3)?;
    let status_str: String = row.get(9)?;

    let entity_type = EntityType::from_db_str(&entity_type_str).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(1, rusqlite::types::Type::Text, err.into())
    })?;
    let op = OutboxOp::from_db_str(&op_str).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, err.into())
    })?;
    let status = OutboxStatus::from_db_str(&status_str).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(9, rusqlite::types::Type::Text, err.into())
    })?;

    Ok(OutboxProblemRow {
        id: row.get(0)?,
        entity_type,
        entity_id: row.get(2)?,
        op,
        field_path: row.get(4)?,
        created_at: row.get(5)?,
        last_attempted_at: row.get(6)?,
        retry_count: row.get(7)?,
        last_error: row.get(8)?,
        status,
        payload_json: row.get(10)?,
    })
}

// ── Query functions ───────────────────────────────────────────────────────────

/// Load a row by id. Returns Err when the id doesn't resolve — callers
/// have already proven the row exists via `claim_next_pending`, so an
/// absent row mid-flight is a bug, not an empty-result.
pub fn load_by_id(c: &Connection, id: i64) -> Result<OutboxEntry, String> {
    c.query_row(
        "SELECT id, project_slug, entity_type, entity_id, op, field_path,
                payload_json, created_at, retry_count, last_attempted_at,
                last_error, status
           FROM outbox_entries
          WHERE id = ?1",
        [id],
        row_to_entry,
    )
    .map_err(|err| format!("DB error (load by id={}): {}", id, err))
}

/// List every outbox row for a project. Used by `project_sync_status`
/// to summarize pending/failed/abandoned counts.
pub fn list_for_project(c: &Connection, project_slug: &str) -> Result<Vec<OutboxEntry>, String> {
    let mut stmt = c
        .prepare(
            "SELECT id, project_slug, entity_type, entity_id, op, field_path,
                    payload_json, created_at, retry_count, last_attempted_at,
                    last_error, status
               FROM outbox_entries
              WHERE project_slug = ?1
              ORDER BY created_at DESC, id DESC",
        )
        .map_err(|err| format!("DB error (prepare list): {}", err))?;
    let rows: Result<Vec<OutboxEntry>, _> = stmt
        .query_map([project_slug], row_to_entry)
        .map_err(|err| format!("DB error (query list): {}", err))?
        .collect();
    rows.map_err(|err| format!("DB error (collect list): {}", err))
}

/// List every `Failed` / `Abandoned` row for one project — the input
/// to the "Failed entries" UI section in `SyncSection`.
///
/// Sort order is `last_attempted_at DESC NULLS LAST, created_at DESC`
/// so the most recently-attempted problem floats to the top while
/// rows that haven't been re-attempted yet (NULL `last_attempted_at`,
/// possible after `reset_in_flight_to_pending` failed mid-cycle and
/// the user discards before another attempt) sink below them.
///
/// Each row maps directly to [`OutboxProblemRow`]; the wire shape
/// drops `project_slug` (the caller already knows it) and tightens
/// `id` to non-optional (every row reaching this surface has been
/// persisted).
pub fn list_problems(c: &Connection, project_slug: &str) -> Result<Vec<OutboxProblemRow>, String> {
    let mut stmt = c
        .prepare(
            "SELECT id, entity_type, entity_id, op, field_path,
                    created_at, last_attempted_at, retry_count,
                    last_error, status, payload_json
               FROM outbox_entries
              WHERE project_slug = ?1
                AND status IN (?2, ?3)
              ORDER BY (last_attempted_at IS NULL) ASC,
                       last_attempted_at DESC,
                       created_at DESC,
                       id DESC",
        )
        .map_err(|err| format!("DB error (prepare list_problems): {}", err))?;
    let rows = stmt
        .query_map(
            params![
                project_slug,
                OutboxStatus::Failed.as_db_str(),
                OutboxStatus::Abandoned.as_db_str(),
            ],
            row_to_problem,
        )
        .map_err(|err| format!("DB error (query list_problems): {}", err))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|err| format!("DB error (collect list_problems): {}", err))?);
    }
    Ok(out)
}

/// Read the adapter binding for one project. Returns `None` when the
/// project has `sync_kind = 'none'` (the default).
pub fn read_adapter_binding(
    c: &Connection,
    project_slug: &str,
) -> Result<Option<AdapterBinding>, String> {
    let row = c
        .query_row(
            "SELECT sync_kind, sync_config_json, sync_connection_id FROM projects WHERE slug = ?1",
            params![project_slug],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|err| format!("DB error (read binding): {}", err))?;
    let Some((adapter_id, config_json, connection_id)) = row else {
        return Err(format!("project not found: {}", project_slug));
    };
    if adapter_id == "none" {
        Ok(None)
    } else {
        let connection_id = connection_id.ok_or_else(|| {
            format!(
                "project '{project_slug}' is bound to adapter '{adapter_id}' without a sync connection"
            )
        })?;
        Ok(Some(AdapterBinding {
            adapter_id,
            config_json,
            connection_id,
        }))
    }
}

/// Read the (last_pull_at, cursor_blob) pair for one project. Errors
/// when the slug doesn't resolve — there is no "missing project ⇒
/// empty cursor" fallback because that would silently mask typos.
pub fn read_sync_cursor(c: &Connection, project_slug: &str) -> Result<SyncCursor, String> {
    c.query_row(
        "SELECT sync_last_pull_at, sync_cursor_blob FROM projects WHERE slug = ?1",
        params![project_slug],
        |row| {
            Ok(SyncCursor {
                last_pull_at: row.get::<_, Option<i64>>(0)?,
                cursor_blob: row.get::<_, Option<String>>(1)?,
            })
        },
    )
    .optional()
    .map_err(|err| format!("DB error (read sync cursor): {}", err))?
    .ok_or_else(|| format!("project not found: {}", project_slug))
}

/// Read the project's most recent webhook delivery timestamp
/// (`projects.sync_last_webhook_at`). Returns `None` when the
/// project has never received a webhook. Errors when the slug
/// doesn't resolve.
///
/// Used by [`super::super::commands`] to expose the freshness signal to
/// the UI ("webhook delivered N seconds ago"), and by the worker's
/// poll-cycle skip logic via [`list_bound_projects`].
pub fn read_last_webhook_at(c: &Connection, project_slug: &str) -> Result<Option<i64>, String> {
    c.query_row(
        "SELECT sync_last_webhook_at FROM projects WHERE slug = ?1",
        params![project_slug],
        |row| row.get::<_, Option<i64>>(0),
    )
    .optional()
    .map_err(|err| format!("DB error (read last_webhook_at): {}", err))?
    .ok_or_else(|| format!("project not found: {}", project_slug))
}

/// Most recent error message across the project's outbox rows. Used by
/// `project_sync_status` so the UI can surface "what went wrong" without
/// the consumer walking the full row list.
pub fn last_error_for_project(
    c: &Connection,
    project_slug: &str,
) -> Result<Option<String>, String> {
    c.query_row(
        "SELECT last_error
           FROM outbox_entries
          WHERE project_slug = ?1
            AND last_error IS NOT NULL
          ORDER BY last_attempted_at DESC, id DESC
          LIMIT 1",
        params![project_slug],
        |row| row.get::<_, Option<String>>(0),
    )
    .optional()
    .map(|opt| opt.flatten())
    .map_err(|err| format!("DB error (last error): {}", err))
}

/// Count rows by status, restricted to one project. Cheap because of
/// the `idx_outbox_project_entity` index.
pub fn count_by_status(
    c: &Connection,
    project_slug: &str,
    status: OutboxStatus,
) -> Result<u64, String> {
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM outbox_entries
              WHERE project_slug = ?1 AND status = ?2",
            params![project_slug, status.as_db_str()],
            |row| row.get(0),
        )
        .map_err(|err| format!("DB error (count): {}", err))?;
    Ok(n.max(0) as u64)
}

/// List every project with a non-`'none'` adapter binding. Order is
/// stable (slug ASC) so subsequent pull cycles iterate the same way
/// and rate-limited adapters don't starve some projects under load.
pub fn list_bound_projects(c: &Connection) -> Result<Vec<ProjectBinding>, String> {
    let mut stmt = c
        .prepare(
            "SELECT slug, sync_kind, sync_config_json, sync_connection_id, sync_last_webhook_at
               FROM projects
              WHERE sync_kind IS NOT NULL AND sync_kind != 'none'
                AND sync_connection_id IS NOT NULL
           ORDER BY slug ASC",
        )
        .map_err(|err| format!("DB error (list bindings prepare): {}", err))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ProjectBinding {
                project_slug: row.get::<_, String>(0)?,
                adapter_id: row.get::<_, String>(1)?,
                config_json: row.get::<_, Option<String>>(2)?,
                connection_id: row.get::<_, String>(3)?,
                last_webhook_at: row.get::<_, Option<i64>>(4)?,
            })
        })
        .map_err(|err| format!("DB error (list bindings query): {}", err))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|err| format!("DB error (list bindings row): {}", err))?);
    }
    Ok(out)
}
