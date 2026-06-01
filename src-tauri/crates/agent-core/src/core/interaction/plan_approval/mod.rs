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

        if let Some(prev) = guard.as_ref() {
            self.push_plan_approval_event(prev, "archive", PlanApprovalCardStatus::Archived);
            let archived = serde_json::json!({
                "sessionId": &prev.session_id,
                "planPath": &prev.plan_path,
                "toolCallId": &prev.tool_call_id,
                "planId": &prev.plan_id,
                "planRevisionId": &prev.plan_revision_id,
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
    pub async fn take_pending(&self) -> Option<PendingPlanApproval> {
        let mut guard = self.pending.lock().await;
        let taken = guard.take();
        if let Some(ref snap) = taken {
            let sid = snap.session_id.clone();
            persist_blocking(move || PlanApprovalStore::delete_by_session(&sid)).await;
            self.push_plan_approval_event(snap, "approval", PlanApprovalCardStatus::Approved);
        }
        taken
    }

    /// Consume the pending snapshot after the user skips the plan. Returns
    /// `None` if nothing was pending (e.g. the user clicked stale button).
    pub async fn reject_pending(&self) -> Option<PendingPlanApproval> {
        let mut guard = self.pending.lock().await;
        let taken = guard.take();
        if let Some(ref snap) = taken {
            let sid = snap.session_id.clone();
            persist_blocking(move || PlanApprovalStore::delete_by_session(&sid)).await;
            self.push_plan_approval_event(snap, "rejection", PlanApprovalCardStatus::Cancelled);
        }
        taken
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

pub fn push_plan_approval_resolution_event(
    app_handle: &tauri::AppHandle,
    snapshot: &PendingPlanApproval,
    rejected: bool,
) {
    let (source, status) = if rejected {
        ("rejection", PlanApprovalCardStatus::Cancelled)
    } else {
        ("approval", PlanApprovalCardStatus::Approved)
    };
    let mut event = build_plan_approval_event(snapshot, source, status);
    event.recompute_extracted();
    crate::bus::event_pipeline_bridge::push_events(app_handle, &snapshot.session_id, vec![event]);
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

    Ok(Some(PendingPlanApproval::from_row(row)))
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
}
