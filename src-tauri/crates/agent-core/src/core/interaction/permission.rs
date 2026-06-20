//! Unified permission prompt system for all agent types.
//!
//! When a tool has an `Ask` verdict in the policy, the agent pauses execution
//! and broadcasts a `permission:request` event (routed to the frontend via
//! the per-session Tauri IPC Channel). The frontend shows a confirmation
//! dialog and the user's response arrives via a Tauri command, which
//! resolves a one-shot channel that the processor is awaiting.
//!
//! ## Rule-based always-allow
//!
//! "Always allow" can be granted at two granularities:
//! - **Tool-level**: `"run_shell"` — all invocations of this tool are auto-approved.
//! - **Pattern-level**: `"run_shell(git *)"` — only matching invocations are auto-approved.
//!
//! Session-level rules live in memory. Persistent rules are stored in
//! `.orgii/permissions.json` via [`super::permission_rules::PermissionStore`].

use async_trait::async_trait;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{oneshot, Mutex};
use tracing::{info, warn};

use super::finalize::{
    await_with_cancel, finalize_interaction_event, AutoTimeoutAction, AutoTimeoutPolicy,
    FinalizedStatus, InteractionOutcome,
};
use super::permission_rules::{PermissionRule, PermissionStore};
use crate::turn_executor::{PermissionProvider, PermissionVerdict};

const PERMISSION_TIMEOUT: Duration = Duration::from_secs(300);

/// Whether the user approved or denied a permission request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionResponse {
    Allow,
    Deny,
    /// Allow this tool (or tool+pattern) for the rest of the session and persist.
    AlwaysAllow,
}

impl PermissionResponse {
    /// Wire format strings used by the frontend Tauri commands.
    pub const ALLOW_STR: &'static str = "allow";
    pub const DENY_STR: &'static str = "deny";
    pub const ALWAYS_ALLOW_STR: &'static str = "always_allow";

    /// Parse from the wire string sent by the frontend.
    pub fn from_wire(value: &str) -> Option<Self> {
        match value {
            Self::ALLOW_STR => Some(Self::Allow),
            Self::DENY_STR => Some(Self::Deny),
            Self::ALWAYS_ALLOW_STR => Some(Self::AlwaysAllow),
            _ => None,
        }
    }
}

/// Bookkeeping for a pending permission request so `respond`/cancel paths
/// can emit a structured finalized event without extra plumbing.
struct PendingPermission {
    sender: oneshot::Sender<PermissionResponse>,
    session_id: String,
    tool_name: String,
    tool_call_id: String,
}

/// Manages pending permission requests for any agent session.
///
/// All agent types emit the same `"permission:request"` event via
/// `broadcast_event` (routed to the frontend over the Tauri IPC Channel).
pub struct AgentPermissionManager {
    /// Pending requests keyed by `request_id`.
    pending: Arc<Mutex<HashMap<String, PendingPermission>>>,
    /// Session-scoped always-allow rules (tool name or tool+pattern).
    session_rules: Arc<Mutex<Vec<PermissionRule>>>,
    /// Persistent rules loaded from `.orgii/permissions.json`.
    persistent_store: Arc<Mutex<PermissionStore>>,
    /// Workspace path for saving persistent rules.
    workspace: Arc<Mutex<Option<PathBuf>>>,
    /// Prefix for request IDs (e.g. "perm-sde", "perm-os").
    id_prefix: String,
    /// Session cancel flag — shared with `AgentSession::cancel_flag`. When set
    /// (Stop button), any `request_permission` wait returns `Cancelled` and
    /// the pending entry is finalized as terminated.
    ///
    /// Optional-in-spirit: call sites that don't have a per-session flag
    /// (gateway, channels) get an always-false flag from `for_agent()`, which
    /// matches the pre-migration behavior.
    cancel_flag: Arc<AtomicBool>,
}

impl AgentPermissionManager {
    /// Create a permission manager for the given agent (no cancel wiring).
    ///
    /// Call sites that own an `AgentSession` should prefer
    /// [`Self::for_agent_with_cancel_flag`] so Stop can interrupt pending
    /// permission prompts.
    pub fn for_agent(agent_id: &str) -> Self {
        Self::for_agent_with_cancel_flag(agent_id, Arc::new(AtomicBool::new(false)))
    }

    /// Create a permission manager wired to the session's cancel flag.
    pub fn for_agent_with_cancel_flag(agent_id: &str, cancel_flag: Arc<AtomicBool>) -> Self {
        let short = agent_id
            .replace(crate::definitions::builtin::BUILTIN_PREFIX, "")
            .replace(':', "-")
            .chars()
            .take(8)
            .collect::<String>();
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
            session_rules: Arc::new(Mutex::new(Vec::new())),
            persistent_store: Arc::new(Mutex::new(PermissionStore::default())),
            workspace: Arc::new(Mutex::new(None)),
            id_prefix: format!("perm-{}", short),
            cancel_flag,
        }
    }

    /// Set the workspace path and load persistent rules from `.orgii/permissions.json`.
    pub async fn set_workspace(&self, workspace: &std::path::Path) {
        let store = PermissionStore::load(workspace);
        info!(
            "[permission] Loaded {} persistent allow rules from {}",
            store.allow.len(),
            workspace.display()
        );
        *self.persistent_store.lock().await = store;
        *self.workspace.lock().await = Some(workspace.to_path_buf());
    }

    /// Register a pending request and return the request ID + receiver.
    ///
    /// The `tool_name` / `tool_call_id` are retained so `respond` can emit a
    /// structured `agent:interaction_finalized` event at the moment of user
    /// action — flipping the gated tool_call event to "answered" in the UI
    /// without waiting for the tool's `execute()` to return.
    pub async fn register(
        &self,
        session_id: &str,
        tool_name: &str,
        tool_call_id: &str,
    ) -> (String, oneshot::Receiver<PermissionResponse>) {
        let request_id = format!("{}-{}-{}", self.id_prefix, session_id, uuid::Uuid::new_v4());
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(
            request_id.clone(),
            PendingPermission {
                sender: tx,
                session_id: session_id.to_string(),
                tool_name: tool_name.to_string(),
                tool_call_id: tool_call_id.to_string(),
            },
        );
        (request_id, rx)
    }

    /// Resolve a pending request with the user's response.
    ///
    /// Emits `agent:interaction_finalized` carrying the resolved verdict so
    /// the gated tool_call event flips out of the "awaiting approval" state
    /// immediately.
    pub async fn respond(
        &self,
        request_id: &str,
        response: PermissionResponse,
        tool_name: Option<&str>,
        tool_args: Option<&serde_json::Value>,
    ) -> bool {
        if response == PermissionResponse::AlwaysAllow {
            if let Some(name) = tool_name {
                let rule = Self::build_rule(name, tool_args);
                info!("[permission] Always-allow granted: {}", rule.rule);

                // Add to session rules
                let mut session = self.session_rules.lock().await;
                if !session.contains(&rule) {
                    session.push(rule.clone());
                }

                // Persist to .orgii/permissions.json
                let mut store = self.persistent_store.lock().await;
                store.add_allow(rule);
                if let Some(ref ws) = *self.workspace.lock().await {
                    if let Err(err) = store.save(ws) {
                        warn!("[permission] Failed to persist rule: {}", err);
                    }
                }
            }
        }

        let Some(entry) = self.pending.lock().await.remove(request_id) else {
            warn!("[permission] No pending request found for {}", request_id);
            return false;
        };

        let (status, content) = match response {
            PermissionResponse::Allow => (
                FinalizedStatus::Answered,
                "User approved this tool invocation.",
            ),
            PermissionResponse::AlwaysAllow => (
                FinalizedStatus::Answered,
                "User approved and added an always-allow rule.",
            ),
            PermissionResponse::Deny => (
                FinalizedStatus::Rejected,
                "User denied this tool invocation.",
            ),
        };

        finalize_interaction_event(
            &entry.session_id,
            Some(&entry.tool_call_id),
            &entry.tool_name,
            status,
            content,
            serde_json::json!({
                "permission": match response {
                    PermissionResponse::Allow => "allow",
                    PermissionResponse::AlwaysAllow => "always_allow",
                    PermissionResponse::Deny => "deny",
                },
            }),
        );

        if entry.sender.send(response).is_err() {
            warn!(
                "[permission] Pending request {} was dropped before response arrived",
                request_id
            );
        }
        true
    }

    /// Cancel a pending permission request (Stop button or timeout). Drops
    /// the sender so any later `respond` is a no-op, and finalizes the event.
    ///
    /// Only `Cancelled` and `TimedOut` are valid here — `Answered` and
    /// `Rejected` mean the user actually responded and go through
    /// `respond()` instead. The match below is exhaustive on purpose so
    /// adding a new `FinalizedStatus` variant forces a compiler error here
    /// rather than silently mapping it to a generic "terminated" string.
    async fn cancel_pending(&self, request_id: &str, status: FinalizedStatus) {
        let Some(entry) = self.pending.lock().await.remove(request_id) else {
            return;
        };

        let content = match status {
            FinalizedStatus::Cancelled => "User stopped the session before responding.",
            FinalizedStatus::TimedOut => "Permission request timed out.",
            FinalizedStatus::Answered | FinalizedStatus::Rejected => {
                warn!(
                    "[permission] cancel_pending called with unexpected status {:?} for {}",
                    status, request_id
                );
                "Permission request terminated."
            }
        };

        finalize_interaction_event(
            &entry.session_id,
            Some(&entry.tool_call_id),
            &entry.tool_name,
            status,
            content,
            serde_json::json!({ "permission": "deny" }),
        );

        drop(entry.sender);
    }

    /// Check if there are any pending permission requests.
    pub async fn has_pending(&self) -> bool {
        !self.pending.lock().await.is_empty()
    }

    /// Get the IDs of all pending permission requests.
    pub async fn pending_ids(&self) -> Vec<String> {
        self.pending.lock().await.keys().cloned().collect()
    }

    /// Build a permission rule from tool name + args.
    ///
    /// For `run_shell`, extracts the command and builds a pattern like
    /// `run_shell(git status *)`. For other tools, uses just the tool name.
    fn build_rule(tool_name: &str, args: Option<&serde_json::Value>) -> PermissionRule {
        if tool_name == crate::tools::names::RUN_SHELL {
            if let Some(cmd) = args.and_then(|a| a.get("command")).and_then(|v| v.as_str()) {
                // Split compound commands and create rule for the first command
                let base = cmd
                    .split("&&")
                    .next()
                    .unwrap_or(cmd)
                    .split(';')
                    .next()
                    .unwrap_or(cmd)
                    .trim();
                // Extract command name (first token) and add wildcard
                let first_token = base.split_whitespace().next();
                let pattern = match first_token {
                    None => return PermissionRule::new(tool_name),
                    Some(cmd_name) => format!("{} *", cmd_name),
                };
                return PermissionRule::new(format!("{}({})", tool_name, pattern));
            }
        }
        PermissionRule::new(tool_name)
    }

    /// Add tool(s) to the always-allowed set programmatically.
    pub async fn add_always_allowed(&self, tool_names: impl IntoIterator<Item = impl AsRef<str>>) {
        let mut session = self.session_rules.lock().await;
        for name in tool_names {
            let rule = PermissionRule::new(name.as_ref());
            if !session.contains(&rule) {
                session.push(rule);
            }
        }
    }

    /// Check if a tool call is always-allowed (session rules or persistent store).
    async fn check_always_allowed(&self, tool_name: &str, args: &serde_json::Value) -> bool {
        // Check session rules
        let session = self.session_rules.lock().await;
        if session.iter().any(|r| r.matches(tool_name, args)) {
            return true;
        }
        drop(session);

        // Check persistent store
        self.persistent_store
            .lock()
            .await
            .is_allowed(tool_name, args)
    }
}

#[async_trait]
impl PermissionProvider for AgentPermissionManager {
    async fn is_always_allowed(&self, tool_name: &str) -> bool {
        // Fast path for backwards compat: check with empty args.
        // Full check with args happens in check_permission via request_permission.
        self.check_always_allowed(tool_name, &serde_json::Value::Null)
            .await
    }

    async fn request_permission(
        &self,
        session_id: &str,
        tool_name: &str,
        tool_call_id: &str,
        args: &serde_json::Value,
    ) -> Result<PermissionVerdict, ()> {
        // Check pattern-level always-allow with actual args. External terminal launches
        // must still surface an explicit approval because they run outside the backend.
        if args.get("terminal_target").and_then(|value| value.as_str()) != Some("external")
            && self.check_always_allowed(tool_name, args).await
        {
            return Ok(PermissionVerdict::AlwaysAllow);
        }

        let (request_id, rx) = self.register(session_id, tool_name, tool_call_id).await;

        crate::bus::broadcast_event(
            "permission:request",
            serde_json::json!({
                "sessionId": session_id,
                "requestId": request_id,
                "toolName": tool_name,
                "toolCallId": tool_call_id,
                "toolArgs": args,
            }),
        );

        info!(
            "[permission] Waiting for user response: tool={}, session={}, request={}",
            tool_name, session_id, request_id
        );

        // Cancel-aware wait with the existing 5-minute backstop.
        // `AutoTimeoutPolicy` is reserved for future auto-deny behavior.
        let outcome = await_with_cancel(
            rx,
            Arc::clone(&self.cancel_flag),
            Some(AutoTimeoutPolicy {
                timeout: PERMISSION_TIMEOUT,
                on_expire: Box::new(|| AutoTimeoutAction::Report),
            }),
        )
        .await;

        match outcome {
            InteractionOutcome::Responded(response)
            | InteractionOutcome::AutoResponded(response) => {
                info!(
                    "[permission] User responded {:?} for tool {} (session={})",
                    response, tool_name, session_id
                );
                match response {
                    PermissionResponse::Allow => Ok(PermissionVerdict::Allow),
                    PermissionResponse::Deny => Ok(PermissionVerdict::Deny),
                    PermissionResponse::AlwaysAllow => Ok(PermissionVerdict::AlwaysAllow),
                }
            }
            InteractionOutcome::Cancelled => {
                self.cancel_pending(&request_id, FinalizedStatus::Cancelled)
                    .await;
                warn!(
                    "[permission] Request cancelled by user (stop) for tool {} (session={})",
                    tool_name, session_id
                );
                Err(())
            }
            InteractionOutcome::TimedOut => {
                self.cancel_pending(&request_id, FinalizedStatus::TimedOut)
                    .await;
                warn!(
                    "[permission] Request timed out after {}s for tool {} (session={})",
                    PERMISSION_TIMEOUT.as_secs(),
                    tool_name,
                    session_id
                );
                Err(())
            }
            InteractionOutcome::Dropped => {
                // Sender was dropped without cancel_pending (shouldn't happen in
                // the normal flow, but be defensive).
                self.pending.lock().await.remove(&request_id);
                Err(())
            }
        }
    }
}
