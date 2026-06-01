//! Agent application state — single Tauri managed state for all agents.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

use crate::bus::AgentMessageBus;
use crate::gateway::{BindingStore, GatewayService};
use shared_state::{AgentBrowserController, ScreenshotStore};

use super::integrations_store::IntegrationsStore;
use super::session_runtime::AgentSession;
use crate::session::prompt::cache::PromptCacheInvalidationReason;

/// How long a session may sit idle in memory before the cleanup task evicts it.
const SESSION_IDLE_EVICTION_TIMEOUT: Duration = Duration::from_secs(60 * 60); // 1 hour

/// How often the cleanup task scans for idle sessions.
const SESSION_CLEANUP_INTERVAL: Duration = Duration::from_secs(60); // 1 minute

/// Agent application state — the single source of truth for all agent state.
///
/// Per-session sub-resources (runtime, managers, locks) now live inside
/// `AgentSession` itself.  There are no parallel HashMaps duplicating that
/// information; callers retrieve `Arc<AgentSession>` from `sessions` and
/// access everything through the session object.
#[derive(Clone)]
pub struct AgentAppState {
    // ═══════════════════════════════════════════════════════════════
    // Shared Resources (used by all agents)
    // ═══════════════════════════════════════════════════════════════
    /// Gateway service for external channel routing.
    pub gateway: Arc<GatewayService>,

    /// Gateway session binding cache. Pins
    /// `(channel, chat_id[, sender_id])` to a specific OS agent session so
    /// follow-up messages route directly to the bound session.
    pub gateway_bindings: Arc<BindingStore>,

    /// Pending user-facing reset/fork notices keyed by `{channel}:{chat_id}`.
    ///
    /// Written by `perform_idle_reset` and `compact_fork`
    ///; drained on the next outbound message to the same
    /// chat so the user learns their session was replaced. Hermes
    /// parallel: `gateway/run.py:3519-3551` posts the notification
    /// eagerly — we defer until the next outbound because our reset
    /// fires from the inbound path (before any LLM turn), so there is
    /// no reply channel at that moment.
    pub pending_reset_notifies: Arc<Mutex<HashMap<String, String>>>,

    /// Bounded E2E-only outbound capture buffer (debug builds only).
    /// Populated by `bus.publish_outbound` wrappers in debug code paths
    /// so `/test/gateway/outbound-snapshot` can assert on the reset-notice
    /// / compact-fork content without racing the actual channel delivery.
    /// Stores `(channel, chat_id, content)` tuples; capped at 128 entries.
    #[cfg(debug_assertions)]
    pub debug_outbound_capture: Arc<Mutex<Vec<(String, String, String)>>>,

    /// Agent browser automation controller.
    pub agent_browser: Arc<Mutex<AgentBrowserController>>,

    /// Screenshot store (shared across browser tools).
    pub screenshot_store: Arc<ScreenshotStore>,

    /// IDE action bridge for frontend ActionSystem integration.
    pub action_bridge: Arc<crate::tools::impls::web::control_orgii::ActionBridge>,

    /// Shared PTY sessions (for terminal tools).
    pub pty_sessions: Option<
        Arc<
            tauri::async_runtime::Mutex<HashMap<String, ::terminal::pty_commands::pty::PtySession>>,
        >,
    >,

    /// Tauri app handle.
    pub app_handle: Option<tauri::AppHandle>,

    // ═══════════════════════════════════════════════════════════════
    // Channel / Gateway Infrastructure (message bus, config, automation)
    // ═══════════════════════════════════════════════════════════════
    /// Agent message bus for channel/gateway routing.
    pub bus: Arc<Mutex<AgentMessageBus>>,

    /// App-level integrations store (the integrations-store contract (§11.7)). Single source of
    /// truth for `~/.orgii/integrations.json` — channels, exec, web
    /// search, default workspace, etc.
    pub integrations: Arc<IntegrationsStore>,
    // ═══════════════════════════════════════════════════════════════
    // Per-Session Registry
    // ═══════════════════════════════════════════════════════════════
    /// Active agent sessions. Key = session_id.
    ///
    /// Each `AgentSession` owns all its sub-resources (runtime, cancel_flag,
    /// permission_manager, question_manager, mode_switch_manager,
    /// processing_lock, compaction).  Do NOT add parallel maps here.
    pub sessions: Arc<Mutex<HashMap<String, Arc<AgentSession>>>>,

    /// Current account ID (for provider reinitialization detection).
    pub current_account_id: Arc<Mutex<Option<String>>>,

    /// Whether the global agent (OS/Gateway) is initialized and running.
    pub running: Arc<AtomicBool>,
}

impl AgentAppState {
    /// Create a new agent application state.
    pub fn new() -> Self {
        Self::with_browser(
            Arc::new(Mutex::new(AgentBrowserController::new())),
            Arc::new(ScreenshotStore::new()),
        )
    }

    /// Create with an existing agent browser controller and screenshot store.
    pub fn with_browser(
        agent_browser: Arc<Mutex<AgentBrowserController>>,
        screenshot_store: Arc<ScreenshotStore>,
    ) -> Self {
        // Clean up stale session registry files from a previous crash
        crate::session::file_registry::cleanup_stale_sessions(&[]);

        // Mark any DB sessions stuck in "running" (from a prior crash) as abandoned
        // so the frontend doesn't show phantom active sessions on reload.
        match crate::session::persistence::mark_stale_running_sessions_abandoned() {
            Ok(0) => {}
            Ok(n) => info!(
                "[agent-state] Marked {} stale running session(s) as abandoned on startup",
                n
            ),
            Err(err) => warn!(
                "[agent-state] Failed to clean stale sessions on startup: {}",
                err
            ),
        }

        // Transition any Agent Org runs that were `running` when the previous
        // process exited to `paused`. Their member sessions are now `abandoned`
        // (see above), so `reconcile_if_terminal` would auto-terminate the run
        // if it remained `running`. By moving to `paused` instead, the run stays
        // visible (non-terminal) and can be resumed from the UI.
        match crate::coordination::agent_org_runs::AgentOrgRunStore::mark_all_running_as_paused_on_startup() {
            Ok(0) => {}
            Ok(n) => info!(
                "[agent-state] Paused {} Agent Org run(s) interrupted by app exit",
                n
            ),
            Err(err) => warn!(
                "[agent-state] Failed to pause interrupted Agent Org runs on startup: {}",
                err
            ),
        }

        // Clear all active member interventions: their sessions are now `abandoned`
        // so the 3-minute TTL window is no longer meaningful. Clearing eagerly
        // prevents the AgentOrgInterventionPinBar from reappearing after restart.
        match crate::coordination::agent_member_interventions::AgentMemberInterventionStore::clear_all_active_on_startup() {
            Ok(0) => {}
            Ok(n) => info!(
                "[agent-state] Cleared {} stale member intervention(s) on startup",
                n
            ),
            Err(err) => warn!(
                "[agent-state] Failed to clear stale member interventions on startup: {}",
                err
            ),
        }

        let bus = Arc::new(Mutex::new(AgentMessageBus::new()));
        let sessions: Arc<Mutex<HashMap<String, Arc<AgentSession>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let state = Self {
            gateway: Arc::new(GatewayService::new(Arc::clone(&bus))),
            gateway_bindings: Arc::new(BindingStore::new()),
            pending_reset_notifies: Arc::new(Mutex::new(HashMap::new())),
            #[cfg(debug_assertions)]
            debug_outbound_capture: Arc::new(Mutex::new(Vec::new())),
            agent_browser,
            screenshot_store,
            action_bridge: Arc::new(crate::tools::impls::web::control_orgii::ActionBridge::new()),
            pty_sessions: None,
            app_handle: None,
            bus,
            integrations: Arc::new(IntegrationsStore::new()),
            sessions: Arc::clone(&sessions),
            current_account_id: Arc::new(Mutex::new(None)),
            running: Arc::new(AtomicBool::new(false)),
        };

        state.spawn_cleanup_task(sessions);
        state
    }

    /// Spawn a background task that evicts sessions idle longer than
    /// `SESSION_IDLE_EVICTION_TIMEOUT`.  Singleton (OS) sessions are never
    /// evicted — they must be explicitly removed.
    fn spawn_cleanup_task(&self, sessions: Arc<Mutex<HashMap<String, Arc<AgentSession>>>>) {
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(SESSION_CLEANUP_INTERVAL);
            loop {
                ticker.tick().await;

                let mut expired_ids = Vec::new();
                {
                    let guard = sessions.lock().await;
                    for (id, session) in guard.iter() {
                        if session.is_singleton() {
                            continue;
                        }
                        let idle = session.idle_duration().await;
                        if idle >= SESSION_IDLE_EVICTION_TIMEOUT {
                            expired_ids.push(id.clone());
                        }
                    }
                }

                if !expired_ids.is_empty() {
                    let mut guard = sessions.lock().await;
                    for id in &expired_ids {
                        guard.remove(id);
                        debug!("[agent-state] Evicted idle session: {}", id);
                        // Notify the frontend so it can clear any stale
                        // "running" status for this session.
                        crate::bus::broadcast_event(
                            "agent:session_evicted",
                            serde_json::json!({ "sessionId": id }),
                        );
                    }
                    info!(
                        "[agent-state] Cleanup task evicted {} idle session(s)",
                        expired_ids.len()
                    );
                }
            }
        });
    }

    /// Set the shared PTY sessions (called during Tauri setup).
    pub fn set_pty_sessions(
        &mut self,
        sessions: Arc<
            tauri::async_runtime::Mutex<HashMap<String, ::terminal::pty_commands::pty::PtySession>>,
        >,
    ) {
        self.pty_sessions = Some(sessions);
    }

    /// Set the Tauri app handle (called during Tauri setup).
    pub fn set_app_handle(&mut self, handle: tauri::AppHandle) {
        self.app_handle = Some(handle);
    }

    // ═══════════════════════════════════════════════════════════════
    // Session registry
    // ═══════════════════════════════════════════════════════════════

    /// Retrieve an active session by ID.
    pub async fn get_session(&self, session_id: &str) -> Option<Arc<AgentSession>> {
        let sessions = self.sessions.lock().await;
        sessions.get(session_id).cloned()
    }

    /// Register a new session and return the shared `Arc`.
    pub async fn register_session(&self, session: AgentSession) -> Arc<AgentSession> {
        let session_arc = Arc::new(session);
        let mut sessions = self.sessions.lock().await;
        sessions.insert(session_arc.id.clone(), Arc::clone(&session_arc));
        session_arc
    }

    /// Remove a session from the registry (full teardown).
    pub async fn remove_session(&self, session_id: &str) {
        let mut sessions = self.sessions.lock().await;
        sessions.remove(session_id);
        info!("[agent-state] Removed session: {}", session_id);
    }

    /// Invalidate the runtime attached to a session, forcing re-initialization
    /// on the next request.
    pub async fn invalidate_session(&self, session_id: &str) {
        if let Some(session) = self.get_session(session_id).await {
            *session.runtime.write().await = None;
            info!("[agent-state] Invalidated session runtime: {}", session_id);
        }
    }

    /// Invalidate prompt-cache state for every active session.
    pub async fn invalidate_prompt_caches(&self, reason: PromptCacheInvalidationReason) {
        let sessions = {
            let sessions = self.sessions.lock().await;
            sessions.values().cloned().collect::<Vec<_>>()
        };
        for session in &sessions {
            session.invalidate_prompt_cache(reason).await;
        }
        if !sessions.is_empty() {
            info!(
                "[agent-state] Invalidated prompt cache state for {} active session(s): {}",
                sessions.len(),
                reason.as_str()
            );
        }
    }

    /// Invalidate prompt-cache state for active sessions backed by a specific agent definition.
    pub async fn invalidate_prompt_caches_for_agent_definition(
        &self,
        definition_id: &str,
        reason: PromptCacheInvalidationReason,
    ) {
        let sessions = {
            let sessions = self.sessions.lock().await;
            sessions.values().cloned().collect::<Vec<_>>()
        };
        let mut count = 0usize;
        for session in &sessions {
            let applies_to_session_definition = session.definition.id == definition_id;
            let applies_to_runtime_definition = session
                .runtime
                .read()
                .await
                .as_ref()
                .and_then(|runtime| runtime.agent_definition_id.as_deref())
                == Some(definition_id);
            if applies_to_session_definition || applies_to_runtime_definition {
                session.invalidate_prompt_cache(reason).await;
                count += 1;
            }
        }
        if count > 0 {
            info!(
                "[agent-state] Invalidated prompt cache state for {} active session(s) using {}: {}",
                count,
                definition_id,
                reason.as_str()
            );
        }
    }

    /// Invalidate runtimes for all sessions whose IDs start with any of the
    /// given prefixes.
    pub async fn invalidate_sessions_by_prefixes(&self, prefixes: &[&str]) {
        let sessions = self.sessions.lock().await;
        let mut count = 0usize;
        for (id, session) in sessions.iter() {
            if prefixes.iter().any(|p| id.starts_with(p)) {
                *session.runtime.write().await = None;
                count += 1;
            }
        }
        if count > 0 {
            info!(
                "[agent-state] Invalidated {} session runtime(s) (prefixes: {:?})",
                count, prefixes
            );
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // Cancel / lifecycle helpers
    // ═══════════════════════════════════════════════════════════════

    /// Signal cancellation for a session.
    ///
    /// Delegates to `AgentSession::cancel_active_turn` which cancels the
    /// in-flight `DialogTurn` (if any) via the shared `cancel_flag`.
    pub async fn cancel_session(
        &self,
        session_id: &str,
        reason: crate::state::control_flow::CancelReason,
    ) -> bool {
        if let Some(session) = self.get_session(session_id).await {
            session.cancel_active_turn(reason).await;
            info!(
                "[agent-state] Cancelled active turn for session: {} (reason={})",
                session_id,
                reason.as_str()
            );
            true
        } else {
            warn!("[agent-state] Session not found for cancel: {}", session_id);
            false
        }
    }

    /// Scenario A rollback: if the most recently sent user message has NOT
    /// yet produced any assistant output (no assistant / tool_call / tool_result
    /// row in `agent_messages` with a higher sequence), remove that trailing
    /// user row and its mirror in `events`.
    ///
    /// Safe to call unconditionally: the no-output check happens inside, and
    /// any error is swallowed with a warning so cancel remains best-effort.
    pub async fn rollback_last_user_turn_if_no_output(&self, session_id: &str) {
        let sid = session_id.to_string();
        let result = tokio::task::spawn_blocking(move || {
            rollback_last_user_turn_if_no_output_blocking(&sid)
        })
        .await;

        match result {
            Ok(Ok(true)) => {
                info!(
                    "[agent-state] Rolled back pre-output user turn for {}",
                    session_id
                );
            }
            Ok(Ok(false)) => {
                debug!(
                    "[agent-state] Rollback skipped for {}: turn already had output",
                    session_id
                );
            }
            Ok(Err(err)) => {
                warn!("[agent-state] Rollback failed for {}: {}", session_id, err);
            }
            Err(err) => {
                warn!(
                    "[agent-state] Rollback task panicked for {}: {}",
                    session_id, err
                );
            }
        }
    }

    /// List all active session IDs.
    pub async fn list_sessions(&self) -> Vec<String> {
        let sessions = self.sessions.lock().await;
        sessions.keys().cloned().collect()
    }

    // ═══════════════════════════════════════════════════════════════
    // Global flags
    // ═══════════════════════════════════════════════════════════════

    /// Check if the global agent (OS/Gateway) is running.
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Check if the gateway is running (delegates to GatewayService).
    pub fn is_gateway_running(&self) -> bool {
        self.gateway.is_running()
    }
}

impl Default for AgentAppState {
    fn default() -> Self {
        Self::new()
    }
}

/// Rollback the last user row (and any trailing rows) from `agent_messages`
/// and `events` iff the latest user message in this session has no
/// following assistant / tool_call / tool_result row.
///
/// Returns `Ok(true)` if a rollback actually ran, `Ok(false)` if the turn
/// had already produced output (Scenario B — leave it alone), and `Err`
/// for SQLite failures.
fn rollback_last_user_turn_if_no_output_blocking(session_id: &str) -> Result<bool, String> {
    use crate::core::session::persistence as unified_persistence;
    use crate::foundation::session_bridge;
    use crate::persistence::db_helpers::message_role;
    use database::db::get_connection;
    use rusqlite::OptionalExtension;

    // 1. Look up the most-recent user message's sequence.
    //
    // `optional()` distinguishes `QueryReturnedNoRows` (legitimate
    // "session has no user messages yet" → `Ok(false)` per the
    // contract above) from a real SQLite error, which now bubbles up
    // instead of getting collapsed into the same "no user message"
    // branch via the previous `.ok()`.
    let last_user_seq: i64 = {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let row: Option<i64> = conn
            .query_row(
                "SELECT sequence FROM agent_messages
                 WHERE session_id = ?1 AND role = ?2
                 ORDER BY sequence DESC LIMIT 1",
                rusqlite::params![session_id, message_role::USER],
                |row| row.get(0),
            )
            .optional()
            .map_err(|err| err.to_string())?;

        match row {
            Some(seq) => seq,
            None => return Ok(false),
        }
    };

    // 2. Bail out if the current turn already emitted assistant / tool rows.
    let has_output: bool = {
        let conn = get_connection().map_err(|err| err.to_string())?;
        conn.query_row(
            "SELECT EXISTS(
                 SELECT 1 FROM agent_messages
                 WHERE session_id = ?1 AND sequence > ?2 AND role != ?3
             )",
            rusqlite::params![session_id, last_user_seq, message_role::USER],
            |row| row.get::<_, i64>(0).map(|n| n != 0),
        )
        .map_err(|err| err.to_string())?
    };
    if has_output {
        return Ok(false);
    }

    // 3. Drop the trailing user row from LLM history.
    unified_persistence::delete_last_user_turn(session_id)
        .map_err(|err| format!("agent_messages rollback failed: {err}"))?;

    // 4. Mirror the rollback in the events cache so the UI matches.
    if let Err(err) = session_bridge::delete_last_user_event_and_after(session_id) {
        warn!(
            "[agent-state] events cache rollback failed for {}: {}",
            session_id, err
        );
    }

    Ok(true)
}
