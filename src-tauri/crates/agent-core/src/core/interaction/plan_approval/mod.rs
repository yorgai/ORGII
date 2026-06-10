//! Plan-approval manager — tracks the session's currently pending plan and
//! exposes it to the frontend for the inline "Build" button on the plan card.
//!
//! This is intentionally NOT a blocking interaction:
//!
//!   * `create_plan` writes the plan file, records a pending snapshot via
//!     `mark_ready`, and broadcasts `agent:plan_ready_for_approval`. The
//!     tool result carries a sentinel prefix so the agent turn
//!     hard-terminates immediately; the session returns to idle.
//!   * The FE shows explicit plan-card actions. Build approves the pending
//!     snapshot and re-enters Build mode through `agent_plan_approval_response`;
//!     Skip rejects the snapshot and returns the session to idle without
//!     starting another turn. Both paths broadcast `agent:exit_plan_mode` so
//!     the FE UI syncs instantly.
//!   * If the LLM produces a new plan before the user acts, the old pending
//!     entry is archived (the FE grays out the prior Build/Skip buttons).
//!   * Session cancel simply drops the pending entry silently — no error or
//!     skipped-plan lifecycle card is emitted.
//!
//! The plan flow is non-blocking: the LLM keeps streaming after
//! emitting the plan, and the user clicks Build at their own pace.
//! Restart-persistence is provided by the `persistence` sub-module
//! below.
//!
//! The pending snapshot is mirrored into `pending_plan_approvals` in the
//! shared SQLite DB so that restarting the app rehydrates the Build button
//! on the plan card. Every mutation point (`mark_ready`, `take_pending`,
//! `clear_silently`) performs its DB write inside the same `pending` mutex
//! guard that gates the in-memory mutation, so memory and DB cannot split.

use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, warn};

use chrono::TimeZone;

use core_types::session_event::{
    ActivityStatus, EventDisplayStatus, EventDisplayVariant, EventSource, SessionEvent,
};
use core_types::tool_names;

pub mod persistence;

use persistence::{PendingPlanRow, PlanApprovalStore};

/// Process-wide AppHandle for event pushes that happen outside a live
/// per-session `PlanApprovalManager` (CLI bridge resolutions, startup GC,
/// chokepoint abandons). Set once at app boot; `resolve_pending` falls back
/// to it when the manager has no handle of its own.
static GLOBAL_APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// Install the process-wide AppHandle. Called once from app setup.
pub fn install_app_handle(handle: tauri::AppHandle) {
    let _ = GLOBAL_APP_HANDLE.set(handle);
}

/// Terminal outcome for a pending plan. Every transition out of the
/// "pending" state — regardless of which surface triggered it — must go
/// through [`resolve_pending`] so the DB row, the in-memory slot, the
/// transcript card event, and the FE broadcast can never diverge.
#[derive(Debug)]
pub enum PlanResolution {
    /// User clicked Build. `edited` carries the user-modified plan body
    /// when the approval came through "approve with edits".
    Approved { edited: Option<String> },
    /// User clicked Skip.
    Rejected,
    /// A newer plan revision replaced this one (`mark_ready` on a session
    /// that already had a pending plan).
    Superseded,
    /// The user bypassed the Build button: started a Build-mode turn or
    /// switched the exec mode away from Plan while the plan was pending.
    Abandoned,
    /// Housekeeping: plan file missing, session deleted, or session no
    /// longer in plan mode (startup GC / rehydrate validation).
    Orphaned,
}

impl PlanResolution {
    fn card_status(&self) -> PlanApprovalCardStatus {
        match self {
            Self::Approved { .. } => PlanApprovalCardStatus::Approved,
            Self::Rejected => PlanApprovalCardStatus::Cancelled,
            Self::Superseded | Self::Abandoned | Self::Orphaned => PlanApprovalCardStatus::Archived,
        }
    }

    fn source_label(&self) -> &'static str {
        match self {
            Self::Approved { .. } => "approval",
            Self::Rejected => "rejection",
            Self::Superseded => "archive",
            Self::Abandoned => "abandon",
            Self::Orphaned => "orphan",
        }
    }

    fn broadcasts_archived(&self) -> bool {
        matches!(self, Self::Superseded | Self::Abandoned | Self::Orphaned)
    }
}

/// Single chokepoint for resolving a session's pending plan.
///
/// Atomically (DB row deletion is the linearization point):
///   1. Takes the in-memory snapshot from `manager` when provided (live
///      session fast path), falling back to the persisted row (post-restart
///      / CLI / GC path).
///   2. Deletes the `pending_plan_approvals` row — the authoritative state.
///   3. For `Approved { edited: Some(_) }`, persists the edited plan body
///      to the plan file before anything reads it back.
///   4. Pushes the terminal `plan_approval` transcript event (approved /
///      cancelled / archived) through the event pipeline.
///   5. Broadcasts `agent:plan_approval_archived` for Superseded /
///      Abandoned / Orphaned so a live FE un-pins immediately.
///
/// Returns the resolved snapshot, or `None` when nothing was pending.
/// Idempotent: concurrent callers race on the DB delete; only the caller
/// that observed the row (or the in-memory slot) emits events.
pub async fn resolve_pending(
    session_id: &str,
    resolution: PlanResolution,
    manager: Option<&PlanApprovalManager>,
) -> Option<PendingPlanApproval> {
    // Live-session fast path: the manager's mutex is the serialization
    // point while a session is running.
    let mut snapshot: Option<PendingPlanApproval> = None;
    if let Some(manager) = manager {
        let mut guard = manager.pending.lock().await;
        snapshot = guard.take();
    }

    if snapshot.is_none() {
        let sid = session_id.to_string();
        let loaded =
            tokio::task::spawn_blocking(move || PlanApprovalStore::load_by_session(&sid)).await;
        match loaded {
            Ok(Ok(row)) => snapshot = row.map(PendingPlanApproval::from_row),
            Ok(Err(err)) => {
                warn!("[plan_approval] resolve_pending load failed for {session_id}: {err}");
                return None;
            }
            Err(err) => {
                warn!("[plan_approval] resolve_pending join error for {session_id}: {err}");
                return None;
            }
        }
    }

    let snapshot = snapshot?;

    let sid = snapshot.session_id.clone();
    persist_blocking(move || PlanApprovalStore::delete_by_session(&sid)).await;

    if let PlanResolution::Approved {
        edited: Some(ref new_content),
    } = resolution
    {
        if let Err(err) = std::fs::write(&snapshot.plan_path, new_content.as_bytes()) {
            warn!(
                "[plan_approval] failed to persist edited plan {}: {err}",
                snapshot.plan_path
            );
        }
    }

    let app_handle = manager
        .and_then(|manager| {
            manager
                .app_handle
                .lock()
                .ok()
                .and_then(|guard| guard.clone())
        })
        .or_else(|| GLOBAL_APP_HANDLE.get().cloned());
    if let Some(handle) = app_handle {
        let mut event = build_plan_approval_event(
            &snapshot,
            resolution.source_label(),
            resolution.card_status(),
        );
        event.recompute_extracted();
        crate::bus::event_pipeline_bridge::push_events(&handle, &snapshot.session_id, vec![event]);
    }

    if resolution.broadcasts_archived() {
        crate::bus::broadcast_event(
            "agent:plan_approval_archived",
            serde_json::json!({
                "sessionId": &snapshot.session_id,
                "planPath": &snapshot.plan_path,
                "toolCallId": &snapshot.tool_call_id,
                "planId": &snapshot.plan_id,
                "planRevisionId": &snapshot.plan_revision_id,
                "reason": resolution.source_label(),
            }),
        );
    }

    info!(
        "[plan_approval] Pending plan resolved (session={}, resolution={}, path={})",
        snapshot.session_id,
        resolution.source_label(),
        snapshot.plan_path
    );

    Some(snapshot)
}

/// Read-only snapshot of the current pending plan. Broadcast on creation and
/// queryable via debug endpoints / FE re-mount.
#[derive(Debug, Clone)]
pub struct PendingPlanApproval {
    pub session_id: String,
    pub tool_call_id: Option<String>,
    pub plan_id: String,
    pub plan_revision_id: String,
    pub origin_tool_call_id: Option<String>,
    pub plan_path: String,
    pub plan_title: String,
    pub plan_content: String,
    pub created_at_ms: i64,
}

impl PendingPlanApproval {
    fn to_row(&self) -> PendingPlanRow {
        PendingPlanRow {
            session_id: self.session_id.clone(),
            tool_call_id: self.tool_call_id.clone(),
            plan_id: self.plan_id.clone(),
            plan_revision_id: self.plan_revision_id.clone(),
            origin_tool_call_id: self.origin_tool_call_id.clone(),
            plan_path: self.plan_path.clone(),
            plan_title: self.plan_title.clone(),
            plan_content: self.plan_content.clone(),
            created_at_ms: self.created_at_ms,
        }
    }

    fn from_row(row: PendingPlanRow) -> Self {
        Self {
            session_id: row.session_id,
            tool_call_id: row.tool_call_id,
            plan_id: row.plan_id,
            plan_revision_id: row.plan_revision_id,
            origin_tool_call_id: row.origin_tool_call_id,
            plan_path: row.plan_path,
            plan_title: row.plan_title,
            plan_content: row.plan_content,
            created_at_ms: row.created_at_ms,
        }
    }
}

pub struct PlanApprovalManager {
    pending: Arc<Mutex<Option<PendingPlanApproval>>>,
    app_handle: Arc<std::sync::Mutex<Option<tauri::AppHandle>>>,
}

impl PlanApprovalManager {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(Mutex::new(None)),
            app_handle: Arc::new(std::sync::Mutex::new(None)),
        }
    }

    pub fn set_app_handle(&self, app_handle: Option<tauri::AppHandle>) {
        if let Ok(mut guard) = self.app_handle.lock() {
            *guard = app_handle;
        }
    }

    fn push_plan_approval_event(
        &self,
        snapshot: &PendingPlanApproval,
        source: &str,
        status: PlanApprovalCardStatus,
    ) {
        let app_handle = self.app_handle.lock().ok().and_then(|guard| guard.clone());
        let Some(handle) = app_handle else {
            return;
        };
        let mut event = build_plan_approval_event(snapshot, source, status);
        event.recompute_extracted();
        crate::bus::event_pipeline_bridge::push_events(&handle, &snapshot.session_id, vec![event]);
    }

    /// Record a pending plan and broadcast `agent:plan_ready_for_approval`.
    ///
    /// If a previous plan was still pending we emit
    /// `agent:plan_approval_archived` so the FE can gray out the old
    /// Build button before overwriting the snapshot.
    pub async fn mark_ready(
        &self,
        session_id: &str,
        plan_path: &str,
        plan_title: &str,
        plan_content: &str,
        tool_call_id: Option<&str>,
    ) {
        let mut guard = self.pending.lock().await;

        // Superseded: a newer revision replaces the pending one. The
        // in-memory slot is the fast path; the DB fallback covers callers
        // that construct a fresh manager per registration (CLI runner) —
        // without it the previous revision's row would survive and the FE
        // would show two live Build cards.
        let prev = match guard.take() {
            Some(prev) => Some(prev),
            None => {
                let sid = session_id.to_string();
                tokio::task::spawn_blocking(move || PlanApprovalStore::load_by_session(&sid))
                    .await
                    .ok()
                    .and_then(Result::ok)
                    .flatten()
                    .map(PendingPlanApproval::from_row)
            }
        };
        if let Some(prev) = prev {
            let sid = prev.session_id.clone();
            persist_blocking(move || PlanApprovalStore::delete_by_session(&sid)).await;
            self.push_plan_approval_event(&prev, "archive", PlanApprovalCardStatus::Archived);
            let archived = serde_json::json!({
                "sessionId": &prev.session_id,
                "planPath": &prev.plan_path,
                "toolCallId": &prev.tool_call_id,
                "planId": &prev.plan_id,
                "planRevisionId": &prev.plan_revision_id,
                "reason": "archive",
            });
            crate::bus::broadcast_event("agent:plan_approval_archived", archived);
        }

        let plan_id = plan_id_for(session_id, plan_path);
        let plan_revision_id = revision_id_for(tool_call_id, &plan_id);
        let created_at_ms = chrono::Utc::now().timestamp_millis();
        let snapshot = PendingPlanApproval {
            session_id: session_id.to_string(),
            tool_call_id: Some(plan_revision_id.clone()),
            plan_id,
            plan_revision_id,
            origin_tool_call_id: tool_call_id.map(str::to_string),
            plan_path: plan_path.to_string(),
            plan_title: plan_title.to_string(),
            plan_content: plan_content.to_string(),
            created_at_ms,
        };
        let row = snapshot.to_row();
        persist_blocking(move || PlanApprovalStore::upsert(&row)).await;

        *guard = Some(snapshot.clone());
        drop(guard);

        self.push_plan_approval_event(&snapshot, "create_plan", PlanApprovalCardStatus::Pending);

        let payload = serde_json::json!({
            "sessionId": &snapshot.session_id,
            "planPath": &snapshot.plan_path,
            "planTitle": &snapshot.plan_title,
            "planContent": &snapshot.plan_content,
            "toolCallId": &snapshot.tool_call_id,
            "planId": &snapshot.plan_id,
            "planRevisionId": &snapshot.plan_revision_id,
            "originToolCallId": &snapshot.origin_tool_call_id,
            "planEventSource": "create_plan",
        });
        crate::bus::broadcast_event("agent:plan_ready_for_approval", payload);

        info!(
            "[plan_approval] Plan ready (session={}, path={})",
            snapshot.session_id, snapshot.plan_path
        );
    }

    /// Consume the pending snapshot after the user clicks Build. Returns
    /// `None` if nothing was pending (e.g. the user clicked stale button).
    ///
    /// Thin wrapper over [`resolve_pending`] — kept for call sites and tests
    /// that hold a manager reference.
    pub async fn take_pending(&self) -> Option<PendingPlanApproval> {
        resolve_pending("", PlanResolution::Approved { edited: None }, Some(self)).await
    }

    /// Consume the pending snapshot after the user skips the plan. Returns
    /// `None` if nothing was pending (e.g. the user clicked stale button).
    ///
    /// Thin wrapper over [`resolve_pending`].
    pub async fn reject_pending(&self) -> Option<PendingPlanApproval> {
        resolve_pending("", PlanResolution::Rejected, Some(self)).await
    }

    pub async fn is_pending(&self) -> bool {
        self.pending.lock().await.is_some()
    }

    /// Snapshot the pending request without consuming it. Used by debug
    /// endpoints and FE re-mount.
    pub async fn pending_snapshot(&self) -> Option<PendingPlanApproval> {
        self.pending.lock().await.clone()
    }

    /// Synchronous best-effort pending snapshot for LLM schema rendering.
    ///
    /// Tool descriptions are built through a synchronous trait method, so they
    /// cannot await `pending_snapshot()`. If the mutex is temporarily held, skip
    /// the live hint rather than blocking schema generation.
    pub fn pending_snapshot_now(&self) -> Option<PendingPlanApproval> {
        self.pending.try_lock().ok().and_then(|guard| guard.clone())
    }

    /// Silently discard the pending entry — called on session cancel /
    /// session drop. Does NOT emit a lifecycle event because a runtime cancel
    /// is not the same user action as explicitly skipping the plan.
    pub async fn clear_silently(&self) {
        let mut guard = self.pending.lock().await;
        if let Some(snap) = guard.take() {
            let sid = snap.session_id.clone();
            persist_blocking(move || PlanApprovalStore::delete_by_session(&sid)).await;
            info!("[plan_approval] Pending plan cleared silently (session cancel)");
        }
    }

    /// Load any persisted pending plan for `session_id` into the in-memory
    /// slot, and replay `agent:plan_ready_for_approval` so the frontend's
    /// existing rehydration path in `useSessionSync.ts` re-enables the Build
    /// button.
    ///
    /// Called from `agent_core::init` once per session activation (i.e. the
    /// first time the runtime is built for that session id after an app
    /// start). If the persisted plan file no longer exists on disk — the
    /// user deleted it between sessions — the row is removed and no
    /// broadcast is emitted.
    ///
    /// This must be called while no other caller can concurrently invoke
    /// `mark_ready` / `take_pending` / `clear_silently` for the same
    /// session. Per-session serialization is guaranteed by `init.rs`
    /// running this before registering the tools that would trigger those
    /// paths.
    pub async fn rehydrate_from_db(&self, session_id: &str) -> Result<(), String> {
        let sid = session_id.to_string();
        let loaded = tokio::task::spawn_blocking(move || PlanApprovalStore::load_by_session(&sid))
            .await
            .map_err(|err| format!("[plan_approval] rehydrate join error: {err}"))?
            .map_err(|err| format!("[plan_approval] rehydrate load error: {err}"))?;

        let Some(row) = loaded else {
            return Ok(());
        };

        // Validate the plan file still exists. If the user deleted it
        // between sessions there is nothing to approve, so drop the row
        // and stay silent.
        if !std::path::Path::new(&row.plan_path).exists() {
            let sid = row.session_id.clone();
            persist_blocking(move || PlanApprovalStore::delete_by_session(&sid)).await;
            info!(
                "[plan_approval] Rehydrate skipped: plan file missing (session={}, path={})",
                row.session_id, row.plan_path
            );
            return Ok(());
        }

        // Defense in depth: a pending plan is only meaningful while the
        // session is still in Plan mode. If the user switched modes (and a
        // chokepoint failed to resolve the row), archive instead of
        // resurrecting a ghost Build card.
        if session_in_plan_mode(session_id) == Some(false) {
            resolve_pending(session_id, PlanResolution::Orphaned, None).await;
            return Ok(());
        }

        let snapshot = PendingPlanApproval::from_row(row);

        let mut guard = self.pending.lock().await;
        *guard = Some(snapshot.clone());
        drop(guard);

        self.push_plan_approval_event(&snapshot, "rehydrate", PlanApprovalCardStatus::Pending);

        let payload = serde_json::json!({
            "sessionId": &snapshot.session_id,
            "planPath": &snapshot.plan_path,
            "planTitle": &snapshot.plan_title,
            "planContent": &snapshot.plan_content,
            "toolCallId": &snapshot.tool_call_id,
            "planId": &snapshot.plan_id,
            "planRevisionId": &snapshot.plan_revision_id,
            "originToolCallId": &snapshot.origin_tool_call_id,
            "planEventSource": "rehydrate",
        });
        crate::bus::broadcast_event("agent:plan_ready_for_approval", payload);

        info!(
            "[plan_approval] Rehydrated pending plan from DB (session={}, path={})",
            snapshot.session_id, snapshot.plan_path
        );
        Ok(())
    }
}

#[derive(Clone, Copy)]
enum PlanApprovalCardStatus {
    Pending,
    Archived,
    Approved,
    Cancelled,
}

impl PlanApprovalCardStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Archived => "archived",
            Self::Approved => "approved",
            Self::Cancelled => "cancelled",
        }
    }

    fn display_status(self) -> EventDisplayStatus {
        match self {
            Self::Pending => EventDisplayStatus::AwaitingUser,
            Self::Archived | Self::Approved | Self::Cancelled => EventDisplayStatus::Completed,
        }
    }
}

fn plan_id_for(session_id: &str, plan_path: &str) -> String {
    let suffix = Path::new(plan_path)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("plan")
        .replace(|character: char| !character.is_ascii_alphanumeric(), "-");
    format!("plan-{session_id}-{suffix}")
}

fn revision_id_for(tool_call_id: Option<&str>, fallback: &str) -> String {
    tool_call_id.unwrap_or(fallback).to_string()
}

fn plan_created_at_iso(snapshot: &PendingPlanApproval) -> String {
    chrono::Utc
        .timestamp_millis_opt(snapshot.created_at_ms)
        .single()
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339()
}

fn build_plan_approval_event(
    snapshot: &PendingPlanApproval,
    source: &str,
    status: PlanApprovalCardStatus,
) -> SessionEvent {
    let args = serde_json::json!({
        "title": &snapshot.plan_title,
        "content": &snapshot.plan_content,
        "planPath": &snapshot.plan_path,
        "planId": &snapshot.plan_id,
        "planRevisionId": &snapshot.plan_revision_id,
        "originToolCallId": &snapshot.origin_tool_call_id,
        "planEventSource": source,
    });
    let result = serde_json::json!({
        "status": status.as_str(),
        "planId": &snapshot.plan_id,
        "planRevisionId": &snapshot.plan_revision_id,
        "planPath": &snapshot.plan_path,
    });
    let event_id = match status {
        PlanApprovalCardStatus::Pending => snapshot.plan_revision_id.clone(),
        PlanApprovalCardStatus::Archived => format!("{}-archived", snapshot.plan_revision_id),
        PlanApprovalCardStatus::Approved => format!("{}-approved", snapshot.plan_revision_id),
        PlanApprovalCardStatus::Cancelled => format!("{}-cancelled", snapshot.plan_revision_id),
    };
    SessionEvent {
        id: event_id,
        chunk_id: None,
        session_id: snapshot.session_id.clone(),
        created_at: plan_created_at_iso(snapshot),
        function_name: tool_names::PLAN_APPROVAL.to_string(),
        ui_canonical: tool_names::PLAN_APPROVAL.to_string(),
        action_type: tool_names::PLAN_APPROVAL.to_string(),
        args,
        result,
        source: EventSource::Assistant,
        display_text: snapshot.plan_title.clone(),
        display_status: status.display_status(),
        display_variant: EventDisplayVariant::ToolCall,
        activity_status: ActivityStatus::Agent,
        thread_id: None,
        process_id: None,
        call_id: Some(snapshot.plan_revision_id.clone()),
        file_path: Some(snapshot.plan_path.clone()),
        command: None,
        is_delta: None,
        repo_id: None,
        repo_path: None,
        extracted: None,
        payload_refs: Vec::new(),
        last_extract_at: None,
    }
}

impl Default for PlanApprovalManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Run a blocking `rusqlite` call on the blocking pool, logging failures
/// instead of propagating them. Persistence errors must never block the
/// plan-approval flow — the in-memory slot is still authoritative for the
/// live session; DB sync is for cross-restart continuity only.
async fn persist_blocking<F>(f: F)
where
    F: FnOnce() -> Result<(), persistence::StoreError> + Send + 'static,
{
    let result = tokio::task::spawn_blocking(f).await;
    match result {
        Ok(Ok(())) => {}
        Ok(Err(err)) => warn!("[plan_approval] DB write failed: {err}"),
        Err(err) => warn!("[plan_approval] DB write join error: {err}"),
    }
}

/// DB-only snapshot loader used by read-only Tauri queries that must
/// answer before any in-memory `AgentSession` has been registered
/// (e.g. first window focus after an app restart — the session record
/// exists in sqlite, but the agent pipeline has not run yet so no
/// `PlanApprovalManager` lives in memory).
///
/// Mirrors the file-existence gate from
/// [`PlanApprovalManager::rehydrate_from_db`]: if the plan file is
/// missing we delete the orphan row and return `None`, so the FE stops
/// painting a Build button for a plan the user already deleted on
/// disk. Unlike the manager version this function deliberately does
/// NOT broadcast `agent:plan_ready_for_approval` — the caller is a
/// synchronous UI query and the FE atom is updated through the query
/// result, not a bus event.
pub async fn load_snapshot_for_session(
    session_id: &str,
) -> Result<Option<PendingPlanApproval>, String> {
    let sid = session_id.to_string();
    let loaded = tokio::task::spawn_blocking(move || PlanApprovalStore::load_by_session(&sid))
        .await
        .map_err(|err| format!("[plan_approval] snapshot join error: {err}"))?
        .map_err(|err| format!("[plan_approval] snapshot load error: {err}"))?;

    let Some(row) = loaded else {
        return Ok(None);
    };

    if !std::path::Path::new(&row.plan_path).exists() {
        let sid = row.session_id.clone();
        persist_blocking(move || PlanApprovalStore::delete_by_session(&sid)).await;
        info!(
            "[plan_approval] Orphan row dropped: plan file missing (session={}, path={})",
            row.session_id, row.plan_path
        );
        return Ok(None);
    }

    // Same defense-in-depth gate as `rehydrate_from_db`: a pending plan is
    // only actionable while the session is still in Plan mode.
    if session_in_plan_mode(session_id) == Some(false) {
        resolve_pending(session_id, PlanResolution::Orphaned, None).await;
        return Ok(None);
    }

    Ok(Some(PendingPlanApproval::from_row(row)))
}

/// Best-effort check whether `session_id` is currently in Plan exec mode.
///
/// Returns `Some(true)` / `Some(false)` when the session row was found in
/// either the Rust-agent (`agent_sessions`) or CLI (`code_sessions`) store,
/// and `None` when the session cannot be located or the lookup failed —
/// callers must treat `None` as "unknown, do not GC" so a transient DB
/// error can never destroy a legitimate pending plan.
fn session_in_plan_mode(session_id: &str) -> Option<bool> {
    match crate::session::persistence::get_session(session_id) {
        Ok(Some(record)) => {
            return Some(record.agent_exec_mode.as_deref() == Some("plan"));
        }
        Ok(None) => {}
        Err(err) => {
            warn!("[plan_approval] exec-mode lookup failed for {session_id}: {err}");
            return None;
        }
    }

    match crate::foundation::session_bridge::get_cli_tools_snapshot(session_id) {
        Ok(Some(snapshot)) => Some(snapshot.agent_exec_mode == "plan"),
        Ok(None) => None,
        Err(err) => {
            warn!("[plan_approval] CLI exec-mode lookup failed for {session_id}: {err}");
            None
        }
    }
}

/// Startup garbage collection for orphaned pending-plan rows.
///
/// Scans the whole `pending_plan_approvals` table once and resolves as
/// `Orphaned` every row whose:
///   * plan file no longer exists on disk, OR
///   * session row no longer exists in either session store, OR
///   * session is no longer in Plan exec mode.
///
/// Rows for sessions whose exec mode cannot be determined (`None` from
/// [`session_in_plan_mode`] with the session row present) are left alone.
/// Called once from app setup after the DB and bridges are initialized.
pub async fn gc_orphaned_pending_plans() {
    let rows = match tokio::task::spawn_blocking(PlanApprovalStore::list_all).await {
        Ok(Ok(rows)) => rows,
        Ok(Err(err)) => {
            warn!("[plan_approval] GC scan failed: {err}");
            return;
        }
        Err(err) => {
            warn!("[plan_approval] GC join error: {err}");
            return;
        }
    };

    let mut collected = 0usize;
    for row in rows {
        let file_missing = !std::path::Path::new(&row.plan_path).exists();
        let session_exists = session_row_exists(&row.session_id);
        let left_plan_mode = session_in_plan_mode(&row.session_id) == Some(false);

        if file_missing || !session_exists || left_plan_mode {
            resolve_pending(&row.session_id, PlanResolution::Orphaned, None).await;
            collected += 1;
        }
    }

    if collected > 0 {
        info!("[plan_approval] GC resolved {collected} orphaned pending plan rows");
    }
}

fn session_row_exists(session_id: &str) -> bool {
    if matches!(
        crate::session::persistence::get_session(session_id),
        Ok(Some(_))
    ) {
        return true;
    }
    matches!(
        crate::foundation::session_bridge::get_cli_tools_snapshot(session_id),
        Ok(Some(_))
    )
}

#[cfg(test)]
mod tests {
    use super::persistence::test_support::{lock_and_prepare, temp_home};
    use super::*;

    // Every manager test now hits the real sqlite DB via `mark_ready`, so
    // they all serialize on `lock_and_prepare()` — no exceptions. The lock
    // guard also clears the `pending_plan_approvals` table so each test
    // starts from a clean slate.

    #[tokio::test]
    async fn mark_ready_then_take_returns_snapshot() {
        let _lock = lock_and_prepare();
        let plan_path = temp_home().join("snapshot.plan.md");
        std::fs::write(&plan_path, "body").unwrap();
        let mgr = PlanApprovalManager::new();
        mgr.mark_ready(
            "s1",
            plan_path.to_str().unwrap(),
            "Title",
            "body",
            Some("call_1"),
        )
        .await;
        assert!(mgr.is_pending().await);
        let snap = mgr.take_pending().await.unwrap();
        assert_eq!(snap.session_id, "s1");
        assert_eq!(snap.tool_call_id.as_deref(), Some("call_1"));
        assert_eq!(snap.origin_tool_call_id.as_deref(), Some("call_1"));
        assert!(!mgr.is_pending().await);
    }

    #[tokio::test]
    async fn second_mark_ready_archives_first() {
        let _lock = lock_and_prepare();
        let plan_a = temp_home().join("a.plan.md");
        let plan_b = temp_home().join("b.plan.md");
        std::fs::write(&plan_a, "body").unwrap();
        std::fs::write(&plan_b, "body2").unwrap();
        let mgr = PlanApprovalManager::new();
        mgr.mark_ready("s1", plan_a.to_str().unwrap(), "A", "body", None)
            .await;
        mgr.mark_ready("s1", plan_b.to_str().unwrap(), "B", "body2", None)
            .await;
        let snap = mgr.pending_snapshot().await.unwrap();
        assert_eq!(snap.plan_path, plan_b.to_str().unwrap());
    }

    #[test]
    fn lifecycle_events_keep_plan_revision_creation_timestamp() {
        let snapshot = PendingPlanApproval {
            session_id: "s1".into(),
            tool_call_id: Some("call_1".into()),
            plan_id: "plan-1".into(),
            plan_revision_id: "call_1".into(),
            origin_tool_call_id: Some("call_1".into()),
            plan_path: "/tmp/plan.md".into(),
            plan_title: "Plan".into(),
            plan_content: "body".into(),
            created_at_ms: 1_700_000_000_000,
        };

        let archived =
            build_plan_approval_event(&snapshot, "archive", PlanApprovalCardStatus::Archived);
        let approved =
            build_plan_approval_event(&snapshot, "approval", PlanApprovalCardStatus::Approved);
        let rejected =
            build_plan_approval_event(&snapshot, "rejection", PlanApprovalCardStatus::Cancelled);

        assert_eq!(archived.created_at, "2023-11-14T22:13:20+00:00");
        assert_eq!(approved.created_at, archived.created_at);
        assert_eq!(rejected.created_at, archived.created_at);
        assert_eq!(archived.result["status"], "archived");
        assert_eq!(rejected.result["status"], "cancelled");
    }

    #[tokio::test]
    async fn reject_pending_drops_pending_snapshot() {
        let _lock = lock_and_prepare();
        let plan_path = temp_home().join("reject.plan.md");
        std::fs::write(&plan_path, "body").unwrap();
        let mgr = PlanApprovalManager::new();
        mgr.mark_ready("s1", plan_path.to_str().unwrap(), "T", "body", None)
            .await;
        let rejected = mgr.reject_pending().await.expect("pending plan");
        assert_eq!(rejected.plan_path, plan_path.to_str().unwrap());
        assert!(!mgr.is_pending().await);
        assert!(mgr.reject_pending().await.is_none());
    }

    #[tokio::test]
    async fn clear_silently_drops_without_panic() {
        let _lock = lock_and_prepare();
        let plan_path = temp_home().join("clear.plan.md");
        std::fs::write(&plan_path, "body").unwrap();
        let mgr = PlanApprovalManager::new();
        mgr.mark_ready("s1", plan_path.to_str().unwrap(), "T", "body", None)
            .await;
        mgr.clear_silently().await;
        assert!(!mgr.is_pending().await);
        mgr.clear_silently().await;
    }

    #[tokio::test]
    async fn mark_ready_persists_and_rehydrate_round_trip() {
        let _lock = lock_and_prepare();
        let plan_path = temp_home().join("persist.plan.md");
        std::fs::write(&plan_path, "body content").unwrap();

        let session_id = "s_persist";
        {
            let mgr = PlanApprovalManager::new();
            mgr.mark_ready(
                session_id,
                plan_path.to_str().unwrap(),
                "Title",
                "body content",
                Some("call_9"),
            )
            .await;
            assert!(mgr.is_pending().await);
        }

        let fresh = PlanApprovalManager::new();
        assert!(!fresh.is_pending().await);
        fresh.rehydrate_from_db(session_id).await.unwrap();
        let snap = fresh.pending_snapshot().await.expect("rehydrated");
        assert_eq!(snap.session_id, session_id);
        assert_eq!(snap.plan_path, plan_path.to_str().unwrap());
        assert_eq!(snap.tool_call_id.as_deref(), Some("call_9"));
        assert_eq!(snap.origin_tool_call_id.as_deref(), Some("call_9"));
    }

    #[tokio::test]
    async fn take_pending_deletes_row_so_rehydrate_is_empty() {
        let _lock = lock_and_prepare();
        let plan_path = temp_home().join("take.plan.md");
        std::fs::write(&plan_path, "body").unwrap();

        let session_id = "s_take";
        let mgr = PlanApprovalManager::new();
        mgr.mark_ready(session_id, plan_path.to_str().unwrap(), "T", "body", None)
            .await;
        let _ = mgr.take_pending().await;

        let fresh = PlanApprovalManager::new();
        fresh.rehydrate_from_db(session_id).await.unwrap();
        assert!(!fresh.is_pending().await, "row must be deleted after take");
    }

    #[tokio::test]
    async fn clear_silently_deletes_row_so_rehydrate_is_empty() {
        let _lock = lock_and_prepare();
        let plan_path = temp_home().join("clear_rehydrate.plan.md");
        std::fs::write(&plan_path, "body").unwrap();

        let session_id = "s_clear";
        let mgr = PlanApprovalManager::new();
        mgr.mark_ready(session_id, plan_path.to_str().unwrap(), "T", "body", None)
            .await;
        mgr.clear_silently().await;

        let fresh = PlanApprovalManager::new();
        fresh.rehydrate_from_db(session_id).await.unwrap();
        assert!(!fresh.is_pending().await);
    }

    #[tokio::test]
    async fn rehydrate_missing_plan_file_drops_row_silently() {
        let _lock = lock_and_prepare();
        let plan_path = temp_home().join("missing.plan.md");
        std::fs::write(&plan_path, "body").unwrap();

        let session_id = "s_missing";
        let mgr = PlanApprovalManager::new();
        mgr.mark_ready(session_id, plan_path.to_str().unwrap(), "T", "body", None)
            .await;

        std::fs::remove_file(&plan_path).unwrap();

        let fresh = PlanApprovalManager::new();
        fresh.rehydrate_from_db(session_id).await.unwrap();
        assert!(
            !fresh.is_pending().await,
            "missing file ⇒ no rehydrated snapshot"
        );

        let fresh2 = PlanApprovalManager::new();
        fresh2.rehydrate_from_db(session_id).await.unwrap();
        assert!(!fresh2.is_pending().await);
    }

    #[tokio::test]
    async fn load_snapshot_returns_row_when_file_exists() {
        let _lock = lock_and_prepare();
        let plan_path = temp_home().join("load_ok.plan.md");
        std::fs::write(&plan_path, "body").unwrap();

        let session_id = "s_load_ok";
        let mgr = PlanApprovalManager::new();
        mgr.mark_ready(
            session_id,
            plan_path.to_str().unwrap(),
            "T",
            "body",
            Some("call_x"),
        )
        .await;

        let snap = super::load_snapshot_for_session(session_id)
            .await
            .unwrap()
            .expect("snapshot present");
        assert_eq!(snap.session_id, session_id);
        assert_eq!(snap.tool_call_id.as_deref(), Some("call_x"));
        assert_eq!(snap.origin_tool_call_id.as_deref(), Some("call_x"));
    }

    #[tokio::test]
    async fn load_snapshot_drops_row_when_file_missing() {
        let _lock = lock_and_prepare();
        let plan_path = temp_home().join("load_missing.plan.md");
        std::fs::write(&plan_path, "body").unwrap();

        let session_id = "s_load_missing";
        let mgr = PlanApprovalManager::new();
        mgr.mark_ready(session_id, plan_path.to_str().unwrap(), "T", "body", None)
            .await;
        std::fs::remove_file(&plan_path).unwrap();

        assert!(super::load_snapshot_for_session(session_id)
            .await
            .unwrap()
            .is_none());

        // Second call must still return None (row was deleted, not just
        // hidden) — this is the restart-convergence invariant the Build
        // button relies on.
        assert!(super::load_snapshot_for_session(session_id)
            .await
            .unwrap()
            .is_none());
    }

    fn seed_session_row(session_id: &str, exec_mode: &str) {
        use crate::session::persistence::{upsert_session, UnifiedSessionRecord};
        let conn = database::db::get_connection().expect("test sqlite connection");
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS agent_sessions (
                session_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                model TEXT,
                account_id TEXT,
                user_input TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                session_type TEXT NOT NULL DEFAULT 'agent',
                channel TEXT,
                chat_id TEXT,
                workspace_path TEXT,
                work_item_id TEXT,
                agent_role TEXT,
                worktree_path TEXT,
                worktree_branch TEXT,
                base_branch TEXT,
                merge_status TEXT,
                project_slug TEXT,
                agent_definition_id TEXT,
                org_member_id TEXT,
                parent_session_id TEXT,
                parent_event_id TEXT,
                workspace_additional_json TEXT NOT NULL DEFAULT '{}',
                key_source TEXT NOT NULL DEFAULT 'own_key',
                agent_exec_mode TEXT,
                native_harness_type TEXT,
                draft_text TEXT,
                reply_target_event_id TEXT,
                tags_json TEXT,
                pinned INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS session_token_usage (
                session_id TEXT NOT NULL,
                total_tokens INTEGER NOT NULL DEFAULT 0
            );
            "#,
        )
        .expect("agent sessions test schema");
        crate::session::persistence::init(&conn).expect("session persistence migrations");

        let now = chrono::Utc::now().to_rfc3339();
        upsert_session(&UnifiedSessionRecord {
            session_id: session_id.to_string(),
            name: format!("{session_id} session"),
            status: "idle".to_string(),
            agent_exec_mode: Some(exec_mode.to_string()),
            created_at: now.clone(),
            updated_at: now,
            ..Default::default()
        })
        .expect("seed session row");
        crate::session::persistence::update_agent_exec_mode(session_id, exec_mode)
            .expect("seed exec mode");
    }

    #[tokio::test]
    async fn resolve_pending_abandoned_deletes_row_without_manager() {
        let _lock = lock_and_prepare();
        let plan_path = temp_home().join("abandon.plan.md");
        std::fs::write(&plan_path, "body").unwrap();

        let session_id = "s_abandon";
        let mgr = PlanApprovalManager::new();
        mgr.mark_ready(session_id, plan_path.to_str().unwrap(), "T", "body", None)
            .await;

        let snap = resolve_pending(session_id, PlanResolution::Abandoned, None)
            .await
            .expect("pending resolved");
        assert_eq!(snap.session_id, session_id);

        // Row gone — second resolve is a no-op, rehydrate finds nothing.
        assert!(resolve_pending(session_id, PlanResolution::Abandoned, None)
            .await
            .is_none());
        assert!(super::load_snapshot_for_session(session_id)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn resolve_pending_approved_with_edits_writes_plan_file() {
        let _lock = lock_and_prepare();
        let plan_path = temp_home().join("edit.plan.md");
        std::fs::write(&plan_path, "original").unwrap();

        let session_id = "s_edit";
        let mgr = PlanApprovalManager::new();
        mgr.mark_ready(
            session_id,
            plan_path.to_str().unwrap(),
            "T",
            "original",
            None,
        )
        .await;

        let snap = resolve_pending(
            session_id,
            PlanResolution::Approved {
                edited: Some("edited body".to_string()),
            },
            Some(&mgr),
        )
        .await
        .expect("approved");
        assert_eq!(snap.session_id, session_id);
        assert_eq!(std::fs::read_to_string(&plan_path).unwrap(), "edited body");
        assert!(!mgr.is_pending().await);
    }

    #[tokio::test]
    async fn rehydrate_archives_row_when_session_left_plan_mode() {
        let _lock = lock_and_prepare();
        let plan_path = temp_home().join("left_plan_mode.plan.md");
        std::fs::write(&plan_path, "body").unwrap();

        let session_id = "s_left_plan";
        seed_session_row(session_id, "build");
        let mgr = PlanApprovalManager::new();
        mgr.mark_ready(session_id, plan_path.to_str().unwrap(), "T", "body", None)
            .await;

        let fresh = PlanApprovalManager::new();
        fresh.rehydrate_from_db(session_id).await.unwrap();
        assert!(
            !fresh.is_pending().await,
            "session in build mode must not resurrect a pending plan"
        );
        assert!(super::load_snapshot_for_session(session_id)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn rehydrate_keeps_row_when_session_still_in_plan_mode() {
        let _lock = lock_and_prepare();
        let plan_path = temp_home().join("still_plan_mode.plan.md");
        std::fs::write(&plan_path, "body").unwrap();

        let session_id = "s_still_plan";
        seed_session_row(session_id, "plan");
        let mgr = PlanApprovalManager::new();
        mgr.mark_ready(session_id, plan_path.to_str().unwrap(), "T", "body", None)
            .await;

        let fresh = PlanApprovalManager::new();
        fresh.rehydrate_from_db(session_id).await.unwrap();
        assert!(fresh.is_pending().await);
    }

    #[tokio::test]
    async fn gc_collects_orphans_and_keeps_live_plan_mode_rows() {
        let _lock = lock_and_prepare();

        // Live: session in plan mode, file exists → must survive GC.
        // One manager per session — mirrors production (PlanApprovalManager
        // is per-session; mark_ready's supersede path assumes same-session).
        let live_path = temp_home().join("gc_live.plan.md");
        std::fs::write(&live_path, "body").unwrap();
        seed_session_row("s_gc_live", "plan");
        PlanApprovalManager::new()
            .mark_ready("s_gc_live", live_path.to_str().unwrap(), "T", "body", None)
            .await;

        // Orphan A: file deleted.
        let gone_path = temp_home().join("gc_gone.plan.md");
        std::fs::write(&gone_path, "body").unwrap();
        seed_session_row("s_gc_gone", "plan");
        PlanApprovalManager::new()
            .mark_ready("s_gc_gone", gone_path.to_str().unwrap(), "T", "body", None)
            .await;
        std::fs::remove_file(&gone_path).unwrap();

        // Orphan B: session left plan mode.
        let stale_path = temp_home().join("gc_stale.plan.md");
        std::fs::write(&stale_path, "body").unwrap();
        seed_session_row("s_gc_stale", "build");
        PlanApprovalManager::new()
            .mark_ready(
                "s_gc_stale",
                stale_path.to_str().unwrap(),
                "T",
                "body",
                None,
            )
            .await;

        // Orphan C: session row does not exist at all.
        let no_session_path = temp_home().join("gc_no_session.plan.md");
        std::fs::write(&no_session_path, "body").unwrap();
        PlanApprovalManager::new()
            .mark_ready(
                "s_gc_no_session",
                no_session_path.to_str().unwrap(),
                "T",
                "body",
                None,
            )
            .await;

        gc_orphaned_pending_plans().await;

        let remaining = PlanApprovalStore::list_all().unwrap();
        let remaining_ids: Vec<&str> = remaining
            .iter()
            .map(|row| row.session_id.as_str())
            .collect();
        assert_eq!(remaining_ids, vec!["s_gc_live"]);
    }
}
