use tracing::{debug, warn};

use super::{events, io, now_ms};
use crate::sync::adapter::SyncContext;
use crate::sync::events::SyncEventTrigger;
use crate::sync::metrics::{MetricKind, MetricOutcome};
use crate::sync::oauth;
use crate::sync::types::{OutboxEntry, OutboxOp, OutboxStatus, SyncError};
use crate::sync::{adapters, import, metrics};

/// Import cycle: drive every `import_progress` row in
/// `pending` / `running` state forward by `max_pages_per_project`
/// pages. Rows whose adapter doesn't support import are surfaced as
/// `failed` and skipped — that combination shouldn't happen in
/// practice (the attach path checks `supports_import` before
/// `ensure_pending`), but defending against it here means a misbuilt
/// adapter can't park rows in the queue forever.
///
/// Each page is persisted to the outbox as `merge_external` rows
/// (same shape as the pull / webhook paths) so the merge cycle owns
/// the actual local-write step. Cursor + counter advance happens
/// only after the rows are committed, so a crash mid-page either
/// leaves the cursor untouched (replays the page) or advances it
/// (skips the page) — never duplicates entities into the outbox.
pub async fn import_cycle(max_pages_per_project: usize) -> Result<(), String> {
    if max_pages_per_project == 0 {
        return Ok(());
    }
    let runnable = tokio::task::spawn_blocking(|| {
        let conn = io::conn()?;
        import::list_runnable(&conn)
    })
    .await
    .map_err(|err| format!("import-cycle join error: {}", err))??;

    if runnable.is_empty() {
        debug!("[sync::worker] import cycle: no runnable rows");
        return Ok(());
    }

    for row in runnable {
        for _ in 0..max_pages_per_project {
            match import_one_page(&row.project_slug, &row.adapter_id).await {
                Ok(ImportPageOutcome::Advanced) => continue,
                Ok(ImportPageOutcome::Completed) | Ok(ImportPageOutcome::Stopped) => break,
                Err(err) => {
                    warn!(
                        "[sync::worker] import project='{}' adapter='{}' failed: {}",
                        row.project_slug, row.adapter_id, err
                    );
                    break;
                }
            }
        }
    }
    Ok(())
}

/// Result of one import page round.
enum ImportPageOutcome {
    /// Page applied; `import_progress` advanced; cursor still has more.
    Advanced,
    /// Adapter reported pagination exhausted; row marked `completed`.
    Completed,
    /// Stop processing this row this tick (terminal-state row, missing
    /// adapter, etc). Not an error, but no further pages should be
    /// pulled from this project on this tick.
    Stopped,
}

async fn import_one_page(
    project_slug: &str,
    adapter_id: &str,
) -> Result<ImportPageOutcome, String> {
    let Some(adapter) = adapters::get(adapter_id) else {
        // Mark failed so the row stops cycling. The user can re-attach
        // an adapter to recover; without the failed stamp the worker
        // would log on every tick.
        let owned_slug = project_slug.to_string();
        let owned_adapter = adapter_id.to_string();
        let now = now_ms();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let conn = io::conn()?;
            import::mark_failed(
                &conn,
                &owned_slug,
                &owned_adapter,
                "adapter not registered",
                now,
            )
        })
        .await
        .map_err(|err| format!("import mark-failed join error: {}", err))??;
        return Ok(ImportPageOutcome::Stopped);
    };

    if !adapter.supports_import() {
        let owned_slug = project_slug.to_string();
        let owned_adapter = adapter_id.to_string();
        let now = now_ms();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let conn = io::conn()?;
            import::mark_failed(
                &conn,
                &owned_slug,
                &owned_adapter,
                "adapter does not support bulk import",
                now,
            )
        })
        .await
        .map_err(|err| format!("import mark-failed join error: {}", err))??;
        return Ok(ImportPageOutcome::Stopped);
    }

    // Read current row + project binding from the same connection so
    // the cursor we walk is consistent with the row we'll advance.
    let owned_slug = project_slug.to_string();
    let owned_adapter = adapter_id.to_string();
    let snapshot = tokio::task::spawn_blocking(
        move || -> Result<(Option<String>, Option<String>, String), String> {
            let conn = io::conn()?;
            let progress =
                import::read_status(&conn, &owned_slug, &owned_adapter)?.ok_or_else(|| {
                    format!("import_progress row missing for ({owned_slug}, {owned_adapter})")
                })?;
            if progress.state.is_terminal() {
                return Err(format!(
                    "import_progress row in terminal state {:?}",
                    progress.state
                ));
            }
            let binding = io::read_adapter_binding(&conn, &owned_slug)?
                .ok_or_else(|| format!("project '{owned_slug}' lost its adapter binding"))?;
            if binding.adapter_id != owned_adapter {
                return Err(format!(
                    "import_progress adapter '{}' does not match current binding '{}'",
                    owned_adapter, binding.adapter_id
                ));
            }
            Ok((
                progress.page_cursor,
                binding.config_json,
                binding.connection_id,
            ))
        },
    )
    .await
    .map_err(|err| format!("import snapshot join error: {}", err))?;

    let (page_cursor, config_json, connection_id) = match snapshot {
        Ok(value) => value,
        Err(err) => {
            // Don't mark the row failed for a transient binding read —
            // these errors mean the row can't be progressed this tick
            // but the next tick may succeed. The "terminal state" arm
            // is harmless (just stops processing).
            return Err(err);
        }
    };

    // Refresh OAuth bearer the same way the pull path does — imports
    // are long-running, and a bearer that was fresh at attach time may
    // have expired by the time the row is processed.
    let auth_token = match oauth::ensure_fresh_connection_token(&connection_id, adapter_id).await {
        Ok(bearer) => Some(bearer),
        Err(err) => {
            if err.starts_with("no sync token") {
                None
            } else {
                let owned_slug = project_slug.to_string();
                let owned_adapter = adapter_id.to_string();
                let owned_err = err.clone();
                let now = now_ms();
                tokio::task::spawn_blocking(move || -> Result<(), String> {
                    let conn = io::conn()?;
                    import::mark_failed(&conn, &owned_slug, &owned_adapter, &owned_err, now)
                })
                .await
                .map_err(|err| format!("import mark-failed join error: {}", err))??;
                return Err(err);
            }
        }
    };

    let ctx = SyncContext {
        adapter_id: adapter_id.to_string(),
        auth_token,
        project_slug: project_slug.to_string(),
        cursor_blob: None,
        config_json,
    };

    let started = std::time::Instant::now();
    let page = match adapter
        .pull_all(project_slug, &ctx, page_cursor.as_deref())
        .await
    {
        Ok(page) => {
            metrics::record(
                project_slug.to_string(),
                adapter_id.to_string(),
                MetricKind::Pull,
                if page.changes.is_empty() {
                    MetricOutcome::Empty
                } else {
                    MetricOutcome::Ok
                },
                started.elapsed().as_millis() as u64,
                page.changes.len() as u64,
            );
            page
        }
        Err(err) => {
            metrics::record_with_note(
                project_slug.to_string(),
                adapter_id.to_string(),
                MetricKind::Pull,
                MetricOutcome::from_sync_error(&err),
                started.elapsed().as_millis() as u64,
                0,
                err.to_string(),
            );
            // Permanent errors mark the row failed (user-visible
            // "Retry" button). Transient / rate-limited / auth errors
            // surface as a warning and leave the row state untouched
            // so the next tick replays the same page.
            let SyncError::Permanent(_) = &err else {
                return Err(err.to_string());
            };
            let owned_slug = project_slug.to_string();
            let owned_adapter = adapter_id.to_string();
            let owned_err = err.to_string();
            let now = now_ms();
            tokio::task::spawn_blocking(move || -> Result<(), String> {
                let conn = io::conn()?;
                import::mark_failed(&conn, &owned_slug, &owned_adapter, &owned_err, now)
            })
            .await
            .map_err(|err| format!("import mark-failed join error: {}", err))??;
            return Err(err.to_string());
        }
    };

    // Persist outbox rows + advance import_progress in one connection
    // so a crash mid-write either rolls both back or commits both.
    let owned_slug = project_slug.to_string();
    let owned_adapter = adapter_id.to_string();
    let changes = page.changes;
    let next_cursor = page.next_page_cursor;
    let total_hint = page.total_hint;
    let exhausted = next_cursor.is_none();
    let now = now_ms();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut conn = io::conn()?;
        let tx = conn
            .transaction()
            .map_err(|err| format!("DB error (import tx): {}", err))?;
        let delta = changes.len() as u64;
        for change in &changes {
            let payload = serde_json::to_string(change).map_err(|err| {
                format!(
                    "merge_external payload serialization failed (import): {}",
                    err
                )
            })?;
            let row = OutboxEntry {
                id: None,
                project_slug: owned_slug.clone(),
                entity_type: change.entity_type,
                entity_id: change.external_id.clone(),
                op: OutboxOp::MergeExternal,
                field_path: None,
                payload_json: payload,
                created_at: now,
                retry_count: 0,
                last_attempted_at: None,
                last_error: None,
                status: OutboxStatus::Pending,
            };
            io::append(&tx, &row)?;
        }
        import::advance(
            &tx,
            &owned_slug,
            &owned_adapter,
            next_cursor.as_deref(),
            delta,
            total_hint,
            now,
        )?;
        if exhausted {
            import::mark_completed(&tx, &owned_slug, &owned_adapter, now)?;
        }
        tx.commit()
            .map_err(|err| format!("DB error (import tx commit): {}", err))?;
        Ok(())
    })
    .await
    .map_err(|err| format!("import-persist join error: {}", err))??;

    events::emit_status(project_slug, SyncEventTrigger::PullCycle);
    Ok(if exhausted {
        ImportPageOutcome::Completed
    } else {
        ImportPageOutcome::Advanced
    })
}
