//! Outbox CRUD against `projects.db`.
//!
//! Every public function here is `Result<T, String>` per the project
//! store convention. The atomic claim path is the centerpiece: a single
//! UPDATE … SET status='in_flight' WHERE id=? AND status='pending'
//! moves a row out of the pending pool with no race window.

use rusqlite::{params, Connection, OptionalExtension};

use database::db::get_projects_connection;

use super::types::{EntityType, OutboxEntry, OutboxOp, OutboxProblemRow, OutboxStatus};

/// Backoff schedule for `failed` rows. Index is `retry_count - 1`; when
/// `retry_count` exceeds the table length the row transitions to
/// `Abandoned` instead of getting another retry slot.
///
/// Values: 30s, 2m, 10m, 1h. Total ~1h 12m before abandonment.
pub const RETRY_BACKOFF_SECS: &[u64] = &[30, 120, 600, 3600];

/// `retry_count` value at and beyond which the row is abandoned.
/// `len()` because retries are 1-indexed in the schedule above (the
/// row is on its Nth attempt; once N == 5 we run out of slots).
pub const MAX_RETRY_COUNT: u32 = 5;

/// Open a fresh `projects.db` connection. Mirrors
/// `projects::io::helpers::conn` so the sync layer doesn't need a
/// cross-module pub helper.
pub fn conn() -> Result<Connection, String> {
    let connection = get_projects_connection().map_err(|err| format!("DB error: {}", err))?;
    #[cfg(test)]
    crate::projects::schema::init_project_tables(&connection)
        .map_err(|err| format!("DB error: {}", err))?;
    Ok(connection)
}

/// Append a new outbox row. Returns the assigned `id`.
pub fn append(c: &Connection, entry: &OutboxEntry) -> Result<i64, String> {
    c.execute(
        "INSERT INTO outbox_entries
            (project_slug, entity_type, entity_id, op, field_path,
             payload_json, created_at, retry_count, last_attempted_at,
             last_error, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            entry.project_slug,
            entry.entity_type.as_db_str(),
            entry.entity_id,
            entry.op.as_db_str(),
            entry.field_path,
            entry.payload_json,
            entry.created_at,
            entry.retry_count,
            entry.last_attempted_at,
            entry.last_error,
            entry.status.as_db_str(),
        ],
    )
    .map_err(|err| format!("DB error (insert outbox): {}", err))?;
    Ok(c.last_insert_rowid())
}

/// Record a local user-driven update by appending one `update` outbox
/// row, **only if** the project is currently bound to an adapter
/// (`sync_kind != 'none'`). For unbound projects this is a no-op so
/// the outbox doesn't accumulate dead entries for users who never
/// configured sync.
///
/// `changed_fields` lists the canonical sync-tracked field names that
/// the caller mutated (matching
/// [`crate::sync::adapter::EntityField::as_local_name`]).
/// `payload` is the full JSON object holding each changed field's new
/// value — adapters use this directly when constructing their push
/// payloads, so the outbox row is self-contained and the adapter
/// doesn't need to re-read the work item from the DB.
///
/// `field_path` on the row carries the comma-joined `changed_fields`
/// for observability (`project_sync_status` uses it to surface
/// "changed: title, status" to users) and so adapters that prefer a
/// list-based input can split it back without re-deriving from the
/// payload keys.
pub fn record_local_update(
    project_slug: &str,
    short_id: &str,
    changed_fields: &[&'static str],
    payload: &serde_json::Value,
) -> Result<(), String> {
    if changed_fields.is_empty() {
        return Ok(());
    }
    let connection = conn()?;
    if read_adapter_binding(&connection, project_slug)?.is_none() {
        return Ok(());
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    let entry = OutboxEntry {
        id: None,
        project_slug: project_slug.to_string(),
        entity_type: EntityType::WorkItem,
        entity_id: short_id.to_string(),
        op: OutboxOp::Update,
        field_path: Some(changed_fields.join(",")),
        payload_json: payload.to_string(),
        created_at: now,
        retry_count: 0,
        last_attempted_at: None,
        last_error: None,
        status: OutboxStatus::Pending,
    };
    append(&connection, &entry)?;
    Ok(())
}

/// Atomically claim the next pending row whose retry-eligibility delay
/// has elapsed. Returns `Ok(None)` when the pending pool is empty or
/// every pending row is still backing off.
///
/// The two-step (`SELECT id` then `UPDATE WHERE status='pending'`)
/// would race against another worker; the WHERE clause matches `id` AND
/// `status='pending'` so `UPDATE … RETURNING` wins atomically.
pub fn claim_next_pending(c: &Connection, now_ms: i64) -> Result<Option<OutboxEntry>, String> {
    // Pull-cycle artifacts (`merge_external`) are owned by the
    // resolver; the push path must skip them or they'd be
    // dispatched to adapters that reject them as Permanent and
    // immediately abandon. Filtering at claim time keeps the
    // discrimination in one place rather than scattered across every
    // adapter's push implementation.
    let candidate: Option<i64> = c
        .query_row(
            "SELECT id FROM outbox_entries
             WHERE status = ?1
               AND op != ?3
               AND (last_attempted_at IS NULL OR last_attempted_at <= ?2)
             ORDER BY created_at ASC, id ASC
             LIMIT 1",
            params![
                OutboxStatus::Pending.as_db_str(),
                now_ms,
                crate::sync::types::OutboxOp::MergeExternal.as_db_str(),
            ],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|err| format!("DB error (claim outbox): {}", err))?;

    let Some(id) = candidate else {
        return Ok(None);
    };

    let updated = c
        .execute(
            "UPDATE outbox_entries
                SET status = ?1, last_attempted_at = ?2
              WHERE id = ?3 AND status = ?4",
            params![
                OutboxStatus::InFlight.as_db_str(),
                now_ms,
                id,
                OutboxStatus::Pending.as_db_str()
            ],
        )
        .map_err(|err| format!("DB error (claim update): {}", err))?;

    if updated == 0 {
        // Lost the race to another worker; let the caller retry.
        return Ok(None);
    }

    Ok(Some(load_by_id(c, id)?))
}

/// Atomically claim the next pending `merge_external` row. Mirrors
/// [`claim_next_pending`] but inverted on `op`: only `merge_external`
/// rows are eligible. Used by [`super::worker::merge_cycle`] so the
/// resolver and the push path can drain independent queues without
/// stepping on each other.
pub fn claim_next_merge_external(
    c: &Connection,
    now_ms: i64,
) -> Result<Option<OutboxEntry>, String> {
    let candidate: Option<i64> = c
        .query_row(
            "SELECT id FROM outbox_entries
             WHERE status = ?1
               AND op = ?3
               AND (last_attempted_at IS NULL OR last_attempted_at <= ?2)
             ORDER BY created_at ASC, id ASC
             LIMIT 1",
            params![
                OutboxStatus::Pending.as_db_str(),
                now_ms,
                crate::sync::types::OutboxOp::MergeExternal.as_db_str(),
            ],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|err| format!("DB error (claim merge_external): {}", err))?;

    let Some(id) = candidate else {
        return Ok(None);
    };

    let updated = c
        .execute(
            "UPDATE outbox_entries
                SET status = ?1, last_attempted_at = ?2
              WHERE id = ?3 AND status = ?4",
            params![
                OutboxStatus::InFlight.as_db_str(),
                now_ms,
                id,
                OutboxStatus::Pending.as_db_str()
            ],
        )
        .map_err(|err| format!("DB error (merge claim update): {}", err))?;

    if updated == 0 {
        return Ok(None);
    }

    Ok(Some(load_by_id(c, id)?))
}

/// Mark an in-flight row as succeeded. Idempotent.
pub fn mark_succeeded(c: &Connection, id: i64) -> Result<(), String> {
    c.execute(
        "UPDATE outbox_entries
            SET status = ?1, last_error = NULL
          WHERE id = ?2",
        params![OutboxStatus::Succeeded.as_db_str(), id],
    )
    .map_err(|err| format!("DB error (mark succeeded): {}", err))?;
    Ok(())
}

/// Mark a row as failed. Bumps `retry_count`, schedules the next
/// attempt via `RETRY_BACKOFF_SECS`, and transitions to `Abandoned`
/// once the budget is exhausted.
///
/// `now_ms` is the current wall clock (passed in for testability).
///
/// `force_abandon` short-circuits the backoff schedule for errors the
/// adapter classified as `Permanent` / `AuthFailed`: the row jumps
/// straight to `Abandoned` so the user retries explicitly via
/// `project_sync_force_push` after fixing the underlying issue.
pub fn mark_failed_with_backoff(
    c: &Connection,
    id: i64,
    now_ms: i64,
    error_message: &str,
    force_abandon: bool,
) -> Result<OutboxStatus, String> {
    let current_retry: u32 = c
        .query_row(
            "SELECT retry_count FROM outbox_entries WHERE id = ?1",
            [id],
            |row| row.get::<_, u32>(0),
        )
        .map_err(|err| format!("DB error (load retry_count): {}", err))?;

    let next_retry = current_retry.saturating_add(1);
    let new_status = if force_abandon || next_retry >= MAX_RETRY_COUNT {
        OutboxStatus::Abandoned
    } else {
        OutboxStatus::Pending
    };

    let next_attempt_after = if matches!(new_status, OutboxStatus::Pending) {
        let idx = (next_retry as usize).saturating_sub(1);
        let secs = RETRY_BACKOFF_SECS
            .get(idx)
            .copied()
            .unwrap_or_else(|| RETRY_BACKOFF_SECS[RETRY_BACKOFF_SECS.len() - 1]);
        Some(now_ms.saturating_add((secs as i64).saturating_mul(1000)))
    } else {
        None
    };

    c.execute(
        "UPDATE outbox_entries
            SET status = ?1,
                retry_count = ?2,
                last_attempted_at = ?3,
                last_error = ?4
          WHERE id = ?5",
        params![
            new_status.as_db_str(),
            next_retry,
            next_attempt_after,
            error_message,
            id,
        ],
    )
    .map_err(|err| format!("DB error (mark failed): {}", err))?;

    Ok(new_status)
}

/// Demote every `in_flight` row back to `pending`. Called once at boot
/// from `worker::start_worker` to recover from a crash mid-push.
///
/// `last_attempted_at` is cleared so the row is immediately claimable
/// on the next push tick rather than respecting whatever stale backoff
/// stamp the previous process left behind.
pub fn reset_in_flight_to_pending(c: &Connection) -> Result<usize, String> {
    let updated = c
        .execute(
            "UPDATE outbox_entries
                SET status = ?1,
                    last_attempted_at = NULL
              WHERE status = ?2",
            params![
                OutboxStatus::Pending.as_db_str(),
                OutboxStatus::InFlight.as_db_str()
            ],
        )
        .map_err(|err| format!("DB error (reset in-flight): {}", err))?;
    Ok(updated)
}

/// Garbage-collect succeeded outbox rows older than `older_than_ms`.
/// Returns the number of rows actually deleted (capped at `limit`).
///
/// The worker runs this once per push cycle so the table
/// doesn't grow unboundedly. We retain succeeded rows for an audit
/// window (default 7 days) so a user investigating "why didn't this
/// edit reach Linear?" can still see the row's history. After the
/// window, the row is no longer useful — the adapter's external state
/// is now the source of truth and the local watermark in
/// `field_revisions` is enough to drive subsequent merges.
///
/// We bound `limit` per call so a long-stalled GC sweep can't block
/// the push cycle's actual work; the next tick picks up where this
/// one left off.
pub fn gc_succeeded(
    c: &Connection,
    now_ms: i64,
    older_than_ms: i64,
    limit: usize,
) -> Result<usize, String> {
    let cutoff = now_ms.saturating_sub(older_than_ms);
    let deleted = c
        .execute(
            "DELETE FROM outbox_entries
              WHERE id IN (
                  SELECT id FROM outbox_entries
                   WHERE status = ?1
                     AND created_at <= ?2
                   ORDER BY created_at ASC
                   LIMIT ?3
              )",
            params![OutboxStatus::Succeeded.as_db_str(), cutoff, limit as i64],
        )
        .map_err(|err| format!("DB error (gc succeeded): {}", err))?;
    Ok(deleted)
}

/// Force-requeue every `failed` and `abandoned` row for one project so
/// the user can manually retry through `project_sync_force_push`.
///
/// Resets `last_attempted_at` to `NULL` so the row is immediately
/// claimable on the next worker tick.
pub fn requeue_for_project(c: &Connection, project_slug: &str) -> Result<u64, String> {
    let updated = c
        .execute(
            "UPDATE outbox_entries
                SET status = ?1,
                    last_attempted_at = NULL
              WHERE project_slug = ?2
                AND status IN (?3, ?4)",
            params![
                OutboxStatus::Pending.as_db_str(),
                project_slug,
                OutboxStatus::Failed.as_db_str(),
                OutboxStatus::Abandoned.as_db_str()
            ],
        )
        .map_err(|err| format!("DB error (requeue): {}", err))?;
    Ok(updated as u64)
}

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

/// Bind a project to an adapter. Stored on the `projects` row so the
/// worker can resolve the adapter on the next push tick.
///
/// `adapter_id` MUST exist in `super::adapters::registry()`; callers
/// validate before calling.
pub fn attach_adapter(
    c: &Connection,
    project_slug: &str,
    adapter_id: &str,
    config_json: &str,
    connection_id: &str,
) -> Result<(), String> {
    let n = c
        .execute(
            "UPDATE projects
                SET sync_kind = ?1,
                    sync_config_json = ?2,
                    sync_connection_id = ?3
              WHERE slug = ?4",
            params![adapter_id, config_json, connection_id, project_slug],
        )
        .map_err(|err| format!("DB error (attach adapter): {}", err))?;
    if n == 0 {
        return Err(format!("project not found: {}", project_slug));
    }
    Ok(())
}

/// Unbind a project from any adapter; resets the sync_kind to `none`.
pub fn detach_adapter(c: &Connection, project_slug: &str) -> Result<(), String> {
    let n = c
        .execute(
            "UPDATE projects
                SET sync_kind = 'none',
                    sync_config_json = NULL,
                    sync_connection_id = NULL
              WHERE slug = ?1",
            params![project_slug],
        )
        .map_err(|err| format!("DB error (detach adapter): {}", err))?;
    if n == 0 {
        return Err(format!("project not found: {}", project_slug));
    }
    Ok(())
}

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

/// Persist the cursor + last-pull stamp after a successful pull cycle.
/// Atomic: both columns are updated in one statement so a partial write
/// can't leave the cursor newer than its stamp.
pub fn write_sync_cursor(
    c: &Connection,
    project_slug: &str,
    cursor: &SyncCursor,
) -> Result<(), String> {
    let updated = c
        .execute(
            "UPDATE projects
                SET sync_last_pull_at = ?1,
                    sync_cursor_blob = ?2
              WHERE slug = ?3",
            params![cursor.last_pull_at, cursor.cursor_blob, project_slug],
        )
        .map_err(|err| format!("DB error (write sync cursor): {}", err))?;
    if updated == 0 {
        return Err(format!("project not found: {}", project_slug));
    }
    Ok(())
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
    /// [`super::adapter::SyncContext::config_json`].
    pub config_json: Option<String>,
    /// Global project-sync connection account selected by the project.
    pub connection_id: String,
    /// Wall-clock millis of the most recent successful webhook
    /// delivery for this project (across **any** adapter). Used
    /// to skip a poll cycle when a webhook landed inside the
    /// freshness window — see [`super::worker::pull_cycle`].
    /// `None` when the project has never received a webhook.
    pub last_webhook_at: Option<i64>,
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

/// Read the project's most recent webhook delivery timestamp
/// (`projects.sync_last_webhook_at`). Returns `None` when the
/// project has never received a webhook. Errors when the slug
/// doesn't resolve.
///
/// Used by [`super::commands`] to expose the freshness signal to
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

/// Requeue exactly one row by id. Flips status to `pending`, clears
/// `last_attempted_at` so the next push tick claims it immediately,
/// and clears `last_error` so the UI no longer surfaces the stale
/// failure. `retry_count` is intentionally **not** reset — it remains
/// the cumulative attempt counter for the row's lifetime so the
/// backoff schedule on the next genuine failure picks up where the
/// previous attempt left off.
///
/// Returns the `project_slug` of the touched row so the caller can
/// emit a `SyncStatusEvent` for the right project without a separate
/// SELECT round-trip. Returns an error when no row matched the id.
pub fn requeue_one(c: &Connection, entry_id: i64) -> Result<String, String> {
    let project_slug: String = c
        .query_row(
            "SELECT project_slug FROM outbox_entries WHERE id = ?1",
            [entry_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|err| format!("DB error (load slug for requeue): {}", err))?
        .ok_or_else(|| format!("outbox row not found: id={}", entry_id))?;

    let updated = c
        .execute(
            "UPDATE outbox_entries
                SET status = ?1,
                    last_attempted_at = NULL,
                    last_error = NULL
              WHERE id = ?2",
            params![OutboxStatus::Pending.as_db_str(), entry_id],
        )
        .map_err(|err| format!("DB error (requeue_one): {}", err))?;
    if updated == 0 {
        return Err(format!("outbox row vanished mid-requeue: id={}", entry_id));
    }
    Ok(project_slug)
}

/// Hard-delete one outbox row by id. Returns the `project_slug` of
/// the deleted row (or an error when no row matched) so the caller
/// can emit a `SyncStatusEvent` after the delete commits.
///
/// **Why DELETE and not status='abandoned'?** `requeue_for_project`
/// (used by `project_sync_force_push`) re-queues both `Failed` and
/// `Abandoned` rows, so transitioning to `Abandoned` here would let
/// the next bulk force-push immediately un-discard everything the
/// user just discarded. Hard-delete is the only semantics that
/// honors the user's intent across both retry paths.
///
/// Idempotency: a second `discard_one` on the same id returns an
/// "outbox row not found" error rather than silently succeeding —
/// the UI is expected to remove the row from its local list on the
/// first success and never call again, so the second call is always
/// a bug worth surfacing.
pub fn discard_one(c: &Connection, entry_id: i64) -> Result<String, String> {
    let project_slug: String = c
        .query_row(
            "SELECT project_slug FROM outbox_entries WHERE id = ?1",
            [entry_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|err| format!("DB error (load slug for discard): {}", err))?
        .ok_or_else(|| format!("outbox row not found: id={}", entry_id))?;

    let deleted = c
        .execute("DELETE FROM outbox_entries WHERE id = ?1", [entry_id])
        .map_err(|err| format!("DB error (discard_one): {}", err))?;
    if deleted == 0 {
        return Err(format!("outbox row vanished mid-discard: id={}", entry_id));
    }
    Ok(project_slug)
}

fn row_to_problem(row: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxProblemRow> {
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

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxEntry> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::schema::init_outbox_table;

    fn open_test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory");
        init_outbox_table(&conn).expect("init outbox");
        conn
    }

    fn sample_entry(slug: &str, entity_id: &str, created_at: i64) -> OutboxEntry {
        OutboxEntry {
            id: None,
            project_slug: slug.to_string(),
            entity_type: EntityType::WorkItem,
            entity_id: entity_id.to_string(),
            op: OutboxOp::Update,
            field_path: Some("title".to_string()),
            payload_json: r#"{"title":"new"}"#.to_string(),
            created_at,
            retry_count: 0,
            last_attempted_at: None,
            last_error: None,
            status: OutboxStatus::Pending,
        }
    }

    #[test]
    fn append_then_load_roundtrip() {
        let c = open_test_db();
        let entry = sample_entry("alpha", "WI-1", 1_000);
        let id = append(&c, &entry).expect("append");
        let loaded = load_by_id(&c, id).expect("load");
        assert_eq!(loaded.project_slug, "alpha");
        assert_eq!(loaded.entity_id, "WI-1");
        assert_eq!(loaded.entity_type, EntityType::WorkItem);
        assert_eq!(loaded.op, OutboxOp::Update);
        assert_eq!(loaded.status, OutboxStatus::Pending);
        assert_eq!(loaded.payload_json, r#"{"title":"new"}"#);
    }

    #[test]
    fn claim_picks_oldest_pending() {
        let c = open_test_db();
        let _id_b = append(&c, &sample_entry("alpha", "WI-2", 2_000)).unwrap();
        let id_a = append(&c, &sample_entry("alpha", "WI-1", 1_000)).unwrap();

        let claimed = claim_next_pending(&c, 5_000)
            .expect("claim ok")
            .expect("some entry");
        assert_eq!(claimed.id, Some(id_a), "should claim oldest first");
        assert_eq!(claimed.status, OutboxStatus::InFlight);
    }

    #[test]
    fn claim_skips_backed_off_rows() {
        let c = open_test_db();
        let id = append(&c, &sample_entry("alpha", "WI-1", 1_000)).unwrap();
        // Manually park the row in the future.
        c.execute(
            "UPDATE outbox_entries SET last_attempted_at = ?1 WHERE id = ?2",
            params![10_000_i64, id],
        )
        .unwrap();
        // `now_ms` is 5000 — the row's eligibility window is still in the future.
        assert!(claim_next_pending(&c, 5_000).unwrap().is_none());
        // Cross the threshold.
        assert!(claim_next_pending(&c, 11_000).unwrap().is_some());
    }

    #[test]
    fn claim_returns_none_on_empty() {
        let c = open_test_db();
        assert!(claim_next_pending(&c, 0).unwrap().is_none());
    }

    /// `merge_external` rows are pull-cycle artifacts owned by the
    /// resolver — the push path must never claim them or they'd be
    /// dispatched to adapters that reject them and abandon the row.
    #[test]
    fn claim_skips_merge_external_rows() {
        let c = open_test_db();
        let mut merge_row = sample_entry("alpha", "WI-1", 1_000);
        merge_row.op = OutboxOp::MergeExternal;
        let merge_id = append(&c, &merge_row).unwrap();

        // No update row → claim should return None despite the
        // merge_external row sitting in pending.
        assert!(
            claim_next_pending(&c, 5_000).unwrap().is_none(),
            "merge_external must not be claimed by the push path"
        );

        // Add a real update row that's newer than the merge row;
        // claim should still pick the update because the merge row
        // is invisible to it.
        let update_id = append(&c, &sample_entry("alpha", "WI-2", 2_000)).unwrap();
        let claimed = claim_next_pending(&c, 5_000).unwrap().unwrap();
        assert_eq!(claimed.id, Some(update_id));
        // Verify the merge row is still pending and untouched.
        let merge_loaded = load_by_id(&c, merge_id).unwrap();
        assert_eq!(merge_loaded.status, OutboxStatus::Pending);
    }

    /// Mirror of [`claim_skips_merge_external_rows`] for the merge
    /// queue: `claim_next_merge_external` only sees `merge_external`
    /// rows and ignores everything else. The two queues are inverses
    /// over the same table.
    #[test]
    fn merge_claim_only_picks_merge_external_rows() {
        let c = open_test_db();
        let update_id = append(&c, &sample_entry("alpha", "WI-1", 1_000)).unwrap();
        let mut merge_row = sample_entry("alpha", "WI-2", 2_000);
        merge_row.op = OutboxOp::MergeExternal;
        let merge_id = append(&c, &merge_row).unwrap();

        let claimed = claim_next_merge_external(&c, 5_000)
            .unwrap()
            .expect("merge claim picks the merge row");
        assert_eq!(claimed.id, Some(merge_id));
        // The update row must remain pending.
        let update_loaded = load_by_id(&c, update_id).unwrap();
        assert_eq!(update_loaded.status, OutboxStatus::Pending);
    }

    #[test]
    fn merge_claim_returns_none_when_only_update_rows_exist() {
        let c = open_test_db();
        append(&c, &sample_entry("alpha", "WI-1", 1_000)).unwrap();
        assert!(claim_next_merge_external(&c, 5_000).unwrap().is_none());
    }

    #[test]
    fn gc_succeeded_deletes_only_old_succeeded_rows() {
        let c = open_test_db();
        // Two old succeeded rows.
        let mut old1 = sample_entry("alpha", "WI-1", 1_000);
        old1.status = OutboxStatus::Succeeded;
        let id1 = append(&c, &old1).unwrap();
        c.execute(
            "UPDATE outbox_entries SET status = 'succeeded' WHERE id = ?1",
            params![id1],
        )
        .unwrap();
        let mut old2 = sample_entry("alpha", "WI-2", 2_000);
        old2.status = OutboxStatus::Succeeded;
        let id2 = append(&c, &old2).unwrap();
        c.execute(
            "UPDATE outbox_entries SET status = 'succeeded' WHERE id = ?1",
            params![id2],
        )
        .unwrap();
        // One young succeeded row.
        let young_id = append(&c, &sample_entry("alpha", "WI-3", 100_000)).unwrap();
        c.execute(
            "UPDATE outbox_entries SET status = 'succeeded' WHERE id = ?1",
            params![young_id],
        )
        .unwrap();
        // One old failed row — must not be GC'd.
        let mut old_failed = sample_entry("alpha", "WI-4", 1_000);
        old_failed.status = OutboxStatus::Failed;
        let failed_id = append(&c, &old_failed).unwrap();
        c.execute(
            "UPDATE outbox_entries SET status = 'failed' WHERE id = ?1",
            params![failed_id],
        )
        .unwrap();

        // Cutoff: now=50_000, retention=10_000 → cutoff=40_000.
        // The two `1_000`/`2_000` succeeded rows should go;
        // young (100_000) and failed (status filter) stay.
        let deleted = gc_succeeded(&c, 50_000, 10_000, 100).unwrap();
        assert_eq!(deleted, 2);
        assert!(load_by_id(&c, id1).is_err());
        assert!(load_by_id(&c, id2).is_err());
        assert!(load_by_id(&c, young_id).is_ok());
        assert!(load_by_id(&c, failed_id).is_ok());
    }

    #[test]
    fn gc_succeeded_respects_limit() {
        let c = open_test_db();
        for i in 0..5 {
            let id = append(&c, &sample_entry("alpha", &format!("WI-{}", i), 1_000)).unwrap();
            c.execute(
                "UPDATE outbox_entries SET status = 'succeeded' WHERE id = ?1",
                params![id],
            )
            .unwrap();
        }
        let deleted = gc_succeeded(&c, 50_000, 10_000, 2).unwrap();
        assert_eq!(deleted, 2);
        // 3 succeeded rows still present.
        let remaining: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM outbox_entries WHERE status = 'succeeded'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 3);
    }

    #[test]
    fn mark_succeeded_clears_error() {
        let c = open_test_db();
        let id = append(&c, &sample_entry("alpha", "WI-1", 1_000)).unwrap();
        mark_failed_with_backoff(&c, id, 100, "boom", false).unwrap();
        // Re-claim and succeed.
        let _ = c.execute(
            "UPDATE outbox_entries SET last_attempted_at = NULL WHERE id = ?1",
            [id],
        );
        let claimed = claim_next_pending(&c, 1_000_000).unwrap().unwrap();
        mark_succeeded(&c, claimed.id.unwrap()).unwrap();
        let loaded = load_by_id(&c, id).unwrap();
        assert_eq!(loaded.status, OutboxStatus::Succeeded);
        assert!(loaded.last_error.is_none());
    }

    #[test]
    fn mark_failed_walks_backoff_schedule() {
        let c = open_test_db();
        let id = append(&c, &sample_entry("alpha", "WI-1", 0)).unwrap();

        // Retry 1 → Pending, scheduled +30s.
        let s1 = mark_failed_with_backoff(&c, id, 1_000, "err1", false).unwrap();
        assert_eq!(s1, OutboxStatus::Pending);
        let r1 = load_by_id(&c, id).unwrap();
        assert_eq!(r1.retry_count, 1);
        assert_eq!(r1.last_attempted_at, Some(1_000 + 30 * 1000));

        // Retry 2 → Pending, scheduled +120s.
        let s2 = mark_failed_with_backoff(&c, id, 2_000, "err2", false).unwrap();
        assert_eq!(s2, OutboxStatus::Pending);
        let r2 = load_by_id(&c, id).unwrap();
        assert_eq!(r2.retry_count, 2);
        assert_eq!(r2.last_attempted_at, Some(2_000 + 120 * 1000));

        // Retries 3 and 4 → Pending.
        mark_failed_with_backoff(&c, id, 3_000, "err3", false).unwrap();
        let s4 = mark_failed_with_backoff(&c, id, 4_000, "err4", false).unwrap();
        assert_eq!(s4, OutboxStatus::Pending);
        assert_eq!(load_by_id(&c, id).unwrap().retry_count, 4);

        // Retry 5 → Abandoned.
        let s5 = mark_failed_with_backoff(&c, id, 5_000, "err5", false).unwrap();
        assert_eq!(s5, OutboxStatus::Abandoned);
        let r5 = load_by_id(&c, id).unwrap();
        assert_eq!(r5.retry_count, 5);
        assert_eq!(r5.status, OutboxStatus::Abandoned);
        assert_eq!(r5.last_error.as_deref(), Some("err5"));
    }

    #[test]
    fn force_abandon_skips_backoff_schedule() {
        let c = open_test_db();
        let id = append(&c, &sample_entry("alpha", "WI-1", 0)).unwrap();

        // First attempt with force_abandon=true must jump straight to
        // Abandoned with retry_count=1, regardless of backoff schedule.
        let status = mark_failed_with_backoff(&c, id, 1_000, "auth bad", true).unwrap();
        assert_eq!(status, OutboxStatus::Abandoned);
        let row = load_by_id(&c, id).unwrap();
        assert_eq!(row.status, OutboxStatus::Abandoned);
        assert_eq!(row.retry_count, 1);
        assert_eq!(row.last_attempted_at, None, "abandoned rows clear backoff");
        assert_eq!(row.last_error.as_deref(), Some("auth bad"));
    }

    #[test]
    fn reset_in_flight_to_pending_clears_last_attempted_at() {
        let c = open_test_db();
        let id_a = append(&c, &sample_entry("alpha", "WI-1", 0)).unwrap();
        let id_b = append(&c, &sample_entry("alpha", "WI-2", 0)).unwrap();
        let id_c = append(&c, &sample_entry("beta", "WI-3", 0)).unwrap();

        // Park id_a + id_b in `in_flight` with a stale last_attempted_at.
        c.execute(
            "UPDATE outbox_entries SET status = 'in_flight', last_attempted_at = 999 WHERE id IN (?1, ?2)",
            params![id_a, id_b],
        )
        .unwrap();
        // id_c stays pending — sweep must not touch it.
        let id_c_before = load_by_id(&c, id_c).unwrap();
        assert_eq!(id_c_before.status, OutboxStatus::Pending);

        let recovered = reset_in_flight_to_pending(&c).unwrap();
        assert_eq!(recovered, 2);

        let row_a = load_by_id(&c, id_a).unwrap();
        assert_eq!(row_a.status, OutboxStatus::Pending);
        assert_eq!(row_a.last_attempted_at, None);
        let row_b = load_by_id(&c, id_b).unwrap();
        assert_eq!(row_b.status, OutboxStatus::Pending);
        assert_eq!(row_b.last_attempted_at, None);
        // Untouched rows remain claimable as before.
        let row_c = load_by_id(&c, id_c).unwrap();
        assert_eq!(row_c.status, OutboxStatus::Pending);
    }

    #[test]
    fn requeue_resurrects_failed_and_abandoned() {
        let c = open_test_db();
        let id_a = append(&c, &sample_entry("alpha", "WI-1", 0)).unwrap();
        let id_b = append(&c, &sample_entry("alpha", "WI-2", 0)).unwrap();
        let id_c = append(&c, &sample_entry("beta", "WI-3", 0)).unwrap();

        // Force statuses.
        c.execute(
            "UPDATE outbox_entries SET status = 'failed' WHERE id = ?1",
            [id_a],
        )
        .unwrap();
        c.execute(
            "UPDATE outbox_entries SET status = 'abandoned' WHERE id = ?1",
            [id_b],
        )
        .unwrap();
        c.execute(
            "UPDATE outbox_entries SET status = 'failed' WHERE id = ?1",
            [id_c],
        )
        .unwrap();

        let n = requeue_for_project(&c, "alpha").unwrap();
        assert_eq!(n, 2);

        assert_eq!(load_by_id(&c, id_a).unwrap().status, OutboxStatus::Pending);
        assert_eq!(load_by_id(&c, id_b).unwrap().status, OutboxStatus::Pending);
        // Other project untouched.
        assert_eq!(load_by_id(&c, id_c).unwrap().status, OutboxStatus::Failed);
    }

    #[test]
    fn count_by_status_filters_per_project() {
        let c = open_test_db();
        let _id_a = append(&c, &sample_entry("alpha", "WI-1", 0)).unwrap();
        let _id_b = append(&c, &sample_entry("alpha", "WI-2", 0)).unwrap();
        let _id_c = append(&c, &sample_entry("beta", "WI-3", 0)).unwrap();

        assert_eq!(
            count_by_status(&c, "alpha", OutboxStatus::Pending).unwrap(),
            2
        );
        assert_eq!(
            count_by_status(&c, "beta", OutboxStatus::Pending).unwrap(),
            1
        );
        assert_eq!(
            count_by_status(&c, "alpha", OutboxStatus::Succeeded).unwrap(),
            0
        );
    }

    #[test]
    fn list_for_project_orders_newest_first() {
        let c = open_test_db();
        let _ = append(&c, &sample_entry("alpha", "WI-1", 1_000)).unwrap();
        let _ = append(&c, &sample_entry("alpha", "WI-2", 3_000)).unwrap();
        let _ = append(&c, &sample_entry("alpha", "WI-3", 2_000)).unwrap();

        let rows = list_for_project(&c, "alpha").unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].entity_id, "WI-2");
        assert_eq!(rows[1].entity_id, "WI-3");
        assert_eq!(rows[2].entity_id, "WI-1");
    }

    #[test]
    fn attach_then_read_binding_roundtrip() {
        // Need the full project schema for the `projects` row.
        let conn = Connection::open_in_memory().expect("open mem");
        crate::projects::schema::init_project_tables(&conn).expect("init");

        conn.execute(
            "INSERT INTO projects (id, name, slug, short_id_prefix, created_at, updated_at)
             VALUES ('p1', 'P1', 'alpha', 'AAA', 0, 0)",
            [],
        )
        .unwrap();

        attach_adapter(&conn, "alpha", "echo", r#"{"k":"v"}"#, "connection-alpha").expect("attach");
        let binding = read_adapter_binding(&conn, "alpha").expect("read");
        assert_eq!(
            binding.as_ref().map(|binding| binding.adapter_id.as_str()),
            Some("echo")
        );
        assert_eq!(
            binding
                .as_ref()
                .and_then(|binding| binding.config_json.as_deref()),
            Some(r#"{"k":"v"}"#)
        );
        assert_eq!(
            binding
                .as_ref()
                .map(|binding| binding.connection_id.as_str()),
            Some("connection-alpha")
        );

        detach_adapter(&conn, "alpha").expect("detach");
        assert!(read_adapter_binding(&conn, "alpha").unwrap().is_none());
    }

    #[test]
    fn read_binding_unknown_project_errors() {
        let conn = Connection::open_in_memory().expect("open mem");
        crate::projects::schema::init_project_tables(&conn).expect("init");
        assert!(read_adapter_binding(&conn, "nope").is_err());
    }

    #[test]
    fn last_error_for_project_picks_most_recent() {
        let c = open_test_db();
        let id_a = append(&c, &sample_entry("alpha", "WI-1", 0)).unwrap();
        let id_b = append(&c, &sample_entry("alpha", "WI-2", 0)).unwrap();
        c.execute(
            "UPDATE outbox_entries SET last_attempted_at = ?1, last_error = ?2 WHERE id = ?3",
            params![100_i64, "old error", id_a],
        )
        .unwrap();
        c.execute(
            "UPDATE outbox_entries SET last_attempted_at = ?1, last_error = ?2 WHERE id = ?3",
            params![200_i64, "fresh error", id_b],
        )
        .unwrap();

        let err = last_error_for_project(&c, "alpha").unwrap();
        assert_eq!(err.as_deref(), Some("fresh error"));
    }

    #[test]
    fn sync_cursor_roundtrip() {
        let conn = Connection::open_in_memory().expect("open mem");
        crate::projects::schema::init_project_tables(&conn).expect("init");
        conn.execute(
            "INSERT INTO projects (id, name, slug, short_id_prefix, created_at, updated_at)
             VALUES ('p1', 'P1', 'alpha', 'AAA', 0, 0)",
            [],
        )
        .unwrap();

        // Default state — both fields NULL.
        let cursor = read_sync_cursor(&conn, "alpha").unwrap();
        assert!(cursor.last_pull_at.is_none());
        assert!(cursor.cursor_blob.is_none());

        // Roundtrip a populated cursor.
        let updated = SyncCursor {
            last_pull_at: Some(123_456),
            cursor_blob: Some("opaque:abc".to_string()),
        };
        write_sync_cursor(&conn, "alpha", &updated).unwrap();
        let read_back = read_sync_cursor(&conn, "alpha").unwrap();
        assert_eq!(read_back, updated);

        // Clearing both fields should be representable.
        write_sync_cursor(&conn, "alpha", &SyncCursor::default()).unwrap();
        assert_eq!(
            read_sync_cursor(&conn, "alpha").unwrap(),
            SyncCursor::default()
        );
    }

    #[test]
    fn list_bound_projects_filters_and_orders() {
        let conn = Connection::open_in_memory().expect("open mem");
        crate::projects::schema::init_project_tables(&conn).expect("init");
        for (id, slug, kind) in [
            ("p1", "charlie", "linear"),
            ("p2", "alpha", "echo"),
            ("p3", "beta", "none"),
            ("p4", "delta", "linear"),
        ] {
            let connection_id = (kind != "none").then(|| format!("connection-{slug}"));
            conn.execute(
                "INSERT INTO projects (id, name, slug, short_id_prefix, created_at, updated_at, sync_kind, sync_connection_id)
                 VALUES (?1, ?1, ?2, 'XXX', 0, 0, ?3, ?4)",
                params![id, slug, kind, connection_id],
            )
            .unwrap();
        }
        let bindings = list_bound_projects(&conn).unwrap();
        let pairs: Vec<(&str, &str)> = bindings
            .iter()
            .map(|b| (b.project_slug.as_str(), b.adapter_id.as_str()))
            .collect();
        assert_eq!(
            pairs,
            vec![
                ("alpha", "echo"),
                ("charlie", "linear"),
                ("delta", "linear")
            ]
        );
        assert!(
            bindings.iter().all(|b| b.config_json.is_none()),
            "no test row supplied a config"
        );
    }

    #[test]
    fn list_bound_projects_carries_config_json() {
        let conn = Connection::open_in_memory().expect("open mem");
        crate::projects::schema::init_project_tables(&conn).expect("init");
        conn.execute(
            "INSERT INTO projects
                (id, name, slug, short_id_prefix, created_at, updated_at,
                 sync_kind, sync_config_json, sync_connection_id)
             VALUES ('p1', 'p1', 'gh', 'XXX', 0, 0,
                     'github_issues', '{\"owner\":\"o\",\"repo\":\"r\"}', 'connection-gh')",
            [],
        )
        .unwrap();
        let bindings = list_bound_projects(&conn).unwrap();
        assert_eq!(bindings.len(), 1);
        assert_eq!(
            bindings[0].config_json.as_deref(),
            Some("{\"owner\":\"o\",\"repo\":\"r\"}")
        );
    }

    #[test]
    fn sync_cursor_unknown_project_errors() {
        let conn = Connection::open_in_memory().expect("open mem");
        crate::projects::schema::init_project_tables(&conn).expect("init");
        assert!(read_sync_cursor(&conn, "ghost").is_err());
        assert!(write_sync_cursor(&conn, "ghost", &SyncCursor::default()).is_err());
    }

    #[test]
    fn last_error_returns_none_when_no_errors() {
        let c = open_test_db();
        let _ = append(&c, &sample_entry("alpha", "WI-1", 0)).unwrap();
        assert!(last_error_for_project(&c, "alpha").unwrap().is_none());
    }

    // ---------------------------------------------------------------
    // list_problems / requeue_one / discard_one
    // ---------------------------------------------------------------

    /// Force a row's status + (optional) last_attempted_at directly so
    /// tests can build whatever lifecycle state they want without
    /// going through the worker.
    fn force_row(c: &Connection, id: i64, status: OutboxStatus, last_attempted_at: Option<i64>) {
        c.execute(
            "UPDATE outbox_entries
                SET status = ?1, last_attempted_at = ?2
              WHERE id = ?3",
            params![status.as_db_str(), last_attempted_at, id],
        )
        .unwrap();
    }

    #[test]
    fn list_problems_returns_only_failed_and_abandoned() {
        let c = open_test_db();
        let id_pending = append(&c, &sample_entry("alpha", "WI-1", 1_000)).unwrap();
        let id_failed = append(&c, &sample_entry("alpha", "WI-2", 2_000)).unwrap();
        let id_abandoned = append(&c, &sample_entry("alpha", "WI-3", 3_000)).unwrap();
        let id_in_flight = append(&c, &sample_entry("alpha", "WI-4", 4_000)).unwrap();
        let id_succeeded = append(&c, &sample_entry("alpha", "WI-5", 5_000)).unwrap();

        force_row(&c, id_failed, OutboxStatus::Failed, Some(200_000));
        force_row(&c, id_abandoned, OutboxStatus::Abandoned, Some(100_000));
        force_row(&c, id_in_flight, OutboxStatus::InFlight, Some(150_000));
        force_row(&c, id_succeeded, OutboxStatus::Succeeded, Some(50_000));

        let rows = list_problems(&c, "alpha").unwrap();
        let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
        // Expected order: failed (last_attempted=200_000) before
        // abandoned (last_attempted=100_000); pending/in_flight/succeeded
        // are excluded.
        assert_eq!(ids, vec![id_failed, id_abandoned]);
        assert!(rows
            .iter()
            .all(|r| matches!(r.status, OutboxStatus::Failed | OutboxStatus::Abandoned)));
        // Sanity-check that the wire row carries every expected field.
        let first = &rows[0];
        assert_eq!(first.entity_id, "WI-2");
        assert_eq!(first.op, OutboxOp::Update);
        assert_eq!(first.entity_type, EntityType::WorkItem);
        assert_eq!(first.field_path.as_deref(), Some("title"));
        assert_eq!(first.payload_json, r#"{"title":"new"}"#);
        assert_eq!(first.last_attempted_at, Some(200_000));

        // Pending/in-flight/succeeded should still be queryable through
        // `load_by_id` — list_problems is read-only.
        assert!(load_by_id(&c, id_pending).is_ok());
        assert!(load_by_id(&c, id_in_flight).is_ok());
        assert!(load_by_id(&c, id_succeeded).is_ok());
    }

    #[test]
    fn list_problems_orders_null_last_attempted_after_dated() {
        let c = open_test_db();
        let id_no_attempt = append(&c, &sample_entry("alpha", "WI-1", 1_000)).unwrap();
        let id_old_attempt = append(&c, &sample_entry("alpha", "WI-2", 2_000)).unwrap();
        let id_recent_attempt = append(&c, &sample_entry("alpha", "WI-3", 3_000)).unwrap();

        // Both NULL last_attempted_at and Failed status — possible after a
        // crash where reset_in_flight_to_pending didn't run before the row
        // was force-failed via a manual flow.
        force_row(&c, id_no_attempt, OutboxStatus::Failed, None);
        force_row(&c, id_old_attempt, OutboxStatus::Failed, Some(100));
        force_row(&c, id_recent_attempt, OutboxStatus::Abandoned, Some(500));

        let rows = list_problems(&c, "alpha").unwrap();
        let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();
        // Recent-attempt first, then old-attempt, then null-attempt.
        assert_eq!(ids, vec![id_recent_attempt, id_old_attempt, id_no_attempt]);
    }

    #[test]
    fn list_problems_scopes_to_project_slug() {
        let c = open_test_db();
        let id_a = append(&c, &sample_entry("alpha", "WI-1", 1_000)).unwrap();
        let id_b = append(&c, &sample_entry("beta", "WI-2", 1_000)).unwrap();
        force_row(&c, id_a, OutboxStatus::Failed, Some(100));
        force_row(&c, id_b, OutboxStatus::Failed, Some(200));

        let alpha_rows = list_problems(&c, "alpha").unwrap();
        assert_eq!(alpha_rows.len(), 1);
        assert_eq!(alpha_rows[0].id, id_a);
        let beta_rows = list_problems(&c, "beta").unwrap();
        assert_eq!(beta_rows.len(), 1);
        assert_eq!(beta_rows[0].id, id_b);
    }

    #[test]
    fn requeue_one_flips_failed_to_pending_and_clears_error() {
        let c = open_test_db();
        let id = append(&c, &sample_entry("alpha", "WI-1", 0)).unwrap();
        // Walk the row through the failure path so retry_count > 0 and
        // last_error is populated.
        mark_failed_with_backoff(&c, id, 1_000, "boom", false).unwrap();
        let before = load_by_id(&c, id).unwrap();
        assert_eq!(before.status, OutboxStatus::Pending); // backoff Pending
                                                          // Force it terminal so requeue_one has something to do.
        force_row(&c, id, OutboxStatus::Failed, Some(1_000));
        c.execute(
            "UPDATE outbox_entries SET last_error = ?1, retry_count = ?2 WHERE id = ?3",
            params!["boom", 2_u32, id],
        )
        .unwrap();

        let slug = requeue_one(&c, id).unwrap();
        assert_eq!(slug, "alpha");

        let after = load_by_id(&c, id).unwrap();
        assert_eq!(after.status, OutboxStatus::Pending);
        assert!(after.last_error.is_none());
        assert_eq!(after.last_attempted_at, None);
        // retry_count must NOT be reset — backoff continuity matters.
        assert_eq!(after.retry_count, 2);
    }

    #[test]
    fn requeue_one_unknown_id_errors() {
        let c = open_test_db();
        let err = requeue_one(&c, 9_999).unwrap_err();
        assert!(err.contains("not found"), "got {}", err);
    }

    #[test]
    fn discard_one_removes_row_so_it_no_longer_appears_in_problems() {
        let c = open_test_db();
        let id = append(&c, &sample_entry("alpha", "WI-1", 0)).unwrap();
        force_row(&c, id, OutboxStatus::Abandoned, Some(100));

        // Sanity: row is initially in the problems list.
        let before = list_problems(&c, "alpha").unwrap();
        assert_eq!(before.len(), 1);

        let slug = discard_one(&c, id).unwrap();
        assert_eq!(slug, "alpha");

        let after = list_problems(&c, "alpha").unwrap();
        assert!(after.is_empty(), "discard_one must hard-delete the row");
        // load_by_id must also fail because the row is gone (DELETE,
        // not status='abandoned'). This is the contract the
        // `requeue_for_project` re-queue path relies on.
        assert!(load_by_id(&c, id).is_err());
    }

    /// `discard_one` is intentionally NOT idempotent — a second call
    /// on the same id surfaces an error rather than silently
    /// succeeding. The UI removes the row from its local list on the
    /// first successful response and never re-issues, so the second
    /// call is always a bug worth surfacing.
    #[test]
    fn discard_one_second_call_errors_clearly() {
        let c = open_test_db();
        let id = append(&c, &sample_entry("alpha", "WI-1", 0)).unwrap();
        force_row(&c, id, OutboxStatus::Failed, Some(100));
        discard_one(&c, id).unwrap();

        let err = discard_one(&c, id).unwrap_err();
        assert!(err.contains("not found"), "got {}", err);
    }

    /// A discarded row must NOT come back via `requeue_for_project` —
    /// otherwise a user who clicks Discard then Force Push would see
    /// the row pop right back. This is the test that keeps the
    /// "DELETE not transition" decision honest.
    #[test]
    fn discard_then_requeue_for_project_does_not_resurrect() {
        let c = open_test_db();
        let id = append(&c, &sample_entry("alpha", "WI-1", 0)).unwrap();
        force_row(&c, id, OutboxStatus::Abandoned, Some(100));

        discard_one(&c, id).unwrap();
        let n = requeue_for_project(&c, "alpha").unwrap();
        assert_eq!(n, 0);
        assert!(load_by_id(&c, id).is_err());
    }
}
