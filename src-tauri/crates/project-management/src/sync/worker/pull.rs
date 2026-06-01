use tracing::{debug, warn};

use super::{events, io, now_ms, WEBHOOK_FRESHNESS_WINDOW_MS};
use crate::sync::adapter::SyncContext;
use crate::sync::events::SyncEventTrigger;
use crate::sync::metrics::{MetricKind, MetricOutcome};
use crate::sync::oauth;
use crate::sync::types::{OutboxEntry, OutboxOp, OutboxStatus};
use crate::sync::{adapters, metrics};

/// Pull cycle: for every project with an attached adapter, ask the
/// adapter for changes since `sync_last_pull_at`, append one
/// `merge_external` outbox row per change, and advance the cursor.
pub async fn pull_cycle() -> Result<(), String> {
    let bindings = tokio::task::spawn_blocking(|| {
        let conn = io::conn()?;
        io::list_bound_projects(&conn)
    })
    .await
    .map_err(|err| format!("pull-cycle join error: {}", err))??;

    if bindings.is_empty() {
        debug!("[sync::worker] pull cycle: no bound projects");
        return Ok(());
    }

    let now = now_ms();
    for binding in bindings {
        // Webhook freshness gate: a project that received a webhook
        // within `WEBHOOK_FRESHNESS_WINDOW_MS` already has its inbound
        // changes flowing through the merge cycle. Skipping the poll
        // halves the request budget for healthy push deliveries
        // without sacrificing correctness — the gate falls open
        // automatically if the webhook stream goes dark.
        if let Some(last) = binding.last_webhook_at {
            if now - last < WEBHOOK_FRESHNESS_WINDOW_MS {
                debug!(
                    "[sync::worker] pull skip project='{}': webhook received {}ms ago (within {}ms window)",
                    binding.project_slug,
                    now - last,
                    WEBHOOK_FRESHNESS_WINDOW_MS
                );
                metrics::record(
                    binding.project_slug.clone(),
                    binding.adapter_id.clone(),
                    MetricKind::Pull,
                    MetricOutcome::Skipped,
                    /* duration_ms = */ 0,
                    /* count = */ 0,
                );
                continue;
            }
        }
        if let Err(err) = pull_one_project(binding).await {
            warn!("[sync::worker] pull failed: {}", err);
        }
    }
    Ok(())
}

/// User-triggered pull for one specific project. Returns an error
/// when the project isn't bound to an adapter so the UI can surface
/// "Attach an adapter first" rather than silently doing nothing.
pub async fn pull_one_project_by_slug(slug: String) -> Result<(), String> {
    let owned_slug = slug.clone();
    let binding = tokio::task::spawn_blocking(move || -> Result<io::ProjectBinding, String> {
        let conn = io::conn()?;
        let binding = io::read_adapter_binding(&conn, &owned_slug)?
            .ok_or_else(|| format!("project '{}' is not bound to a sync adapter", owned_slug))?;
        Ok(io::ProjectBinding {
            project_slug: owned_slug,
            adapter_id: binding.adapter_id,
            config_json: binding.config_json,
            connection_id: binding.connection_id,
            // Manual pulls bypass the freshness window — the user
            // clicked "force pull" so we honour that intent rather
            // than silently skipping. `None` keeps the field's
            // semantics correct (`pull_cycle` is the only consumer
            // that checks it, and only against the bulk listing).
            last_webhook_at: None,
        })
    })
    .await
    .map_err(|err| format!("force-pull join error: {}", err))??;
    pull_one_project(binding).await
}

/// Run one project's pull cycle.
///
/// Emits a single `orgii-project-sync-status` event for the project at
/// the end of the cycle — coalesced regardless of how many
/// `merge_external` rows the adapter produced. The merge cycle that
/// drains those rows will emit its own per-row events as it processes
/// them; the pull-cycle event is the "last_pull_at moved" signal.
async fn pull_one_project(binding: io::ProjectBinding) -> Result<(), String> {
    let event_slug = binding.project_slug.clone();
    let result = pull_one_project_inner(binding).await;
    // Emit even on adapter-skip / failure so the UI sees the timestamp
    // movement (or the lack of it) without polling. The emitter's own
    // failure handler logs and drops; we never poison the pull cycle.
    events::emit_status(&event_slug, SyncEventTrigger::PullCycle);
    result
}

async fn pull_one_project_inner(binding: io::ProjectBinding) -> Result<(), String> {
    let Some(adapter) = adapters::get(&binding.adapter_id) else {
        warn!(
            "[sync::worker] pull skipped for project '{}': adapter '{}' not registered",
            binding.project_slug, binding.adapter_id
        );
        return Ok(());
    };

    // Tokens may be expiring OAuth bearers (Linear). The
    // connection-scoped wrapper transparently refreshes any record
    // whose `expires_at_unix` is within 60s of now, persists the new
    // record, and returns the bearer string adapters expect. Failures
    // propagate — the worker logs and skips this pull cycle so the
    // next attempt records a real error rather than silently
    // degrading.
    let auth_token = match oauth::ensure_fresh_connection_token(
        &binding.connection_id,
        &binding.adapter_id,
    )
    .await
    {
        Ok(bearer) => Some(bearer),
        Err(err) => {
            // Distinguish "no token stored" (legitimate for adapters
            // with `auth_kind = None` and unset PATs — push path will
            // surface the error itself) from refresh failures. Both
            // log; only refresh failures aborted the pull.
            if err.starts_with("no sync token") {
                None
            } else {
                warn!(
                    "[sync::worker] pull project='{}' adapter='{}' aborted: token refresh failed: {}",
                    binding.project_slug, binding.adapter_id, err
                );
                return Ok(());
            }
        }
    };

    let cursor_slug = binding.project_slug.clone();
    let cursor = tokio::task::spawn_blocking(move || {
        let conn = io::conn()?;
        io::read_sync_cursor(&conn, &cursor_slug)
    })
    .await
    .map_err(|err| format!("read-cursor join error: {}", err))??;

    let since = cursor
        .last_pull_at
        .and_then(chrono::DateTime::<chrono::Utc>::from_timestamp_millis);

    let ctx = SyncContext {
        adapter_id: binding.adapter_id.clone(),
        auth_token,
        project_slug: binding.project_slug.clone(),
        cursor_blob: cursor.cursor_blob.clone(),
        config_json: binding.config_json.clone(),
    };

    let pull_started = std::time::Instant::now();
    let outcome = match adapter.pull(&binding.project_slug, &ctx, since).await {
        Ok(outcome) => {
            let duration_ms = pull_started.elapsed().as_millis() as u64;
            let change_count = outcome.changes.len() as u64;
            metrics::record(
                binding.project_slug.clone(),
                binding.adapter_id.clone(),
                MetricKind::Pull,
                if change_count == 0 {
                    MetricOutcome::Empty
                } else {
                    MetricOutcome::Ok
                },
                duration_ms,
                change_count,
            );
            outcome
        }
        Err(err) => {
            let duration_ms = pull_started.elapsed().as_millis() as u64;
            // Transient / rate-limited / auth errors leave
            // `last_pull_at` and the cursor untouched so the next
            // cycle replays the same window — no data is lost. The
            // worker's pull cadence is what governs retry frequency.
            warn!(
                "[sync::worker] pull project='{}' adapter='{}' failed: {}",
                binding.project_slug, binding.adapter_id, err
            );
            metrics::record_with_note(
                binding.project_slug.clone(),
                binding.adapter_id.clone(),
                MetricKind::Pull,
                MetricOutcome::from_sync_error(&err),
                duration_ms,
                0,
                err.to_string(),
            );
            return Ok(());
        }
    };
    debug!(
        "[sync::worker] pull project='{}' adapter='{}' changes={} next_cursor={:?}",
        binding.project_slug,
        binding.adapter_id,
        outcome.changes.len(),
        outcome.next_cursor.is_some()
    );

    let now = now_ms();
    let project_slug = binding.project_slug.clone();
    let changes = outcome.changes;
    let next_cursor_blob = outcome.next_cursor;
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let conn = io::conn()?;
        for change in &changes {
            let payload = serde_json::to_string(change)
                .map_err(|err| format!("merge_external payload serialization failed: {}", err))?;
            let row = OutboxEntry {
                id: None,
                project_slug: project_slug.clone(),
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
            io::append(&conn, &row)?;
        }
        // Cursor persistence: only advance on successful adapter
        // calls. The adapter decides whether `next_cursor` carries
        // mid-pagination state (when the cycle ran into a hard cap)
        // or `None` (pagination exhausted, replay from `last_pull_at`
        // next cycle).
        let new_cursor = io::SyncCursor {
            last_pull_at: Some(now),
            cursor_blob: next_cursor_blob,
        };
        io::write_sync_cursor(&conn, &project_slug, &new_cursor)?;
        Ok(())
    })
    .await
    .map_err(|err| format!("pull-persist join error: {}", err))??;

    Ok(())
}
