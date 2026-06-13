//! Adapter and project-sync operation commands for the pluggable sync framework.
//!
//! Handles `project_sync_attach_adapter`, `_detach_adapter`, `_status`,
//! `_force_push`, `_force_pull`, `_list_adapters`, and `_metrics_tail`.

use tokio::task;

use crate::sync::{
    self,
    adapter::{AdapterDescriptor, SyncStatusReport},
    adapters, connection_store, connection_token_store,
    events::SyncEventTrigger,
    import as sync_import,
    types::OutboxStatus,
};

// ============================================================================
// Tauri commands
// ============================================================================

/// Attach `adapter_id` to `slug` with an opaque per-adapter
/// `config_json` blob (e.g. Linear team ID, repo owner/name for GitHub).
///
/// The adapter must be registered in [`adapters::registry`]; unknown ids
/// are rejected here so the user sees a clear error rather than a silent
/// no-op the first time the worker tries to push. Persistence flows
/// through `sync::io::attach_adapter` so this command does not own the
/// SQL — keeps `commands/` adapter-routing-free and means schema tweaks
/// touch one place.
#[tauri::command]
pub async fn project_sync_attach_adapter(
    slug: String,
    adapter_id: String,
    connection_id: String,
    config_json: Option<String>,
) -> Result<(), String> {
    let Some(adapter) = adapters::get(&adapter_id) else {
        return Err(format!(
            "Unknown sync adapter '{}'. Registered: {:?}",
            adapter_id,
            adapters::list_descriptors()
                .into_iter()
                .map(|descriptor| descriptor.id)
                .collect::<Vec<_>>()
        ));
    };
    let supports_import = adapter.supports_import();
    let requires_auth = adapter.descriptor().requires_auth;

    task::spawn_blocking(move || -> Result<(), String> {
        let sync_connection = connection_store::get(&connection_id)?;
        if sync_connection.adapter_id != adapter_id {
            return Err(format!(
                "Sync connection '{}' belongs to adapter '{}' but project is attaching '{}'",
                connection_id, sync_connection.adapter_id, adapter_id
            ));
        }
        if requires_auth && connection_token_store::get(&connection_id)?.is_none() {
            return Err(format!(
                "Sync connection '{}' has no stored token",
                connection_id
            ));
        }

        let connection = sync::io::conn()?;
        sync::io::attach_adapter(
            &connection,
            &slug,
            &adapter_id,
            config_json.as_deref().unwrap_or("{}"),
            &connection_id,
        )?;
        // Queue a one-shot historical import the first time an
        // import-capable adapter is attached. `ensure_pending` is
        // idempotent against re-attach (any existing row, terminal or
        // otherwise, is left untouched) so a user toggling adapters
        // doesn't accidentally re-run a completed import.
        if supports_import {
            sync_import::ensure_pending(
                &connection,
                &slug,
                &adapter_id,
                sync::worker::now_ms_pub(),
            )?;
        }
        Ok(())
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Detach whatever adapter is currently attached to `slug`. Surfaces an
/// error if the project is unknown — silently succeeding would let
/// stale UI state masquerade as a successful detach. The global sync
/// connection and token stay intact so other projects can keep using
/// the same account.
#[tauri::command]
pub async fn project_sync_detach_adapter(slug: String) -> Result<(), String> {
    task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        sync::io::detach_adapter(&connection, &slug)?;
        Ok(())
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Snapshot of `slug`'s sync state: which adapter is attached (if any),
/// the outbox queue depth split by status, and the most recent failure.
#[tauri::command]
pub async fn project_sync_status(slug: String) -> Result<SyncStatusReport, String> {
    task::spawn_blocking(move || {
        let connection = sync::io::conn()?;

        let binding = sync::io::read_adapter_binding(&connection, &slug)?;
        let adapter_id = binding.as_ref().map(|binding| binding.adapter_id.clone());
        let sync_connection_id = binding.map(|binding| binding.connection_id);

        let pending_count = sync::io::count_by_status(&connection, &slug, OutboxStatus::Pending)?;
        let failed_count = sync::io::count_by_status(&connection, &slug, OutboxStatus::Failed)?;
        let abandoned_count =
            sync::io::count_by_status(&connection, &slug, OutboxStatus::Abandoned)?;

        let last_error = sync::io::last_error_for_project(&connection, &slug)?;
        let last_pull_at = sync::io::read_sync_cursor(&connection, &slug)?.last_pull_at;

        Ok(SyncStatusReport {
            adapter_id,
            sync_connection_id,
            last_pull_at,
            pending_count,
            failed_count,
            abandoned_count,
            last_error,
        })
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))?
}

/// Force-requeue every `failed` and `abandoned` row for `slug` so the
/// worker picks them up on the next push tick. Returns the number of
/// rows that transitioned back to `pending`.
///
/// Emits a `orgii-project-sync-status` event with `trigger = "manual"`
/// after the requeue commits, so the UI sees the count rebalance
/// without polling. The follow-up push cycle's events are independent.
#[tauri::command]
pub async fn project_sync_force_push(slug: String) -> Result<u64, String> {
    let event_slug = slug.clone();
    let count = task::spawn_blocking(move || {
        let connection = sync::io::conn()?;
        sync::io::requeue_for_project(&connection, &slug)
    })
    .await
    .map_err(|err| format!("Task join error: {}", err))??;
    sync::events::emit_status(&event_slug, SyncEventTrigger::Manual);
    Ok(count)
}

/// Run one immediate pull cycle for `slug` against its attached
/// adapter. Errors when the project isn't bound to an adapter; the UI
/// is expected to surface that as "attach an adapter first."
///
/// The pull cycle itself already emits a `pull_cycle` event for this
/// project; we additionally emit a `manual` event after the pull to
/// give the UI an explicit "force-pull just succeeded" hook the
/// status bar can flash.
#[tauri::command]
pub async fn project_sync_force_pull(slug: String) -> Result<(), String> {
    let event_slug = slug.clone();
    sync::worker::pull_one_project_by_slug(slug).await?;
    sync::events::emit_status(&event_slug, SyncEventTrigger::Manual);
    Ok(())
}

/// Snapshot every registered adapter's descriptor — what the UI shows
/// in the "attach adapter" picker. Sorted by id for stable output.
#[tauri::command]
pub async fn project_sync_list_adapters() -> Result<Vec<AdapterDescriptor>, String> {
    Ok(adapters::list_descriptors())
}

/// Read up to `limit` most-recent rows from `~/.orgii/sync-metrics.jsonl`,
/// newest first. Wraps [`sync::metrics::tail`] for the dev/debug UI;
/// production code should not call this on a hot path.
///
/// The cap is enforced server-side at 1000 to keep the IPC payload
/// bounded — if the caller asks for more, we silently return that many.
/// Reading is best-effort: if the file does not exist (no sync activity
/// yet on this machine) we return an empty list rather than error.
#[tauri::command]
pub async fn project_sync_metrics_tail(
    limit: usize,
) -> Result<Vec<sync::metrics::SyncMetric>, String> {
    let capped = limit.min(1000);
    task::spawn_blocking(move || sync::metrics::tail(capped))
        .await
        .map_err(|err| format!("Task join error: {}", err))
}
