//! Import, conflict, and outbox-problem commands for the pluggable sync framework.
//!
//! Handles bulk historical import operations (`project_sync_import_*`),
//! conflict resolution (`project_sync_conflict_*`, `project_sync_conflicts_*`),
//! and outbox problem management (`project_sync_list_problems`,
//! `project_sync_retry_entry`, `project_sync_discard_entry`).

use tokio::task;

use crate::sync::{
    self,
    conflict_log::{self, ConflictResolution as ConflictRowResolution, ConflictRow},
    events::SyncEventTrigger,
    import as sync_import,
    import::ImportProgressRow,
    metrics::{MetricKind, MetricOutcome},
    types::{EntityType, OutboxEntry, OutboxOp, OutboxProblemRow, OutboxStatus},
};

// ============================================================================
// Outbox problems
// ============================================================================

/// List every `failed` / `abandoned` outbox row for `slug`. Powers the
/// "Failed entries" section in `SyncSection`.
///
/// Order is `last_attempted_at DESC NULLS LAST, created_at DESC` so
/// the most recently-attempted problem floats to the top. The wire
/// row drops `project_slug` (the caller already knows it) and tightens
/// `id` to non-optional (every persisted row has one).
#[tauri::command]
pub async fn project_sync_list_problems(slug: String) -> Result<Vec<OutboxProblemRow>, String> {
    task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        sync::io::list_problems(&connection, &slug)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Requeue exactly one outbox row by id. Flips status to `pending`,
/// clears `last_attempted_at` + `last_error`, leaves `retry_count`
/// alone (backoff continuity matters: the next genuine failure picks
/// up where the previous attempt left off).
///
/// Emits a `manual` `SyncStatusEvent` for the row's project so the
/// status bar / settings panel rebalance immediately, without waiting
/// for the worker's next push tick.
///
/// Errors when no row matched the id.
#[tauri::command]
pub async fn project_sync_retry_entry(entry_id: i64) -> Result<(), String> {
    let project_slug = task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        sync::io::requeue_one(&connection, entry_id)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;
    sync::events::emit_status(&project_slug, SyncEventTrigger::Manual);
    Ok(())
}

/// Hard-delete one outbox row by id. The hard-delete semantics are
/// chosen specifically because [`sync::io::requeue_for_project`] —
/// used by `project_sync_force_push` — re-queues both `Failed` and
/// `Abandoned` rows: a `status = 'abandoned'` transition would let
/// the next force-push silently un-discard everything the user just
/// discarded. See [`sync::io::discard_one`] for the long form.
///
/// Emits a `manual` `SyncStatusEvent` for the row's project after
/// the delete commits.
#[tauri::command]
pub async fn project_sync_discard_entry(entry_id: i64) -> Result<(), String> {
    let project_slug = task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        sync::io::discard_one(&connection, entry_id)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;
    sync::events::emit_status(&project_slug, SyncEventTrigger::Manual);
    Ok(())
}

// ============================================================================
// Bulk historical import
// ============================================================================

/// Read the import progress row for `(slug, adapter_id)`. Returns
/// `None` when the project has never queued an import (e.g. its
/// adapter doesn't support import). The UI uses `None` as the
/// "hide the panel entirely" signal.
#[tauri::command]
pub async fn project_sync_import_status(
    slug: String,
    adapter_id: String,
) -> Result<Option<ImportProgressRow>, String> {
    task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        sync_import::read_status(&connection, &slug, &adapter_id)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Cancel a pending or running import. Idempotent against a row
/// already in a terminal state — returns `Ok(())` either way so the
/// UI's "cancel" button doesn't need state-aware error handling.
///
/// Cancellation is final in v1: there is no "uncancel" path. Users
/// who change their mind can detach + re-attach the adapter to start
/// a fresh import.
#[tauri::command]
pub async fn project_sync_import_cancel(slug: String, adapter_id: String) -> Result<(), String> {
    let event_slug = slug.clone();
    task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        sync_import::mark_cancelled(&connection, &slug, &adapter_id, sync::worker::now_ms_pub())
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;
    sync::events::emit_status(&event_slug, SyncEventTrigger::Manual);
    Ok(())
}

/// Re-queue a failed import for retry. The cursor is preserved so
/// the retry resumes mid-stream rather than re-importing from page 1.
/// Errors when the row is in any state other than `failed` — the UI
/// shouldn't be offering "retry" outside of that state, so a hit
/// here is a UI bug worth surfacing.
#[tauri::command]
pub async fn project_sync_import_retry(slug: String, adapter_id: String) -> Result<(), String> {
    let event_slug = slug.clone();
    let transitioned = task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        sync_import::reset_for_retry(&connection, &slug, &adapter_id, sync::worker::now_ms_pub())
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;
    if !transitioned {
        return Err(
            "import is not in failed state; nothing to retry (refresh the panel)".to_string(),
        );
    }
    sync::events::emit_status(&event_slug, SyncEventTrigger::Manual);
    Ok(())
}

// ============================================================================
// Conflict resolution
// ============================================================================

/// Listing default for the resolved-tail of `project_sync_conflicts_list`.
/// The Conflicts panel renders the open list inline and reveals the tail
/// behind a "Show recently resolved" toggle, so this number sets the
/// **toggle limit**, not the always-visible window. 25 keeps the audit
/// trail useful for "did I just click Use Local on the right one?"
/// without dragging in dead history.
const DEFAULT_RESOLVED_TAIL: usize = 25;

/// List conflicts for a project. Open rows come first (ordered by
/// `detected_at DESC`), followed by up to [`DEFAULT_RESOLVED_TAIL`]
/// recently-resolved rows. Returns an empty Vec for projects with no
/// audit history — the UI then hides the panel entirely, mirroring
/// the import-panel hide-when-empty pattern.
#[tauri::command]
pub async fn project_sync_conflicts_list(slug: String) -> Result<Vec<ConflictRow>, String> {
    task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        conflict_log::list_for_project(&connection, &slug, DEFAULT_RESOLVED_TAIL)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Open count, for the SyncSection panel header chip. Cheap enough
/// to call alongside `project_sync_status` without paying for a full
/// list when the count is the only thing the caller needs.
#[tauri::command]
pub async fn project_sync_conflicts_count(slug: String) -> Result<i64, String> {
    task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        conflict_log::count_open(&connection, &slug)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// "Use local": for every field on the conflict, append an
/// `OutboxOp::Update` carrying the local value so the next push cycle
/// drives the remote back to the local writer's intent. Stamps the
/// row resolved with [`ConflictRowResolution::UseLocal`].
///
/// Idempotent: a second click after the row was already resolved is a
/// no-op (returns `Ok(())`). Errors only when the row id is unknown
/// or the underlying outbox append fails.
///
/// Emits a `ConflictResolve` metric and a `Manual` `SyncStatusEvent`
/// so the panel and status bar refresh without waiting for the
/// worker tick.
#[tauri::command]
pub async fn project_sync_conflict_use_local(conflict_id: i64) -> Result<(), String> {
    let project_slug = task::spawn_blocking(move || -> Result<Option<String>, String> {
        let mut connection = sync::io::conn()?;
        let row = match conflict_log::read_one(&connection, conflict_id)? {
            Some(row) => row,
            None => return Err(format!("conflict row {} not found", conflict_id)),
        };
        if row.resolved_at.is_some() {
            // Already resolved (race with another click). Treat as
            // benign no-op; tell the caller "no slug to refresh on".
            return Ok(None);
        }

        // Build the partial-update payload from the captured local
        // values + append a fresh `Update` outbox row inside a single
        // transaction so a worker crash between the append and the
        // mark_resolved leaves the system in either "no-op done" or
        // "fully resolved" — never "appended but unmarked".
        let payload = conflict_log::use_local_payload(&row);
        let now_ms = sync::worker::now_ms_pub();
        let field_path = if payload.is_empty() {
            None
        } else {
            Some(payload.keys().cloned().collect::<Vec<_>>().join(","))
        };
        let payload_json = serde_json::Value::Object(payload).to_string();
        let entry = OutboxEntry {
            id: None,
            project_slug: row.project_slug.clone(),
            entity_type: EntityType::WorkItem,
            entity_id: row.entity_id.clone(),
            op: OutboxOp::Update,
            field_path,
            payload_json,
            created_at: now_ms,
            retry_count: 0,
            last_attempted_at: None,
            last_error: None,
            status: OutboxStatus::Pending,
        };
        let tx = connection
            .transaction()
            .map_err(|err| format!("DB error (begin tx): {}", err))?;
        sync::io::append(&tx, &entry)?;
        if !conflict_log::mark_resolved(&tx, conflict_id, ConflictRowResolution::UseLocal, now_ms)?
        {
            // Transitioned to resolved between the read and the
            // mark — abort the transaction so we don't leave a
            // stray outbox row behind.
            tx.rollback()
                .map_err(|err| format!("DB error (rollback): {}", err))?;
            return Ok(None);
        }
        tx.commit()
            .map_err(|err| format!("DB error (commit): {}", err))?;

        sync::metrics::record(
            &row.project_slug,
            &row.adapter_id,
            MetricKind::ConflictResolve,
            MetricOutcome::Ok,
            0,
            row.fields.fields.len() as u64,
        );
        Ok(Some(row.project_slug))
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;

    if let Some(slug) = project_slug {
        sync::events::emit_status(&slug, SyncEventTrigger::Manual);
    }
    Ok(())
}

/// "Use remote": overwrite the local value(s) for every field on the
/// conflict with the captured remote value, stamping the field
/// revision to the remote watermark so the next merge cycle does not
/// re-flag the same row. Stamps the conflict resolved with
/// [`ConflictRowResolution::UseRemote`].
///
/// Idempotent. Errors only when the row id is unknown or the local
/// write fails.
#[tauri::command]
pub async fn project_sync_conflict_use_remote(conflict_id: i64) -> Result<(), String> {
    let project_slug = task::spawn_blocking(move || -> Result<Option<String>, String> {
        let connection = sync::io::conn()?;
        let row = match conflict_log::read_one(&connection, conflict_id)? {
            Some(row) => row,
            None => return Err(format!("conflict row {} not found", conflict_id)),
        };
        if row.resolved_at.is_some() {
            return Ok(None);
        }
        drop(connection);

        let remote_payload = conflict_log::use_remote_payload(&row);
        let new_revisions = conflict_log::use_remote_revisions(&row);
        let update = sync::worker::partial_update_from_map(&remote_payload);

        crate::projects::io::update_work_item_partial_with_revisions(
            &row.project_slug,
            &row.entity_id,
            new_revisions,
            &update,
        )?;

        let now_ms = sync::worker::now_ms_pub();
        let connection = sync::io::conn()?;
        if !conflict_log::mark_resolved(
            &connection,
            conflict_id,
            ConflictRowResolution::UseRemote,
            now_ms,
        )? {
            return Ok(None);
        }

        sync::metrics::record(
            &row.project_slug,
            &row.adapter_id,
            MetricKind::ConflictResolve,
            MetricOutcome::Ok,
            0,
            row.fields.fields.len() as u64,
        );
        Ok(Some(row.project_slug))
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;

    if let Some(slug) = project_slug {
        sync::events::emit_status(&slug, SyncEventTrigger::Manual);
    }
    Ok(())
}

/// "Dismiss": accept the resolver verdict as-is. No fields are
/// touched; we just mark the audit row resolved so the panel can
/// stop showing it. Useful for cases where the user has decided the
/// kept-local value is correct and doesn't want to either re-push
/// or be reminded of the row.
#[tauri::command]
pub async fn project_sync_conflict_dismiss(conflict_id: i64) -> Result<(), String> {
    let project_slug = task::spawn_blocking(move || -> Result<Option<String>, String> {
        let connection = sync::io::conn()?;
        let row = match conflict_log::read_one(&connection, conflict_id)? {
            Some(row) => row,
            None => return Err(format!("conflict row {} not found", conflict_id)),
        };
        if row.resolved_at.is_some() {
            return Ok(None);
        }
        let now_ms = sync::worker::now_ms_pub();
        if !conflict_log::mark_resolved(
            &connection,
            conflict_id,
            ConflictRowResolution::Dismissed,
            now_ms,
        )? {
            return Ok(None);
        }
        sync::metrics::record(
            &row.project_slug,
            &row.adapter_id,
            MetricKind::ConflictResolve,
            MetricOutcome::Ok,
            0,
            row.fields.fields.len() as u64,
        );
        Ok(Some(row.project_slug))
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;

    if let Some(slug) = project_slug {
        sync::events::emit_status(&slug, SyncEventTrigger::Manual);
    }
    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod problems_tests {
    //! Command-level coverage for the
    //! `project_sync_list_problems` / `project_sync_retry_entry` /
    //! `project_sync_discard_entry` surface.
    //!
    //! These tests run inside `test_env::sandbox()` so the sqlite
    //! `projects.db` lives under a per-test temp dir, then bypass the
    //! Tauri IPC layer by calling the `#[tauri::command]` async fns
    //! directly. The events module's `test_probe` records every
    //! `emit_status` call before the (absent) `AppHandle` check, so we
    //! can verify the command emitted a `Manual` event for the right
    //! slug without spinning up a real Tauri shell.
    use super::*;
    use crate::sync::events::{test_probe, SyncEventTrigger};
    use test_helpers::test_env;

    fn seed_failed_entry(slug: &str, entity_id: &str, last_attempted: Option<i64>) -> i64 {
        let connection = sync::io::conn().expect("conn");
        crate::projects::schema::init_project_tables(&connection).expect("init schema");
        let entry = OutboxEntry {
            id: None,
            project_slug: slug.to_string(),
            entity_type: EntityType::WorkItem,
            entity_id: entity_id.to_string(),
            op: OutboxOp::Update,
            field_path: Some("title".to_string()),
            payload_json: r#"{"title":"updated"}"#.to_string(),
            created_at: 1_700_000_000_000,
            last_attempted_at: last_attempted,
            retry_count: 3,
            last_error: Some("simulated remote 500".to_string()),
            status: OutboxStatus::Pending,
        };
        let id = sync::io::append(&connection, &entry).expect("append");
        connection
            .execute(
                "UPDATE outbox_entries
                    SET status = ?1, last_error = ?2, retry_count = ?3, last_attempted_at = ?4
                  WHERE id = ?5",
                rusqlite::params![
                    OutboxStatus::Failed.as_db_str(),
                    "simulated remote 500",
                    3_u32,
                    last_attempted,
                    id,
                ],
            )
            .expect("force failed");
        id
    }

    #[tokio::test]
    async fn list_problems_returns_failed_rows() {
        let _sandbox = test_env::sandbox();
        let id = seed_failed_entry("alpha", "WI-1", Some(1_700_000_100_000));

        let rows = project_sync_list_problems("alpha".to_string())
            .await
            .expect("list_problems");
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.id, id);
        assert_eq!(row.entity_id, "WI-1");
        assert_eq!(row.status, OutboxStatus::Failed);
        assert_eq!(row.retry_count, 3);
        assert_eq!(row.last_error.as_deref(), Some("simulated remote 500"));
    }

    #[tokio::test]
    async fn retry_entry_emits_manual_event_for_correct_slug() {
        let _sandbox = test_env::sandbox();
        let id = seed_failed_entry("alpha", "WI-1", Some(1_700_000_100_000));
        let _ = seed_failed_entry("beta", "WI-9", Some(1_700_000_200_000));

        test_probe::reset();
        project_sync_retry_entry(id).await.expect("retry_entry");

        let calls = test_probe::snapshot();
        assert_eq!(
            calls.len(),
            1,
            "retry_entry must emit exactly one status event; got {:?}",
            calls
        );
        assert_eq!(calls[0].0, "alpha");
        assert_eq!(calls[0].1, SyncEventTrigger::Manual);

        let alpha = project_sync_list_problems("alpha".to_string())
            .await
            .expect("list alpha");
        assert!(
            alpha.is_empty(),
            "retried row must vanish from problems; got {:?}",
            alpha
        );
        let beta = project_sync_list_problems("beta".to_string())
            .await
            .expect("list beta");
        assert_eq!(beta.len(), 1);
    }

    #[tokio::test]
    async fn retry_entry_unknown_id_errors_without_emit() {
        let _sandbox = test_env::sandbox();
        let connection = sync::io::conn().expect("conn");
        crate::projects::schema::init_project_tables(&connection).expect("init schema");
        drop(connection);

        test_probe::reset();
        let err = project_sync_retry_entry(9_999).await.unwrap_err();
        assert!(err.contains("not found"), "got {}", err);
        assert!(
            test_probe::snapshot().is_empty(),
            "retry on unknown id must not emit"
        );
    }

    #[tokio::test]
    async fn discard_entry_emits_manual_event_and_deletes_row() {
        let _sandbox = test_env::sandbox();
        let id = seed_failed_entry("alpha", "WI-1", Some(1_700_000_100_000));

        test_probe::reset();
        project_sync_discard_entry(id).await.expect("discard_entry");

        let calls = test_probe::snapshot();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "alpha");
        assert_eq!(calls[0].1, SyncEventTrigger::Manual);

        let rows = project_sync_list_problems("alpha".to_string())
            .await
            .expect("list");
        assert!(
            rows.is_empty(),
            "discarded row must be gone; got {:?}",
            rows
        );
    }

    #[tokio::test]
    async fn discard_entry_second_call_errors_clearly() {
        let _sandbox = test_env::sandbox();
        let id = seed_failed_entry("alpha", "WI-1", Some(1_700_000_100_000));
        project_sync_discard_entry(id).await.expect("first");

        test_probe::reset();
        let err = project_sync_discard_entry(id).await.unwrap_err();
        assert!(err.contains("not found"), "got {}", err);
        assert!(
            test_probe::snapshot().is_empty(),
            "second discard must not emit"
        );
    }
}
