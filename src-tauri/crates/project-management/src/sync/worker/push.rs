use tracing::{debug, warn};

use super::{events, finalize_failure, finalize_success, io, now_ms};
use crate::sync::{
    adapter::SyncContext,
    adapters,
    events::SyncEventTrigger,
    metrics::{self, MetricKind, MetricOutcome},
    oauth,
    types::OutboxEntry,
};

/// One push cycle: drain up to `max_pushes` outbox rows, mark each
/// succeeded / failed.
///
/// Public so tests can drive the worker manually without spawning the
/// real loop.
pub async fn push_cycle(max_pushes: usize) -> Result<usize, String> {
    let mut processed = 0;
    for _ in 0..max_pushes {
        let claimed = claim_one().await?;
        let Some(entry) = claimed else { break };
        process_entry(entry).await?;
        processed += 1;
    }
    Ok(processed)
}

async fn claim_one() -> Result<Option<OutboxEntry>, String> {
    tokio::task::spawn_blocking(|| {
        let conn = io::conn()?;
        io::claim_next_pending(&conn, now_ms())
    })
    .await
    .map_err(|err| format!("claim join error: {}", err))?
}

/// Dispatch one in-flight entry to its adapter and persist the outcome.
///
/// Adapter resolution flows through `storys.sync_kind`:
/// - the entry's `project_slug` looks up the binding row;
/// - `'none'` (no attachment) marks the row succeeded as a no-op so it
///   doesn't pile up forever — the user explicitly opted out;
/// - an unknown adapter id is a permanent error (someone removed an
///   adapter we still have queued rows for).
async fn process_entry(entry: OutboxEntry) -> Result<(), String> {
    let id = entry
        .id
        .ok_or_else(|| "outbox entry missing id after claim".to_string())?;

    // Capture the slug up front so we can emit after every terminal
    // branch. The closures that follow take ownership of clones, so
    // `entry.project_slug` itself stays valid here.
    let event_slug = entry.project_slug.clone();
    let result = process_entry_inner(entry, id).await;
    events::emit_status(&event_slug, SyncEventTrigger::PushCycle);
    result
}

/// Body of [`process_entry`]; split out so the surrounding wrapper can
/// emit a single `orgii-project-sync-status` event regardless of which
/// terminal branch fired.
async fn process_entry_inner(entry: OutboxEntry, id: i64) -> Result<(), String> {
    let project_slug = entry.project_slug.clone();
    let binding = tokio::task::spawn_blocking(move || {
        let conn = io::conn()?;
        io::read_adapter_binding(&conn, &project_slug)
    })
    .await
    .map_err(|err| format!("read-binding join error: {}", err))??;

    let Some(binding) = binding else {
        debug!(
            "[sync::worker] project '{}' has sync_kind='none'; marking entry id={} succeeded as no-op",
            entry.project_slug, id
        );
        return finalize_success(id).await;
    };
    let adapter_id = binding.adapter_id;
    let config_json = binding.config_json;
    let connection_id = binding.connection_id;

    let Some(adapter) = adapters::get(&adapter_id) else {
        let msg = format!("adapter '{}' not registered", adapter_id);
        warn!("[sync::worker] {}", msg);
        return finalize_failure(id, &msg, /* retryable= */ false).await;
    };

    // Route the connection-scoped bearer through
    // `oauth::ensure_fresh_connection_token` so expiring OAuth tokens
    // (Linear) refresh transparently before the adapter call.
    // `None` (no token stored) is fine for adapters that declare
    // `auth_kind = None` (EchoAdapter); auth-requiring adapters
    // surface their own `SyncError::AuthFailed` when called with
    // `None`. Refresh failures are NOT silently swallowed — they
    // finalize the row as a real failure with `last_error` set so
    // the user sees what's wrong on the next status refresh.
    let auth_token = match oauth::ensure_fresh_connection_token(&connection_id, &adapter_id).await {
        Ok(bearer) => Some(bearer),
        Err(err) if err.starts_with("no sync token") => None,
        Err(err) => {
            return finalize_failure(
                id,
                &format!("token refresh failed: {}", err),
                /* retryable= */ true,
            )
            .await;
        }
    };

    let ctx = SyncContext {
        adapter_id: adapter_id.clone(),
        auth_token,
        project_slug: entry.project_slug.clone(),
        cursor_blob: None,
        config_json,
    };

    let push_started = std::time::Instant::now();
    match adapter.push(&entry, &ctx).await {
        Ok(outcome) => {
            let duration_ms = push_started.elapsed().as_millis() as u64;
            debug!(
                "[sync::worker] push ok id={} adapter={} external_id={:?}",
                id, adapter_id, outcome.external_id
            );
            metrics::record(
                entry.project_slug.clone(),
                adapter_id.clone(),
                MetricKind::Push,
                MetricOutcome::Ok,
                duration_ms,
                /* count = */ 1,
            );
            finalize_success(id).await
        }
        Err(err) => {
            let duration_ms = push_started.elapsed().as_millis() as u64;
            warn!(
                "[sync::worker] push failed id={} adapter={}: {}",
                id, adapter_id, err
            );
            metrics::record_with_note(
                entry.project_slug.clone(),
                adapter_id.clone(),
                MetricKind::Push,
                MetricOutcome::from_sync_error(&err),
                duration_ms,
                0,
                err.to_string(),
            );
            let retryable = err.is_retryable();
            finalize_failure(id, &format!("{}", err), retryable).await
        }
    }
}
