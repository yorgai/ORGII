//! Tauri event bridge for sync state.
//!
//! Lets the frontend subscribe to live outbox-state changes instead of
//! polling [`crate::projects::commands::sync::project_sync_status`].
//! Whenever the worker finishes processing a row for a project (push,
//! merge, pull), or a manual force command runs, [`emit_status`] reads
//! the same outbox snapshot the polling command would return and pushes
//! it to every webview as a [`SYNC_STATUS_EVENT`] payload.
//!
//! # AppHandle storage
//!
//! Mirrors the canonical `OnceLock<tauri::AppHandle>` pattern used in
//! `agent_core::core::session::wingman::bar_native`: the handle is
//! stored once at app boot via [`init_emitter`] and never
//! reassigned. [`emit_status`] silently no-ops when the handle hasn't
//! been set yet — that keeps unit tests (which never spin up a Tauri
//! runtime) from crashing while still delivering events in production.
//!
//! # Failure handling
//!
//! `emit_status` never returns an error to its callers. The worker's
//! cycles are the source of truth for outbox progress; an event-sink
//! failure (a closed webview, a serde hiccup) must not roll back the
//! cycle. Failures are logged at `warn!` and dropped.

use std::sync::OnceLock;

use serde::Serialize;
use tauri::Emitter;
use tracing::warn;

use super::io;
use super::types::OutboxStatus;

/// Tauri event channel name. Frontend listens via
/// `subscribeSyncStatus()` in `src/api/http/project/sync.ts`.
pub const SYNC_STATUS_EVENT: &str = "orgii-project-sync-status";

/// Process-wide handle to the running Tauri app. Set once at boot from
/// [`crate::lib::run`]; read on every emit. The `OnceLock` is the same
/// pattern adopted by other `AppHandle`-needing modules in this crate.
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Why the worker emitted a status update — lets the UI distinguish
/// "the user just clicked Force Push" from "a background tick fired".
///
/// Wire format is `snake_case` to match every other serde enum in the
/// sync module (see [`super::types::OutboxOp`] / [`OutboxStatus`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncEventTrigger {
    /// One outbox row was claimed and resolved by the push cycle.
    PushCycle,
    /// One pull cycle finished for this project (coalesced — one event
    /// regardless of how many `merge_external` rows were appended).
    PullCycle,
    /// One `merge_external` row was claimed and resolved by the merge
    /// cycle (resolver verdict applied or skipped).
    MergeCycle,
    /// A manual `project_sync_force_push` / `project_sync_force_pull`
    /// command finished. The same per-project counts get sent so the
    /// UI can refresh without invoking `project_sync_status`.
    Manual,
}

/// Wire payload for [`SYNC_STATUS_EVENT`]. Mirrors the polled
/// `SyncStatusReport` the frontend already understands, with the
/// project slug + trigger added so multiple projects' events can be
/// disambiguated client-side.
///
/// Counts are `i64` (not `u64`) to keep the JSON wire format compatible
/// with TypeScript's safe-integer `number` for all reasonable outbox
/// sizes. Negative values are unreachable — `count_by_status` clamps
/// at zero before returning.
#[derive(Debug, Clone, Serialize)]
pub struct SyncStatusEvent {
    pub project_slug: String,
    pub adapter_id: Option<String>,
    pub sync_connection_id: Option<String>,
    pub last_pull_at: Option<i64>,
    pub pending_count: i64,
    pub failed_count: i64,
    pub abandoned_count: i64,
    pub last_error: Option<String>,
    pub trigger: SyncEventTrigger,
}

/// Install the process-wide `AppHandle`. Called once from
/// `crate::lib::run` after `tauri::Builder::setup` hands us a handle.
///
/// Idempotent: a second call is silently ignored (the OnceLock
/// guarantees only the first set wins). Duplicate calls would only
/// happen in tests that spin up multiple Tauri shells in one process,
/// which we don't do.
pub fn init_emitter(handle: tauri::AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

/// Build a [`SyncStatusEvent`] from the live outbox + project rows.
/// Uses exactly the same calls as [`crate::projects::commands::sync::project_sync_status`]
/// so the event payload is byte-identical to a fresh poll.
///
/// Error case (DB unavailable mid-cycle) is logged + dropped: the
/// caller is in a worker cycle that already finalized the outbox row,
/// and we'd rather lose one notification than poison the cycle.
fn build_event(project_slug: &str, trigger: SyncEventTrigger) -> Result<SyncStatusEvent, String> {
    let connection = io::conn()?;

    let binding = io::read_adapter_binding(&connection, project_slug)?;
    let adapter_id = binding.as_ref().map(|binding| binding.adapter_id.clone());
    let sync_connection_id = binding.map(|binding| binding.connection_id);

    let pending_count = io::count_by_status(&connection, project_slug, OutboxStatus::Pending)?;
    let failed_count = io::count_by_status(&connection, project_slug, OutboxStatus::Failed)?;
    let abandoned_count = io::count_by_status(&connection, project_slug, OutboxStatus::Abandoned)?;

    let last_error = io::last_error_for_project(&connection, project_slug)?;
    let last_pull_at = io::read_sync_cursor(&connection, project_slug)?.last_pull_at;

    Ok(SyncStatusEvent {
        project_slug: project_slug.to_string(),
        adapter_id,
        sync_connection_id,
        last_pull_at,
        pending_count: pending_count as i64,
        failed_count: failed_count as i64,
        abandoned_count: abandoned_count as i64,
        last_error,
        trigger,
    })
}

/// Snapshot the current outbox state for `project_slug` and emit a
/// [`SYNC_STATUS_EVENT`] to every webview.
///
/// Never returns an error and never panics:
/// - missing `AppHandle` (e.g. unit tests) → silent no-op.
/// - DB read failure → `warn!` + drop.
/// - emit failure (serde error, no listeners) → `warn!` + drop.
///
/// Safe to call from any async context; the work is light (a handful
/// of single-row SQLite reads) so we run it inline rather than going
/// through `spawn_blocking` — the worker is already on a blocking-safe
/// runtime when it fires this.
///
/// **Test trade-off.** The unit-test build does not have access to a
/// real `tauri::AppHandle`, so we cannot exercise the actual webview
/// emit path inline. Instead a `#[cfg(test)]` probe records every
/// `(project_slug, trigger)` invocation into [`test_probe::record`]
/// before the AppHandle check, so worker tests can assert the helper
/// fires once per project per cycle without attempting a real emit.
/// Production builds skip the probe entirely (zero overhead).
pub fn emit_status(project_slug: &str, trigger: SyncEventTrigger) {
    #[cfg(test)]
    test_probe::record(project_slug, trigger);

    let Some(handle) = APP_HANDLE.get() else {
        return;
    };
    let event = match build_event(project_slug, trigger) {
        Ok(event) => event,
        Err(err) => {
            warn!(
                "[sync::events] failed to build status event for project '{}': {}",
                project_slug, err
            );
            return;
        }
    };
    if let Err(err) = handle.emit(SYNC_STATUS_EVENT, &event) {
        warn!(
            "[sync::events] failed to emit '{}' for project '{}': {}",
            SYNC_STATUS_EVENT, project_slug, err
        );
    }
}

/// Test-only call recorder so worker tests can verify
/// [`emit_status`] fired the expected number of times per project per
/// cycle without spinning up a real Tauri shell.
///
/// `pub(crate)` because the worker tests reach into it via
/// `super::events::test_probe`. Production builds compile this module
/// out entirely.
#[cfg(test)]
pub(crate) mod test_probe {
    use std::sync::Mutex;

    use super::SyncEventTrigger;

    /// Each entry is a `(project_slug, trigger)` pair captured at the
    /// top of `emit_status`. Tests reset this between scenarios via
    /// [`reset`].
    static CALLS: Mutex<Vec<(String, SyncEventTrigger)>> = Mutex::new(Vec::new());

    pub(crate) fn record(project_slug: &str, trigger: SyncEventTrigger) {
        let mut guard = CALLS.lock().expect("test probe poisoned");
        guard.push((project_slug.to_string(), trigger));
    }

    /// Snapshot every call recorded since the last [`reset`].
    pub(crate) fn snapshot() -> Vec<(String, SyncEventTrigger)> {
        CALLS.lock().expect("test probe poisoned").clone()
    }

    /// Clear the recorded calls. Tests call this in their setup so the
    /// process-global probe doesn't leak state across scenarios.
    pub(crate) fn reset() {
        CALLS.lock().expect("test probe poisoned").clear();
    }
}

#[cfg(test)]
mod tests {
    //! These tests cover the parts of the events module that are
    //! exercisable without a live Tauri shell:
    //! - [`emit_status`] is a no-op when `APP_HANDLE` was never set
    //!   (the production-test gating contract).
    //! - The serde payload uses `snake_case` for the trigger discriminant
    //!   so the TypeScript `SyncStatusEvent` type lines up.
    //!
    //! End-to-end emission is deliberately not tested here — the
    //! integration would require a real `AppHandle`, which `tauri::test`
    //! doesn't ship in our build configuration. The worker tests below
    //! cover the call-site wiring (each cycle calls `emit_status`); the
    //! actual delivery is verified manually against the running app.

    use super::*;

    #[test]
    fn emit_status_is_noop_without_app_handle() {
        // Under `cargo test --lib` the `APP_HANDLE` OnceLock is never
        // initialized (no Tauri runtime), so this call must not panic
        // and must not produce an error visible to callers. The whole
        // worker test suite relies on this contract.
        emit_status("anything", SyncEventTrigger::PushCycle);
    }

    #[test]
    fn trigger_serializes_snake_case() {
        let push = serde_json::to_string(&SyncEventTrigger::PushCycle).unwrap();
        let pull = serde_json::to_string(&SyncEventTrigger::PullCycle).unwrap();
        let merge = serde_json::to_string(&SyncEventTrigger::MergeCycle).unwrap();
        let manual = serde_json::to_string(&SyncEventTrigger::Manual).unwrap();
        assert_eq!(push, "\"push_cycle\"");
        assert_eq!(pull, "\"pull_cycle\"");
        assert_eq!(merge, "\"merge_cycle\"");
        assert_eq!(manual, "\"manual\"");
    }

    #[test]
    fn event_payload_serializes_with_expected_field_names() {
        let event = SyncStatusEvent {
            project_slug: "alpha".to_string(),
            adapter_id: Some("echo".to_string()),
            sync_connection_id: Some("connection-echo".to_string()),
            last_pull_at: Some(1_700_000_000_000),
            pending_count: 1,
            failed_count: 0,
            abandoned_count: 0,
            last_error: None,
            trigger: SyncEventTrigger::PushCycle,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["project_slug"], "alpha");
        assert_eq!(json["adapter_id"], "echo");
        assert_eq!(json["sync_connection_id"], "connection-echo");
        assert_eq!(json["last_pull_at"], 1_700_000_000_000_i64);
        assert_eq!(json["pending_count"], 1);
        assert_eq!(json["failed_count"], 0);
        assert_eq!(json["abandoned_count"], 0);
        assert!(json["last_error"].is_null());
        assert_eq!(json["trigger"], "push_cycle");
    }
}
