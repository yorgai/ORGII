//! Durable Agent Org run envelopes.
//!
//! A run records that an Agent Org launched through the normal Rust session
//! stack, while the root session remains the transcript source of truth.

use std::collections::HashSet;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Result as SqliteResult};
use serde::Serialize;

use crate::coordination::agent_member_interventions::{
    AgentMemberInterventionRecord, AgentMemberInterventionStore,
};
use crate::coordination::agent_org_tasks::{AgentOrgTaskStore, Task, TaskStatus};
use crate::definitions::orgs::{AgentOrgsStore, HierarchyMode, OrgDefinition, OrgMember};
use database::db::get_connection;

pub const COORDINATOR_MEMBER_ID: &str = "coordinator";
const DEFAULT_COORDINATOR_DISPLAY_NAME: &str = "Coordinator";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentOrgRunEntryMode {
    StandaloneSession,
}

impl AgentOrgRunEntryMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::StandaloneSession => "standalone_session",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "standalone_session" => Some(Self::StandaloneSession),
            _ => None,
        }
    }
}

impl std::fmt::Display for AgentOrgRunEntryMode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentOrgRunStatus {
    Running,
    /// User-initiated pause. Non-terminal: the run can be resumed via
    /// `AgentOrgRunStore::mark_resumed`. Polling and member switching remain
    /// available while paused; the coordinator and members simply stop
    /// receiving new dispatch until resumed.
    Paused,
    Completed,
    Failed,
    Cancelled,
    Abandoned,
}

impl AgentOrgRunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Abandoned => "abandoned",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "running" => Some(Self::Running),
            "paused" => Some(Self::Paused),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            "abandoned" => Some(Self::Abandoned),
            _ => None,
        }
    }

    /// Whether this status represents a terminal state (no further transitions
    /// possible). `Paused` is explicitly non-terminal.
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::Cancelled | Self::Abandoned
        )
    }
}

impl std::fmt::Display for AgentOrgRunStatus {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOrgContextMember {
    pub member_id: String,
    pub name: String,
    pub role: String,
    pub agent_id: String,
    /// `id` of the member this one reports to in `OrgDefinition.children`.
    /// `None` means the member sits directly under the coordinator.
    /// Used by the LLM system prompt to render reports-to relationships
    /// (in `Soft`/`Strict` modes) and by the runtime to enforce routing
    /// rules when `HierarchyMode::Strict` is in effect.
    pub parent_member_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOrgParticipant {
    pub member_id: String,
    pub agent_id: String,
    pub parent_member_id: Option<String>,
    pub is_coordinator: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOrgRunContext {
    pub run_id: String,
    pub org_id: String,
    pub org_name: String,
    pub org_role: String,
    /// Stable agent_id of the coordinator session. Routing uses
    /// `COORDINATOR_MEMBER_ID`; this field is only the runtime definition id.
    pub coordinator_agent_id: String,
    /// Display name of the coordinator participant. This is intentionally
    /// distinct from `org_name`; chat cards and inbox routing should name the
    /// recipient role, not the Agent Org session title.
    pub coordinator_name: String,
    /// Role label of the coordinator (e.g. "lead engineer"). Mirror of
    /// `OrgDefinition.role`. Informational only — not used for routing.
    pub coordinator_role: String,
    /// Worker roster. Does **not** include the coordinator — addressing
    /// logic explicitly considers `{coordinator} ∪ members` as the
    /// eligible recipient set.
    pub members: Vec<AgentOrgContextMember>,
    /// How the coordinator → members → reports-to relationship should be
    /// surfaced in the LLM system prompt and enforced by
    /// `org_send_message`. Mirror of `OrgDefinition.hierarchy_mode`.
    pub hierarchy_mode: HierarchyMode,
    /// Session ID of the coordinator (root) session for this run. Used by
    /// the frontend to navigate directly to the coordinator's chat history
    /// when the run is paused or the coordinator is not the active session.
    /// `None` only for runs that have not yet materialized a coordinator
    /// session (e.g. created but never started).
    pub root_session_id: Option<String>,
}

/// Outcome of [`AgentOrgRunContext::check_routing`].
///
/// `Allowed` means the send is legitimate under the current
/// `HierarchyMode`. `Blocked` carries an LLM-readable hint that names
/// the legitimate routing options (immediate manager + the coordinator
/// escape hatch) so the model can self-correct without retrying blind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RoutingDecision {
    Allowed,
    Blocked(String),
}

impl AgentOrgRunContext {
    pub fn coordinator_participant(&self) -> AgentOrgParticipant {
        AgentOrgParticipant {
            member_id: COORDINATOR_MEMBER_ID.to_string(),
            agent_id: self.coordinator_agent_id.clone(),
            parent_member_id: None,
            is_coordinator: true,
        }
    }

    pub fn participants(&self) -> Vec<AgentOrgParticipant> {
        let mut participants = Vec::with_capacity(self.members.len() + 1);
        participants.push(self.coordinator_participant());
        participants.extend(self.members.iter().map(|member| AgentOrgParticipant {
            member_id: member.member_id.clone(),
            agent_id: member.agent_id.clone(),
            parent_member_id: member.parent_member_id.clone(),
            is_coordinator: false,
        }));
        participants
    }

    pub fn participant_by_member_id(&self, member_id: &str) -> Option<AgentOrgParticipant> {
        if member_id == COORDINATOR_MEMBER_ID {
            return Some(self.coordinator_participant());
        }
        self.members
            .iter()
            .find(|member| member.member_id == member_id)
            .map(|member| AgentOrgParticipant {
                member_id: member.member_id.clone(),
                agent_id: member.agent_id.clone(),
                parent_member_id: member.parent_member_id.clone(),
                is_coordinator: false,
            })
    }

    pub fn participant_display_name(&self, member_id: &str) -> Option<String> {
        if member_id == COORDINATOR_MEMBER_ID {
            return Some(self.coordinator_name.clone());
        }
        self.members
            .iter()
            .find(|member| member.member_id == member_id)
            .map(|member| member.name.clone())
    }

    pub fn participant_agent_id(&self, member_id: &str) -> Option<String> {
        self.participant_by_member_id(member_id)
            .map(|participant| participant.agent_id)
    }

    pub fn require_participant(&self, member_id: &str) -> Result<AgentOrgParticipant, String> {
        self.participant_by_member_id(member_id).ok_or_else(|| {
            format!("member_id '{member_id}' is not a participant in this Agent Org run")
        })
    }

    pub fn require_participant_display_name(&self, member_id: &str) -> Result<String, String> {
        self.participant_display_name(member_id).ok_or_else(|| {
            format!("member_id '{member_id}' is not a participant in this Agent Org run")
        })
    }

    pub fn require_participant_agent_id(&self, member_id: &str) -> Result<String, String> {
        self.participant_agent_id(member_id).ok_or_else(|| {
            format!("member_id '{member_id}' is not a participant in this Agent Org run")
        })
    }

    pub fn allowed_recipient_member_ids_for(&self, sender_member_id: &str) -> Vec<String> {
        if self.participant_by_member_id(sender_member_id).is_none() {
            return Vec::new();
        }

        let mut allowed = match self.hierarchy_mode {
            HierarchyMode::Flat | HierarchyMode::Soft => self
                .participants()
                .into_iter()
                .map(|participant| participant.member_id)
                .filter(|member_id| member_id != sender_member_id)
                .collect::<Vec<_>>(),
            HierarchyMode::Strict => {
                if sender_member_id == COORDINATOR_MEMBER_ID {
                    self.members
                        .iter()
                        .map(|member| member.member_id.clone())
                        .collect::<Vec<_>>()
                } else {
                    let mut ids = Vec::new();
                    ids.push(COORDINATOR_MEMBER_ID.to_string());
                    if let Some(sender) = self
                        .members
                        .iter()
                        .find(|member| member.member_id == sender_member_id)
                    {
                        if let Some(parent_member_id) = sender.parent_member_id.as_ref() {
                            ids.push(parent_member_id.clone());
                        }
                        ids.extend(
                            self.members
                                .iter()
                                .filter(|member| {
                                    member
                                        .parent_member_id
                                        .as_deref()
                                        .is_some_and(|parent| parent == sender.member_id)
                                })
                                .map(|member| member.member_id.clone()),
                        );
                    }
                    ids.into_iter()
                        .filter(|member_id| member_id != sender_member_id)
                        .collect::<Vec<_>>()
                }
            }
        };
        allowed.sort();
        allowed.dedup();
        allowed
    }

    pub fn check_routing(&self, from_member_id: &str, to_member_id: &str) -> RoutingDecision {
        if self
            .allowed_recipient_member_ids_for(from_member_id)
            .iter()
            .any(|member_id| member_id == to_member_id)
        {
            return RoutingDecision::Allowed;
        }

        RoutingDecision::Blocked(format!(
            "recipient_member_id '{to_member_id}' is not currently routable from sender_member_id '{from_member_id}'. Allowed recipient_member_id values: {}",
            self.allowed_recipient_member_ids_for(from_member_id).join(", ")
        ))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOrgRunRecord {
    pub id: String,
    pub org_id: String,
    pub coordinator_agent_id: String,
    pub root_session_id: Option<String>,
    pub org_snapshot_json: Option<String>,
    pub entry_mode: AgentOrgRunEntryMode,
    pub status: AgentOrgRunStatus,
    pub work_item_id: Option<String>,
    pub project_slug: Option<String>,
    pub routine_fire_id: Option<String>,
    pub summary: Option<String>,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CreateAgentOrgRunParams {
    pub org_id: String,
    pub coordinator_agent_id: String,
    pub root_session_id: Option<String>,
    pub org_snapshot: OrgDefinition,
    pub entry_mode: AgentOrgRunEntryMode,
    pub status: AgentOrgRunStatus,
    pub work_item_id: Option<String>,
    pub project_slug: Option<String>,
    pub routine_fire_id: Option<String>,
}

/// Initialize runtime Agent Org tables in `sessions.db`.
pub fn init_schema(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS agent_org_runs (
            id TEXT PRIMARY KEY,
            org_id TEXT NOT NULL,
            coordinator_agent_id TEXT NOT NULL,
            root_session_id TEXT,
            org_snapshot_json TEXT,
            entry_mode TEXT NOT NULL,
            status TEXT NOT NULL,
            work_item_id TEXT,
            project_slug TEXT,
            routine_fire_id TEXT,
            summary TEXT,
            last_error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_agent_org_runs_org_updated
            ON agent_org_runs(org_id, updated_at);
        CREATE INDEX IF NOT EXISTS idx_agent_org_runs_root_session
            ON agent_org_runs(root_session_id);
        CREATE INDEX IF NOT EXISTS idx_agent_org_runs_work_item
            ON agent_org_runs(work_item_id);
        CREATE INDEX IF NOT EXISTS idx_agent_org_runs_status
            ON agent_org_runs(status);",
    )?;
    Ok(())
}

pub struct AgentOrgRunStore;

impl AgentOrgRunStore {
    pub fn create(params: CreateAgentOrgRunParams) -> Result<AgentOrgRunRecord, String> {
        let entry_mode = validate_entry_mode(params.entry_mode.as_str())?;
        let status = validate_status(params.status.as_str())?;
        let org_snapshot_json = serde_json::to_string(&params.org_snapshot)
            .map_err(|err| format!("failed to serialize Agent Org launch snapshot: {err}"))?;
        let now = chrono::Utc::now().to_rfc3339();
        let run = AgentOrgRunRecord {
            id: format!("agent-org-run-{}", uuid::Uuid::new_v4()),
            org_id: params.org_id,
            coordinator_agent_id: params.coordinator_agent_id,
            root_session_id: params.root_session_id,
            org_snapshot_json: Some(org_snapshot_json),
            entry_mode,
            status,
            work_item_id: params.work_item_id,
            project_slug: params.project_slug,
            routine_fire_id: params.routine_fire_id,
            summary: None,
            last_error: None,
            created_at: now.clone(),
            updated_at: now,
            completed_at: None,
        };

        let conn = get_connection().map_err(|err| err.to_string())?;
        insert_run(&conn, &run).map_err(|err| err.to_string())?;
        Ok(run)
    }

    /// Pause a running run. Only transitions `running → paused`; already
    /// non-running runs are left unchanged and return `Ok(false)` (idempotent).
    pub fn mark_paused(run_id: &str) -> Result<bool, String> {
        let paused = validate_status(AgentOrgRunStatus::Paused.as_str())?;
        let running = validate_status(AgentOrgRunStatus::Running.as_str())?;
        let now = chrono::Utc::now().to_rfc3339();
        let conn = get_connection().map_err(|err| err.to_string())?;
        let rows_changed = conn
            .execute(
                "UPDATE agent_org_runs
                 SET status = ?1,
                     updated_at = ?2
                 WHERE id = ?3
                   AND status = ?4",
                params![paused.as_str(), now, run_id, running.as_str()],
            )
            .map_err(|err| err.to_string())?;
        Ok(rows_changed > 0)
    }

    /// Called once at app startup to pause every org run that was `running`
    /// when the previous process exited. The member sessions will have been
    /// marked `abandoned` by `mark_stale_running_sessions_abandoned`, but the
    /// org run itself should remain accessible and resumable — not auto-terminated
    /// by `reconcile_if_terminal`. Transitioning to `paused` achieves this:
    /// `reconcile_if_terminal` is a no-op for non-`running` runs, and the
    /// frontend's `TERMINAL_RUN_STATUSES` set excludes `paused`, so the overview
    /// panel, member switcher, and task board stay visible.
    ///
    /// Returns the number of runs transitioned.
    pub fn mark_all_running_as_paused_on_startup() -> Result<usize, String> {
        let paused = validate_status(AgentOrgRunStatus::Paused.as_str())?;
        let running = validate_status(AgentOrgRunStatus::Running.as_str())?;
        let now = chrono::Utc::now().to_rfc3339();
        let conn = get_connection().map_err(|err| err.to_string())?;
        let rows_changed = conn
            .execute(
                "UPDATE agent_org_runs
                 SET status = ?1,
                     updated_at = ?2
                 WHERE status = ?3",
                params![paused.as_str(), now, running.as_str()],
            )
            .map_err(|err| err.to_string())?;
        Ok(rows_changed)
    }

    /// Resume a paused run. Only transitions `paused → running`; already
    /// non-paused runs are left unchanged and return `Ok(false)` (idempotent).
    pub fn mark_resumed(run_id: &str) -> Result<bool, String> {
        let running = validate_status(AgentOrgRunStatus::Running.as_str())?;
        let paused = validate_status(AgentOrgRunStatus::Paused.as_str())?;
        let now = chrono::Utc::now().to_rfc3339();
        let conn = get_connection().map_err(|err| err.to_string())?;
        let rows_changed = conn
            .execute(
                "UPDATE agent_org_runs
                 SET status = ?1,
                     updated_at = ?2
                 WHERE id = ?3
                   AND status = ?4",
                params![running.as_str(), now, run_id, paused.as_str()],
            )
            .map_err(|err| err.to_string())?;
        Ok(rows_changed > 0)
    }

    pub fn mark_failed(run_id: &str, error_message: &str) -> Result<(), String> {
        let status = validate_status(AgentOrgRunStatus::Failed.as_str())?;
        let now = chrono::Utc::now().to_rfc3339();
        let conn = get_connection().map_err(|err| err.to_string())?;
        conn.execute(
            "UPDATE agent_org_runs
             SET status = ?1,
                 last_error = ?2,
                 updated_at = ?3,
                 completed_at = ?3
             WHERE id = ?4",
            params![status.as_str(), error_message, now, run_id],
        )
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub fn reconcile_if_terminal(run_id: &str) -> Result<Option<AgentOrgRunStatus>, String> {
        let Some(run) = load_by_id(run_id).map_err(|err| err.to_string())? else {
            return Ok(None);
        };
        if run.status != AgentOrgRunStatus::Running {
            return Ok(Some(run.status));
        }
        let Some(root_session_id) = run.root_session_id.as_deref() else {
            return Ok(Some(run.status));
        };

        let conn = get_connection().map_err(|err| err.to_string())?;
        let root_status_raw: Option<String> = conn
            .query_row(
                "SELECT status FROM agent_sessions WHERE session_id = ?1",
                params![root_session_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|err| err.to_string())?;
        let Some(root_status_raw) = root_status_raw else {
            return Ok(Some(run.status));
        };
        let root_status =
            crate::core::session::SessionStatus::parse(&root_status_raw).ok_or_else(|| {
                format!("unknown root session status for {root_session_id}: {root_status_raw:?}")
            })?;
        if !root_status.is_terminal() {
            return Ok(Some(run.status));
        }

        let workers = Self::list_descendant_worker_sessions(run_id)?;
        if workers.iter().any(|worker| !worker.status.is_terminal()) {
            return Ok(Some(run.status));
        }

        let tasks = AgentOrgTaskStore::list(run_id)?;
        let next_status = if tasks
            .iter()
            .all(|task| task.status == TaskStatus::Completed)
        {
            AgentOrgRunStatus::Completed
        } else {
            AgentOrgRunStatus::Abandoned
        };
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE agent_org_runs
             SET status = ?1,
                 updated_at = ?2,
                 completed_at = ?2
             WHERE id = ?3 AND status = ?4",
            params![
                next_status.as_str(),
                now,
                run_id,
                AgentOrgRunStatus::Running.as_str(),
            ],
        )
        .map_err(|err| err.to_string())?;
        Ok(Some(next_status))
    }

    /// Resolve the org-run context for an arbitrary session — works for
    /// both the root (coordinator) session and materialized member sessions
    /// linked to the same Agent Org run.
    ///
    /// Strategy: try the direct `root_session_id` lookup first; if that
    /// misses, walk the persisted `agent_sessions.parent_session_id`
    /// chain upward (using the existing `idx_agent_sessions_parent`
    /// index) and retry the lookup at each ancestor. The first ancestor
    /// that anchors an `agent_org_runs` row wins.
    ///
    /// The persisted parent chain serves as the reverse-resolution
    /// path. `root_session_id` remains the **single anchor** for an org
    /// run — no per-subagent rows are added (avoids a second source of
    /// truth and the corresponding unify-then-reshuffle reshape).
    ///
    /// Bounded to `MAX_PARENT_WALK_DEPTH` hops so a corrupt or cyclic
    /// parent chain can't cause an unbounded scan during session init.
    pub fn context_for_run(
        run_id: &str,
        org_store: &AgentOrgsStore,
    ) -> Result<Option<AgentOrgRunContext>, String> {
        let Some(run) = load_by_id(run_id).map_err(|err| err.to_string())? else {
            return Ok(None);
        };
        Ok(Some(context_for_run_record(&run, org_store)?))
    }

    pub fn context_for_session_with_parent_walk(
        session_id: &str,
        org_store: &AgentOrgsStore,
    ) -> Result<Option<AgentOrgRunContext>, String> {
        let Some(run) = Self::run_for_session_with_parent_walk(session_id)? else {
            return Ok(None);
        };
        Ok(Some(context_for_run_record(&run, org_store)?))
    }

    pub fn root_session_id_for_session_with_parent_walk(
        session_id: &str,
    ) -> Result<Option<String>, String> {
        Ok(Self::run_for_session_with_parent_walk(session_id)?.and_then(|run| run.root_session_id))
    }

    pub fn is_root_session(org_run_id: &str, session_id: &str) -> Result<bool, String> {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let root_session_id: Option<String> = conn
            .query_row(
                "SELECT root_session_id FROM agent_org_runs WHERE id = ?1",
                params![org_run_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|err| err.to_string())?
            .flatten();
        Ok(root_session_id.as_deref() == Some(session_id))
    }

    fn run_for_session_with_parent_walk(
        session_id: &str,
    ) -> Result<Option<AgentOrgRunRecord>, String> {
        const MAX_PARENT_WALK_DEPTH: usize = 16;

        let mut current_id = session_id.to_string();
        let mut visited: std::collections::HashSet<String> = std::collections::HashSet::new();
        for hop in 0..=MAX_PARENT_WALK_DEPTH {
            if !visited.insert(current_id.clone()) {
                tracing::warn!(
                    session_id = %session_id,
                    cycle_at = %current_id,
                    "[agent_org_runs] parent_session_id chain has a cycle; aborting walk"
                );
                return Ok(None);
            }
            if let Some(run) = load_by_root_session(&current_id).map_err(|err| err.to_string())? {
                return Ok(Some(run));
            }
            if hop == MAX_PARENT_WALK_DEPTH {
                tracing::warn!(
                    session_id = %session_id,
                    last_visited = %current_id,
                    "[agent_org_runs] parent_session_id walk exceeded max depth ({}); giving up",
                    MAX_PARENT_WALK_DEPTH
                );
                return Ok(None);
            }
            match parent_session_id_of(&current_id).map_err(|err| err.to_string())? {
                Some(parent) => current_id = parent,
                None => return Ok(None),
            }
        }
        Ok(None)
    }

    /// List every persisted run that has anchored a coordinator session,
    /// across all orgs, ordered by `updated_at DESC`. Used by the Inbox
    /// page to render its flat list of chats — each row is one run.
    ///
    /// Runs whose `root_session_id` is still `NULL` (created but the
    /// coordinator session row has not landed yet) are excluded; the
    /// Inbox renders those as transient client-side draft rows until the
    /// anchor exists.
    pub fn list_runs(limit: usize) -> Result<Vec<AgentOrgRunRecord>, String> {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id,
                        org_id,
                        coordinator_agent_id,
                        root_session_id,
                        org_snapshot_json,
                        entry_mode,
                        status,
                        work_item_id,
                        project_slug,
                        routine_fire_id,
                        summary,
                        last_error,
                        created_at,
                        updated_at,
                        completed_at
                 FROM agent_org_runs
                 WHERE root_session_id IS NOT NULL
                 ORDER BY updated_at DESC
                 LIMIT ?1",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map(params![limit as i64], row_to_run)
            .map_err(|err| err.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|err| err.to_string())?);
        }
        Ok(out)
    }
    /// Return the current status of the run without fetching the full record.
    pub fn get_run_status(run_id: &str) -> Result<Option<AgentOrgRunStatus>, String> {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let status_raw: Option<String> = conn
            .query_row(
                "SELECT status FROM agent_org_runs WHERE id = ?1 LIMIT 1",
                params![run_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|err| err.to_string())?;
        Ok(status_raw.as_deref().and_then(AgentOrgRunStatus::parse))
    }

    pub fn delete_by_id(run_id: &str) -> Result<(), String> {
        let conn = get_connection().map_err(|err| err.to_string())?;
        conn.execute("DELETE FROM agent_org_runs WHERE id = ?1", params![run_id])
            .map_err(|err| err.to_string())?;
        Ok(())
    }

    /// Find the freshest materialized worker session for a canonical roster
    /// `member_id` inside `org_run_id`.
    pub fn find_worker_session_by_member_id(
        org_run_id: &str,
        member_id: &str,
    ) -> Result<Option<WorkerSessionInfo>, String> {
        let mut sessions =
            Self::list_worker_sessions_by_member_ids(org_run_id, &[member_id.to_string()])?;
        Ok(sessions.pop().map(|session| WorkerSessionInfo {
            session_id: session.session_id,
            status: session.status,
            updated_at: session.updated_at,
        }))
    }

    pub fn find_coordinator_session_by_member_id(
        org_run_id: &str,
        member_id: &str,
    ) -> Result<Option<WorkerSessionInfo>, String> {
        if member_id != COORDINATOR_MEMBER_ID {
            return Ok(None);
        }
        let conn = get_connection().map_err(|err| err.to_string())?;
        let row: Option<(String, String, String)> = conn
            .query_row(
                "SELECT s.session_id,
                        s.status,
                        s.updated_at
                 FROM agent_org_runs r
                 JOIN agent_sessions s ON s.session_id = r.root_session_id
                 WHERE r.id = ?1
                 LIMIT 1",
                params![org_run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|err| err.to_string())?;

        let Some((session_id, status_raw, updated_at)) = row else {
            return Ok(None);
        };
        let status = crate::core::session::SessionStatus::parse(&status_raw).ok_or_else(|| {
            format!("unknown coordinator session status for {session_id}: {status_raw:?}")
        })?;
        Ok(Some(WorkerSessionInfo {
            session_id,
            status,
            updated_at,
        }))
    }

    /// Return the freshest descendant session for each requested roster
    /// `member_id`. UI read models use this instead of `agent_definition_id`
    /// because multiple roster members may run the same AgentDefinition.
    pub fn list_worker_sessions_by_member_ids(
        org_run_id: &str,
        member_ids: &[String],
    ) -> Result<Vec<WorkerSessionRuntime>, String> {
        let requested: HashSet<&str> = member_ids
            .iter()
            .map(String::as_str)
            .filter(|member_id| !member_id.is_empty())
            .collect();
        if requested.is_empty() {
            return Ok(Vec::new());
        }

        let sessions = Self::list_descendant_worker_sessions(org_run_id)?;
        let mut seen = HashSet::new();
        Ok(sessions
            .into_iter()
            .filter(|session| {
                session
                    .member_id
                    .as_deref()
                    .is_some_and(|member_id| requested.contains(member_id))
            })
            .filter(|session| seen.insert(session.member_id.clone()))
            .collect())
    }

    /// Release open tasks owned by materialized member sessions whose
    /// latest activity timestamp is older than `stale_before`.
    ///
    /// This is the first production heartbeat-recovery surface: it reuses
    /// the existing session activity clock (`agent_sessions.updated_at`) as
    /// member liveness, then delegates task release to the same
    /// `unassign_for_owner` path used by accepted shutdown. Completed tasks
    /// remain owned for audit history; only claimable/open work is returned
    /// to the pool.
    pub fn release_tasks_for_stale_workers(
        org_run_id: &str,
        stale_before: DateTime<Utc>,
    ) -> Result<Vec<StaleWorkerRelease>, String> {
        Self::release_tasks_for_stale_workers_filtered(org_run_id, stale_before, None)
    }

    pub fn release_tasks_for_stale_workers_except_member(
        org_run_id: &str,
        stale_before: DateTime<Utc>,
        excluded_member_id: &str,
    ) -> Result<Vec<StaleWorkerRelease>, String> {
        Self::release_tasks_for_stale_workers_filtered(
            org_run_id,
            stale_before,
            Some(excluded_member_id),
        )
    }

    fn release_tasks_for_stale_workers_filtered(
        org_run_id: &str,
        stale_before: DateTime<Utc>,
        excluded_member_id: Option<&str>,
    ) -> Result<Vec<StaleWorkerRelease>, String> {
        let sessions = Self::list_descendant_worker_sessions(org_run_id)?;
        let mut releases = Vec::new();
        for session in sessions {
            if session.member_id.as_deref() == excluded_member_id {
                continue;
            }
            let updated_at = DateTime::parse_from_rfc3339(&session.updated_at)
                .map_err(|err| {
                    format!(
                        "invalid worker session updated_at for session {}: {}",
                        session.session_id, err
                    )
                })?
                .with_timezone(&Utc);
            if updated_at >= stale_before {
                continue;
            }
            let Some(member_id) = session.member_id.as_deref() else {
                continue;
            };
            let released_tasks = AgentOrgTaskStore::unassign_for_owner(org_run_id, member_id)?;
            if released_tasks.is_empty() {
                continue;
            }
            releases.push(StaleWorkerRelease {
                worker: session,
                released_tasks,
            });
        }
        Ok(releases)
    }

    pub fn list_descendant_worker_sessions(
        org_run_id: &str,
    ) -> Result<Vec<WorkerSessionRuntime>, String> {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let root_session_id: Option<String> = conn
            .query_row(
                "SELECT root_session_id FROM agent_org_runs WHERE id = ?1",
                params![org_run_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|err| err.to_string())?
            .flatten();
        let Some(root) = root_session_id else {
            return Ok(Vec::new());
        };

        let mut stmt = conn
            .prepare(
                "WITH RECURSIVE descendants(session_id) AS (
                     SELECT session_id FROM agent_sessions WHERE parent_session_id = ?1
                     UNION ALL
                     SELECT s.session_id
                     FROM agent_sessions s
                     JOIN descendants d ON s.parent_session_id = d.session_id
                 ), ranked AS (
                     SELECT s.agent_definition_id,
                            s.org_member_id,
                            s.session_id,
                            s.status,
                            s.updated_at,
                            ROW_NUMBER() OVER (
                                PARTITION BY COALESCE(s.org_member_id, s.agent_definition_id)
                                ORDER BY s.updated_at DESC
                            ) AS rank
                     FROM agent_sessions s
                     JOIN descendants d USING (session_id)
                     WHERE s.agent_definition_id IS NOT NULL
                 )
                 SELECT agent_definition_id, org_member_id, session_id, status, updated_at
                 FROM ranked
                 WHERE rank = 1
                 ORDER BY updated_at DESC",
            )
            .map_err(|err| err.to_string())?;

        let rows = stmt
            .query_map(params![root.clone()], |row| {
                let status_raw: String = row.get(3)?;
                let status =
                    crate::core::session::SessionStatus::parse(&status_raw).ok_or_else(|| {
                        rusqlite::Error::FromSqlConversionFailure(
                            3,
                            rusqlite::types::Type::Text,
                            format!("unknown SessionStatus value: {status_raw:?}").into(),
                        )
                    })?;
                let agent_definition_id: String = row.get(0)?;
                let org_member_id: Option<String> = row.get(1)?;
                let intervention = match org_member_id.as_deref() {
                    Some(member_id) => {
                        AgentMemberInterventionStore::active_for_member(org_run_id, member_id)
                            .map_err(|err| {
                                rusqlite::Error::FromSqlConversionFailure(
                                    1,
                                    rusqlite::types::Type::Text,
                                    err.into(),
                                )
                            })?
                    }
                    None => None,
                };
                Ok(WorkerSessionRuntime {
                    intervention,
                    agent_definition_id: Some(agent_definition_id),
                    cli_agent_type: None,
                    member_id: org_member_id,
                    session_id: row.get(2)?,
                    parent_session_id: Some(root.clone()),
                    status,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|err| err.to_string())?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|err| err.to_string())?);
        }

        let mut cli_stmt = conn
            .prepare(
                "SELECT cli_agent_type, org_member_id, session_id, status, updated_at
                 FROM code_sessions
                 WHERE parent_session_id = ?1
                   AND org_member_id IS NOT NULL
                   AND cli_agent_type IS NOT NULL
                 ORDER BY updated_at DESC",
            )
            .map_err(|err| err.to_string())?;
        let cli_rows = cli_stmt
            .query_map(params![root.clone()], |row| {
                let status_raw: String = row.get(3)?;
                let status =
                    crate::core::session::SessionStatus::parse(&status_raw).ok_or_else(|| {
                        rusqlite::Error::FromSqlConversionFailure(
                            3,
                            rusqlite::types::Type::Text,
                            format!("unknown CLI SessionStatus value: {status_raw:?}").into(),
                        )
                    })?;
                let cli_agent_type: String = row.get(0)?;
                let org_member_id: Option<String> = row.get(1)?;
                let intervention = match org_member_id.as_deref() {
                    Some(member_id) => {
                        AgentMemberInterventionStore::active_for_member(org_run_id, member_id)
                            .map_err(|err| {
                                rusqlite::Error::FromSqlConversionFailure(
                                    1,
                                    rusqlite::types::Type::Text,
                                    err.into(),
                                )
                            })?
                    }
                    None => None,
                };
                Ok(WorkerSessionRuntime {
                    intervention,
                    agent_definition_id: None,
                    cli_agent_type: Some(cli_agent_type),
                    member_id: org_member_id,
                    session_id: row.get(2)?,
                    parent_session_id: Some(root.clone()),
                    status,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|err| err.to_string())?;
        for row in cli_rows {
            out.push(row.map_err(|err| err.to_string())?);
        }

        out.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        Ok(out)
    }
}

/// Result row for [`AgentOrgRunStore::find_worker_session_by_member_id`].
#[derive(Debug, Clone)]
pub struct WorkerSessionInfo {
    pub session_id: String,
    pub status: crate::core::session::SessionStatus,
    pub updated_at: String,
}

/// Freshest persisted runtime session for a member inside one Agent Org run.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerSessionRuntime {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_definition_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cli_agent_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub member_id: Option<String>,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
    pub status: crate::core::session::SessionStatus,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intervention: Option<AgentMemberInterventionRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaleWorkerRelease {
    pub worker: WorkerSessionRuntime,
    pub released_tasks: Vec<Task>,
}

/// Single-column lookup for the parent of `session_id` in persisted runtime
/// session tables. Used by `context_for_session_with_parent_walk` to avoid
/// pulling full session rows on every hop — the walk only needs the
/// `parent_session_id` string.
///
/// Returns `Ok(None)` for both "session does not exist" and "session exists
/// but has no parent". Both cases terminate the walk identically;
/// distinguishing them would not change the resolver outcome.
fn parent_session_id_of(session_id: &str) -> SqliteResult<Option<String>> {
    let conn = get_connection()?;
    let parent = conn
        .query_row(
            "SELECT parent_session_id FROM agent_sessions WHERE session_id = ?1",
            params![session_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    if parent.is_some() {
        return Ok(parent);
    }

    conn.query_row(
        "SELECT parent_session_id FROM code_sessions WHERE session_id = ?1",
        params![session_id],
        |row| row.get::<_, Option<String>>(0),
    )
    .optional()
    .map(|outer| outer.flatten())
}

fn load_by_id(run_id: &str) -> SqliteResult<Option<AgentOrgRunRecord>> {
    let conn = get_connection()?;
    conn.query_row(
        "SELECT id,
                org_id,
                coordinator_agent_id,
                root_session_id,
                org_snapshot_json,
                entry_mode,
                status,
                work_item_id,
                project_slug,
                routine_fire_id,
                summary,
                last_error,
                created_at,
                updated_at,
                completed_at
         FROM agent_org_runs
         WHERE id = ?1
         LIMIT 1",
        params![run_id],
        row_to_run,
    )
    .optional()
}

fn load_by_root_session(root_session_id: &str) -> SqliteResult<Option<AgentOrgRunRecord>> {
    let conn = get_connection()?;
    conn.query_row(
        "SELECT id,
                org_id,
                coordinator_agent_id,
                root_session_id,
                org_snapshot_json,
                entry_mode,
                status,
                work_item_id,
                project_slug,
                routine_fire_id,
                summary,
                last_error,
                created_at,
                updated_at,
                completed_at
         FROM agent_org_runs
         WHERE root_session_id = ?1
         ORDER BY created_at DESC
         LIMIT 1",
        params![root_session_id],
        row_to_run,
    )
    .optional()
}

fn row_to_run(row: &rusqlite::Row<'_>) -> SqliteResult<AgentOrgRunRecord> {
    let entry_mode_raw: String = row.get(5)?;
    let status_raw: String = row.get(6)?;
    let entry_mode = AgentOrgRunEntryMode::parse(&entry_mode_raw).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            5,
            rusqlite::types::Type::Text,
            format!("unknown AgentOrgRunEntryMode value: {entry_mode_raw:?}").into(),
        )
    })?;
    let status = AgentOrgRunStatus::parse(&status_raw).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            6,
            rusqlite::types::Type::Text,
            format!("unknown AgentOrgRunStatus value: {status_raw:?}").into(),
        )
    })?;
    Ok(AgentOrgRunRecord {
        id: row.get(0)?,
        org_id: row.get(1)?,
        coordinator_agent_id: row.get(2)?,
        root_session_id: row.get(3)?,
        org_snapshot_json: row.get(4)?,
        entry_mode,
        status,
        work_item_id: row.get(7)?,
        project_slug: row.get(8)?,
        routine_fire_id: row.get(9)?,
        summary: row.get(10)?,
        last_error: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        completed_at: row.get(14)?,
    })
}

fn context_for_run_record(
    run: &AgentOrgRunRecord,
    org_store: &AgentOrgsStore,
) -> Result<AgentOrgRunContext, String> {
    if let Some(snapshot_json) = run.org_snapshot_json.as_deref() {
        let snapshot: OrgDefinition = serde_json::from_str(snapshot_json).map_err(|err| {
            format!(
                "failed to parse Agent Org launch snapshot for run {}: {}",
                run.id, err
            )
        })?;
        return Ok(context_from_run_and_org(run, &snapshot));
    }

    let org = org_store.get(&run.org_id)?;
    Ok(context_from_run_and_org(run, &org))
}

fn context_from_run_and_org(run: &AgentOrgRunRecord, org: &OrgDefinition) -> AgentOrgRunContext {
    AgentOrgRunContext {
        run_id: run.id.clone(),
        org_id: org.id.clone(),
        org_name: org.name.clone(),
        org_role: org.role.clone(),
        coordinator_agent_id: run.coordinator_agent_id.clone(),
        coordinator_name: DEFAULT_COORDINATOR_DISPLAY_NAME.to_string(),
        coordinator_role: org.role.clone(),
        members: flatten_members(&org.children, None),
        hierarchy_mode: org.hierarchy_mode,
        root_session_id: run.root_session_id.clone(),
    }
}

/// Flatten the `OrgMember` tree into a `Vec<AgentOrgContextMember>`,
/// preserving each member's parent id (the immediate parent in
/// `OrgDefinition.children`). A `None` parent means the member is a
/// direct report of the coordinator.
///
/// In `HierarchyMode::Flat` the parent ids are still emitted but the
/// system prompt and routing layer ignore them.
fn flatten_members(members: &[OrgMember], parent_id: Option<&str>) -> Vec<AgentOrgContextMember> {
    let mut flattened = Vec::new();
    for member in members {
        flattened.push(AgentOrgContextMember {
            member_id: member.id.clone(),
            name: member.name.clone(),
            role: member.role.clone(),
            agent_id: member.agent_id.clone(),
            parent_member_id: parent_id.map(|id| id.to_string()),
        });
        flattened.extend(flatten_members(&member.children, Some(&member.id)));
    }
    flattened
}

fn insert_run(conn: &Connection, run: &AgentOrgRunRecord) -> SqliteResult<()> {
    conn.execute(
        "INSERT INTO agent_org_runs (
            id,
            org_id,
            coordinator_agent_id,
            root_session_id,
            org_snapshot_json,
            entry_mode,
            status,
            work_item_id,
            project_slug,
            routine_fire_id,
            summary,
            last_error,
            created_at,
            updated_at,
            completed_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            &run.id,
            &run.org_id,
            &run.coordinator_agent_id,
            run.root_session_id.as_deref(),
            run.org_snapshot_json.as_deref(),
            run.entry_mode.as_str(),
            run.status.as_str(),
            run.work_item_id.as_deref(),
            run.project_slug.as_deref(),
            run.routine_fire_id.as_deref(),
            run.summary.as_deref(),
            run.last_error.as_deref(),
            &run.created_at,
            &run.updated_at,
            run.completed_at.as_deref(),
        ],
    )?;
    Ok(())
}

fn validate_entry_mode(value: &str) -> Result<AgentOrgRunEntryMode, String> {
    AgentOrgRunEntryMode::parse(value)
        .ok_or_else(|| format!("unknown AgentOrgRunEntryMode value: {value:?}"))
}

fn validate_status(value: &str) -> Result<AgentOrgRunStatus, String> {
    AgentOrgRunStatus::parse(value)
        .ok_or_else(|| format!("unknown AgentOrgRunStatus value: {value:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::session::persistence::{upsert_session, UnifiedSessionRecord};

    #[test]
    fn enum_values_round_trip() {
        assert_eq!(
            AgentOrgRunEntryMode::parse(AgentOrgRunEntryMode::StandaloneSession.as_str()),
            Some(AgentOrgRunEntryMode::StandaloneSession)
        );
        assert_eq!(
            AgentOrgRunStatus::parse(AgentOrgRunStatus::Running.as_str()),
            Some(AgentOrgRunStatus::Running)
        );
        assert_eq!(AgentOrgRunStatus::parse("idle"), None);
    }

    /// Build an `AgentOrgsStore` pre-loaded with a single org definition.
    /// Bypasses the disk loader so tests stay hermetic — the sandbox
    /// already isolates `~/.orgii`, but we don't need to touch disk at
    /// all to validate the resolver.
    fn store_with_org(org: OrgDefinition) -> AgentOrgsStore {
        let store = AgentOrgsStore::default();
        store.orgs.lock().unwrap().push(org);
        store
    }

    fn sample_org() -> OrgDefinition {
        OrgDefinition {
            id: "org-walk-test".to_string(),
            name: "WalkTest Org".to_string(),
            role: "lead".to_string(),
            agent_id: "agent-coord".to_string(),
            description: None,
            hierarchy_mode: Default::default(),
            children: vec![OrgMember {
                id: "member-w1".to_string(),
                name: "Worker One".to_string(),
                role: "ic".to_string(),
                agent_id: "agent-w1".to_string(),
                runtime_config: None,
                children: Vec::new(),
            }],
        }
    }

    fn ensure_runtime_schemas() {
        let conn = database::db::get_connection().expect("test sqlite connection");
        crate::foundation::persistence::session_snapshots::ensure_tables_with(&conn)
            .expect("agent sessions schema");
        crate::session::persistence::init(&conn).expect("unified session schema");
        init_schema(&conn).expect("agent org runs schema");
        crate::coordination::agent_member_interventions::init_schema(&conn)
            .expect("member intervention schema");
        crate::coordination::agent_org_tasks::init_schema(&conn).expect("agent team tasks schema");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS code_sessions (
                session_id TEXT PRIMARY KEY,
                cli_agent_type TEXT NOT NULL,
                status TEXT NOT NULL,
                parent_session_id TEXT,
                org_member_id TEXT,
                updated_at TEXT NOT NULL
            );",
        )
        .expect("cli session schema");
    }

    fn create_run_for_root(org: &OrgDefinition, root_session_id: &str) -> AgentOrgRunRecord {
        ensure_runtime_schemas();
        AgentOrgRunStore::create(CreateAgentOrgRunParams {
            org_id: org.id.clone(),
            coordinator_agent_id: "agent-coord".to_string(),
            root_session_id: Some(root_session_id.to_string()),
            org_snapshot: org.clone(),
            entry_mode: AgentOrgRunEntryMode::StandaloneSession,
            status: AgentOrgRunStatus::Running,
            work_item_id: None,
            project_slug: None,
            routine_fire_id: None,
        })
        .expect("create run")
    }

    fn upsert_session_row(session_id: &str, parent_session_id: Option<&str>) {
        upsert_session_row_full(session_id, parent_session_id, None, "running");
    }

    fn upsert_session_row_full(
        session_id: &str,
        parent_session_id: Option<&str>,
        agent_definition_id: Option<&str>,
        status: &str,
    ) {
        upsert_session_row_for_member(
            session_id,
            parent_session_id,
            agent_definition_id,
            None,
            status,
        );
    }

    fn upsert_session_row_for_member(
        session_id: &str,
        parent_session_id: Option<&str>,
        agent_definition_id: Option<&str>,
        org_member_id: Option<&str>,
        status: &str,
    ) {
        ensure_runtime_schemas();
        let record = UnifiedSessionRecord {
            session_id: session_id.to_string(),
            name: format!("test-{session_id}"),
            status: status.to_string(),
            session_type: if parent_session_id.is_some() {
                crate::core::session::persistence::session_type::ORG_MEMBER.to_string()
            } else {
                "agent".to_string()
            },
            parent_session_id: parent_session_id.map(str::to_string),
            agent_definition_id: agent_definition_id.map(str::to_string),
            org_member_id: org_member_id.map(str::to_string),
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            ..Default::default()
        };
        upsert_session(&record).expect("upsert session row");
    }

    fn upsert_cli_session_row_for_member(
        session_id: &str,
        parent_session_id: &str,
        cli_agent_type: &str,
        org_member_id: &str,
        status: &str,
    ) {
        ensure_runtime_schemas();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = database::db::get_connection().expect("test sqlite connection");
        conn.execute(
            "INSERT INTO code_sessions (
                session_id,
                cli_agent_type,
                status,
                parent_session_id,
                org_member_id,
                updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(session_id) DO UPDATE SET
                cli_agent_type = excluded.cli_agent_type,
                status = excluded.status,
                parent_session_id = excluded.parent_session_id,
                org_member_id = excluded.org_member_id,
                updated_at = excluded.updated_at",
            params![
                session_id,
                cli_agent_type,
                status,
                parent_session_id,
                org_member_id,
                now
            ],
        )
        .expect("upsert test CLI session");
    }

    #[test]
    fn context_for_session_with_parent_walk_root_session_direct_hit() {
        let _sandbox = test_helpers::test_env::sandbox();
        let org = sample_org();
        let store = store_with_org(org.clone());
        let _run = create_run_for_root(&org, "root-session-1");
        upsert_session_row("root-session-1", None);

        let ctx = AgentOrgRunStore::context_for_session_with_parent_walk("root-session-1", &store)
            .expect("walk ok")
            .expect("context resolved");
        assert_eq!(ctx.coordinator_agent_id, "agent-coord");
        assert_eq!(ctx.members.len(), 1);
        assert_eq!(ctx.members[0].agent_id, "agent-w1");
    }

    #[test]
    fn context_for_run_uses_launch_snapshot_after_live_org_changes() {
        let _sandbox = test_helpers::test_env::sandbox();
        let org = sample_org();
        let store = store_with_org(org.clone());
        let run = create_run_for_root(&org, "root-session-snapshot");
        upsert_session_row("root-session-snapshot", None);

        {
            let mut orgs = store.orgs.lock().expect("org store lock");
            orgs[0].name = "Edited Live Org".to_string();
            orgs[0].role = "edited lead".to_string();
            orgs[0].children[0].id = "member-edited".to_string();
            orgs[0].children[0].agent_id = "agent-edited".to_string();
        }

        let ctx = AgentOrgRunStore::context_for_run(&run.id, &store)
            .expect("context lookup ok")
            .expect("context resolved");
        assert_eq!(ctx.org_name, "WalkTest Org");
        assert_eq!(ctx.coordinator_role, "lead");
        assert_eq!(ctx.members.len(), 1);
        assert_eq!(ctx.members[0].member_id, "member-w1");
        assert_eq!(ctx.members[0].agent_id, "agent-w1");
    }

    #[test]
    fn context_for_session_preserves_org_hierarchy_mode() {
        for hierarchy_mode in [
            HierarchyMode::Flat,
            HierarchyMode::Soft,
            HierarchyMode::Strict,
        ] {
            let _sandbox = test_helpers::test_env::sandbox();
            let mode_label = match hierarchy_mode {
                HierarchyMode::Flat => "flat",
                HierarchyMode::Soft => "soft",
                HierarchyMode::Strict => "strict",
            };
            let mut org = sample_org();
            org.id = format!("org-mode-{mode_label}");
            org.hierarchy_mode = hierarchy_mode;
            let store = store_with_org(org.clone());
            let root_session_id = format!("root-session-{mode_label}");
            let _run = create_run_for_root(&org, &root_session_id);
            upsert_session_row(&root_session_id, None);

            let ctx =
                AgentOrgRunStore::context_for_session_with_parent_walk(&root_session_id, &store)
                    .expect("walk ok")
                    .expect("context resolved");
            assert_eq!(ctx.hierarchy_mode, hierarchy_mode);
        }
    }

    #[test]
    fn context_for_session_with_parent_walk_one_hop_subagent() {
        let _sandbox = test_helpers::test_env::sandbox();
        let org = sample_org();
        let store = store_with_org(org.clone());
        let _run = create_run_for_root(&org, "root-session-2");
        upsert_session_row("root-session-2", None);
        upsert_session_row("worker-session-2", Some("root-session-2"));

        let ctx =
            AgentOrgRunStore::context_for_session_with_parent_walk("worker-session-2", &store)
                .expect("walk ok")
                .expect("context resolved via parent walk");
        assert_eq!(ctx.run_id, _run.id);
        assert_eq!(ctx.coordinator_agent_id, "agent-coord");
    }

    #[test]
    fn context_for_session_with_parent_walk_cli_member_session() {
        let _sandbox = test_helpers::test_env::sandbox();
        let org = sample_org();
        let store = store_with_org(org.clone());
        let _run = create_run_for_root(&org, "root-session-cli-walk");
        upsert_session_row("root-session-cli-walk", None);
        upsert_cli_session_row_for_member(
            "cli-worker-session-walk",
            "root-session-cli-walk",
            "claude_code",
            "member-w1",
            "running",
        );

        let ctx = AgentOrgRunStore::context_for_session_with_parent_walk(
            "cli-worker-session-walk",
            &store,
        )
        .expect("walk ok")
        .expect("context resolved via CLI parent walk");
        assert_eq!(ctx.run_id, _run.id);
        assert_eq!(ctx.coordinator_agent_id, "agent-coord");
    }

    #[test]
    fn context_for_session_with_parent_walk_two_hop_chain() {
        let _sandbox = test_helpers::test_env::sandbox();
        let org = sample_org();
        let store = store_with_org(org.clone());
        let _run = create_run_for_root(&org, "root-session-3");
        upsert_session_row("root-session-3", None);
        upsert_session_row("mid-session-3", Some("root-session-3"));
        upsert_session_row("leaf-session-3", Some("mid-session-3"));

        let ctx = AgentOrgRunStore::context_for_session_with_parent_walk("leaf-session-3", &store)
            .expect("walk ok")
            .expect("context resolved via 2-hop walk");
        assert_eq!(ctx.run_id, _run.id);
    }

    #[test]
    fn context_for_session_with_parent_walk_unrelated_session_returns_none() {
        let _sandbox = test_helpers::test_env::sandbox();
        let org = sample_org();
        let store = store_with_org(org);
        upsert_session_row("orphan-session", None);

        let ctx = AgentOrgRunStore::context_for_session_with_parent_walk("orphan-session", &store)
            .expect("walk ok");
        assert!(
            ctx.is_none(),
            "session with no matching org_run should resolve to None"
        );
    }

    #[test]
    fn context_for_session_with_parent_walk_unknown_session_returns_none() {
        // A `session_id` that doesn't even have a row in `agent_sessions`
        // (e.g. wire from a stale event) should terminate the walk
        // cleanly, not panic and not error.
        let _sandbox = test_helpers::test_env::sandbox();
        let org = sample_org();
        let store = store_with_org(org);
        ensure_runtime_schemas();

        let ctx = AgentOrgRunStore::context_for_session_with_parent_walk("ghost-session", &store)
            .expect("walk ok");
        assert!(ctx.is_none());
    }

    #[test]
    fn context_for_session_with_parent_walk_breaks_on_cycle() {
        // Synthetic cycle: A → B → A. Should bail out cleanly with None
        // (and a warn log; we don't assert on logs here).
        let _sandbox = test_helpers::test_env::sandbox();
        let org = sample_org();
        let store = store_with_org(org);
        upsert_session_row("cycle-a", Some("cycle-b"));
        upsert_session_row("cycle-b", Some("cycle-a"));

        let ctx = AgentOrgRunStore::context_for_session_with_parent_walk("cycle-a", &store)
            .expect("walk ok despite cycle");
        assert!(
            ctx.is_none(),
            "cyclic parent chain must short-circuit instead of looping forever"
        );
    }

    #[test]
    fn find_worker_session_by_member_id_returns_descendant_with_matching_member_id() {
        let _sandbox = test_helpers::test_env::sandbox();
        let org = sample_org();
        let _store = store_with_org(org.clone());
        let run = create_run_for_root(&org, "coord-root-active");
        upsert_session_row_full("coord-root-active", None, Some("agent-coord"), "running");
        upsert_session_row_for_member(
            "coord-w-active",
            Some("coord-root-active"),
            Some("agent-w1"),
            Some("member-w1"),
            "completed",
        );

        let info = AgentOrgRunStore::find_worker_session_by_member_id(&run.id, "member-w1")
            .expect("query ok")
            .expect("worker found");
        assert_eq!(info.session_id, "coord-w-active");
        assert_eq!(info.status, crate::core::session::SessionStatus::Completed);
    }

    #[test]
    fn find_worker_session_by_member_id_returns_cli_member_session() {
        let _sandbox = test_helpers::test_env::sandbox();
        let org = sample_org();
        let _store = store_with_org(org.clone());
        let run = create_run_for_root(&org, "coord-root-cli-active");
        upsert_session_row_full(
            "coord-root-cli-active",
            None,
            Some("agent-coord"),
            "running",
        );
        upsert_cli_session_row_for_member(
            "cli-worker-active",
            "coord-root-cli-active",
            "claude_code",
            "member-w1",
            "running",
        );

        let sessions = AgentOrgRunStore::list_worker_sessions_by_member_ids(
            &run.id,
            &["member-w1".to_string()],
        )
        .expect("query ok");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "cli-worker-active");
        assert_eq!(sessions[0].agent_definition_id, None);
        assert_eq!(sessions[0].cli_agent_type.as_deref(), Some("claude_code"));

        let info = AgentOrgRunStore::find_worker_session_by_member_id(&run.id, "member-w1")
            .expect("query ok")
            .expect("CLI worker found");
        assert_eq!(info.session_id, "cli-worker-active");
        assert_eq!(info.status, crate::core::session::SessionStatus::Running);
    }

    #[test]
    fn find_worker_session_by_member_id_picks_most_recent_when_multi_instance() {
        let _sandbox = test_helpers::test_env::sandbox();
        let org = sample_org();
        let _store = store_with_org(org.clone());
        let run = create_run_for_root(&org, "coord-root-rotation");
        upsert_session_row_full("coord-root-rotation", None, Some("agent-coord"), "running");
        upsert_session_row_for_member(
            "coord-w-old",
            Some("coord-root-rotation"),
            Some("agent-w1"),
            Some("member-w1"),
            "completed",
        );
        std::thread::sleep(std::time::Duration::from_millis(2));
        upsert_session_row_for_member(
            "coord-w-new",
            Some("coord-root-rotation"),
            Some("agent-w1"),
            Some("member-w1"),
            "completed",
        );
        upsert_session_row_for_member(
            "coord-shared-other-member",
            Some("coord-root-rotation"),
            Some("agent-w1"),
            Some("member-other"),
            "completed",
        );

        let info = AgentOrgRunStore::find_worker_session_by_member_id(&run.id, "member-w1")
            .expect("query ok")
            .expect("worker found");
        assert_eq!(info.session_id, "coord-w-new");
    }

    #[test]
    fn find_worker_session_by_member_id_returns_none_when_materialized_session_missing() {
        let _sandbox = test_helpers::test_env::sandbox();
        let org = sample_org();
        let _store = store_with_org(org.clone());
        let run = create_run_for_root(&org, "coord-root-no-active");
        upsert_session_row_full("coord-root-no-active", None, Some("agent-coord"), "running");
        let info = AgentOrgRunStore::find_worker_session_by_member_id(&run.id, "member-w1")
            .expect("query ok");
        assert!(info.is_none());
    }

    #[test]
    fn find_worker_session_by_member_id_returns_none_for_unknown_run() {
        let _sandbox = test_helpers::test_env::sandbox();
        ensure_runtime_schemas();
        let info = AgentOrgRunStore::find_worker_session_by_member_id("nope-run", "member-w1")
            .expect("query ok on unknown run");
        assert!(info.is_none());
    }

    #[test]
    fn reconcile_if_terminal_completes_run_when_all_tasks_completed() {
        use crate::coordination::agent_org_tasks::{
            AgentOrgTaskStore, CreateTaskParams, TaskStatus,
        };

        let _sandbox = test_helpers::test_env::sandbox();
        let org = sample_org();
        let run = create_run_for_root(&org, "coord-root-final-complete");
        upsert_session_row_full(
            "coord-root-final-complete",
            None,
            Some("agent-coord"),
            "completed",
        );
        upsert_session(&UnifiedSessionRecord {
            session_id: "worker-final-complete".to_string(),
            name: "worker final complete".to_string(),
            status: crate::core::session::SessionStatus::Completed
                .as_str()
                .to_string(),
            session_type: crate::core::session::persistence::session_type::ORG_MEMBER.to_string(),
            parent_session_id: Some("coord-root-final-complete".to_string()),
            agent_definition_id: Some("agent-w1".to_string()),
            org_member_id: Some("member-w1".to_string()),
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            ..Default::default()
        })
        .expect("upsert completed worker");
        AgentOrgTaskStore::create(CreateTaskParams {
            id: "done-task".to_string(),
            org_run_id: run.id.clone(),
            subject: "done".to_string(),
            description: String::new(),
            active_form: None,
            owner: Some("member-w1".to_string()),
            status: TaskStatus::Completed,
            blocks: Vec::new(),
            blocked_by: Vec::new(),
            metadata: None,
        })
        .expect("create completed task");

        let status = AgentOrgRunStore::reconcile_if_terminal(&run.id).expect("reconcile ok");
        assert_eq!(status, Some(AgentOrgRunStatus::Completed));
        let reloaded = load_by_id(&run.id).expect("load run").expect("run exists");
        assert_eq!(reloaded.status, AgentOrgRunStatus::Completed);
        assert!(reloaded.completed_at.is_some());
    }

    #[test]
    fn reconcile_if_terminal_abandons_run_with_open_work_after_all_sessions_terminal() {
        use crate::coordination::agent_org_tasks::{
            AgentOrgTaskStore, CreateTaskParams, TaskStatus,
        };

        let _sandbox = test_helpers::test_env::sandbox();
        let org = sample_org();
        let run = create_run_for_root(&org, "coord-root-final-abandoned");
        upsert_session_row_full(
            "coord-root-final-abandoned",
            None,
            Some("agent-coord"),
            "completed",
        );
        upsert_session(&UnifiedSessionRecord {
            session_id: "worker-final-abandoned".to_string(),
            name: "worker final abandoned".to_string(),
            status: crate::core::session::SessionStatus::Completed
                .as_str()
                .to_string(),
            session_type: crate::core::session::persistence::session_type::ORG_MEMBER.to_string(),
            parent_session_id: Some("coord-root-final-abandoned".to_string()),
            agent_definition_id: Some("agent-w1".to_string()),
            org_member_id: Some("member-w1".to_string()),
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            ..Default::default()
        })
        .expect("upsert completed worker");
        for (id, status) in [
            ("done-a", TaskStatus::Completed),
            ("done-b", TaskStatus::Completed),
            ("done-c", TaskStatus::Completed),
            ("done-d", TaskStatus::Completed),
        ] {
            AgentOrgTaskStore::create(CreateTaskParams {
                id: id.to_string(),
                org_run_id: run.id.clone(),
                subject: id.to_string(),
                description: String::new(),
                active_form: None,
                owner: Some("member-w1".to_string()),
                status,
                blocks: Vec::new(),
                blocked_by: Vec::new(),
                metadata: None,
            })
            .expect("create completed task");
        }
        AgentOrgTaskStore::create(CreateTaskParams {
            id: "ownerless-pending".to_string(),
            org_run_id: run.id.clone(),
            subject: "open task".to_string(),
            description: String::new(),
            active_form: None,
            owner: None,
            status: TaskStatus::Pending,
            blocks: Vec::new(),
            blocked_by: Vec::new(),
            metadata: None,
        })
        .expect("create open task");

        let status = AgentOrgRunStore::reconcile_if_terminal(&run.id).expect("reconcile ok");
        assert_eq!(status, Some(AgentOrgRunStatus::Abandoned));
        let reloaded = load_by_id(&run.id).expect("load run").expect("run exists");
        assert_eq!(reloaded.status, AgentOrgRunStatus::Abandoned);
        assert!(reloaded.completed_at.is_some());
    }

    #[test]
    fn release_tasks_for_stale_workers_releases_only_open_stale_owner_tasks() {
        use crate::coordination::agent_org_tasks::{
            AgentOrgTaskStore, CreateTaskParams, TaskStatus,
        };

        let _sandbox = test_helpers::test_env::sandbox();
        let org = sample_org();
        let run = create_run_for_root(&org, "coord-root-stale-release");
        upsert_session_row_full(
            "coord-root-stale-release",
            None,
            Some("agent-coord"),
            "running",
        );

        let stale_time = chrono::Utc::now() - chrono::Duration::minutes(30);
        let fresh_time = chrono::Utc::now();
        upsert_session(&UnifiedSessionRecord {
            session_id: "worker-stale-release".to_string(),
            name: "stale worker".to_string(),
            status: crate::core::session::SessionStatus::Running
                .as_str()
                .to_string(),
            session_type: crate::core::session::persistence::session_type::ORG_MEMBER.to_string(),
            parent_session_id: Some("coord-root-stale-release".to_string()),
            agent_definition_id: Some("agent-w1".to_string()),
            org_member_id: Some("member-w1".to_string()),
            created_at: stale_time.to_rfc3339(),
            updated_at: stale_time.to_rfc3339(),
            ..Default::default()
        })
        .expect("upsert stale worker");
        upsert_session(&UnifiedSessionRecord {
            session_id: "worker-fresh-release".to_string(),
            name: "fresh worker".to_string(),
            status: crate::core::session::SessionStatus::Running
                .as_str()
                .to_string(),
            session_type: crate::core::session::persistence::session_type::ORG_MEMBER.to_string(),
            parent_session_id: Some("coord-root-stale-release".to_string()),
            agent_definition_id: Some("agent-fresh".to_string()),
            org_member_id: Some("member-fresh".to_string()),
            created_at: fresh_time.to_rfc3339(),
            updated_at: fresh_time.to_rfc3339(),
            ..Default::default()
        })
        .expect("upsert fresh worker");

        AgentOrgTaskStore::create(CreateTaskParams {
            id: "stale-open".to_string(),
            org_run_id: run.id.clone(),
            subject: "stale open".to_string(),
            description: String::new(),
            active_form: None,
            owner: Some("member-w1".to_string()),
            status: TaskStatus::InProgress,
            blocks: Vec::new(),
            blocked_by: Vec::new(),
            metadata: None,
        })
        .expect("create stale open task");
        AgentOrgTaskStore::create(CreateTaskParams {
            id: "stale-completed".to_string(),
            org_run_id: run.id.clone(),
            subject: "stale completed".to_string(),
            description: String::new(),
            active_form: None,
            owner: Some("member-w1".to_string()),
            status: TaskStatus::Completed,
            blocks: Vec::new(),
            blocked_by: Vec::new(),
            metadata: None,
        })
        .expect("create stale completed task");
        AgentOrgTaskStore::create(CreateTaskParams {
            id: "fresh-open".to_string(),
            org_run_id: run.id.clone(),
            subject: "fresh open".to_string(),
            description: String::new(),
            active_form: None,
            owner: Some("member-fresh".to_string()),
            status: TaskStatus::InProgress,
            blocks: Vec::new(),
            blocked_by: Vec::new(),
            metadata: None,
        })
        .expect("create fresh open task");

        let releases = AgentOrgRunStore::release_tasks_for_stale_workers(
            &run.id,
            chrono::Utc::now() - chrono::Duration::minutes(5),
        )
        .expect("release stale workers");
        assert_eq!(releases.len(), 1);
        assert_eq!(
            releases[0].worker.agent_definition_id.as_deref(),
            Some("agent-w1")
        );
        assert_eq!(releases[0].worker.cli_agent_type, None);
        assert_eq!(releases[0].released_tasks.len(), 1);
        assert_eq!(releases[0].released_tasks[0].id, "stale-open");

        let tasks = AgentOrgTaskStore::list(&run.id).expect("list tasks");
        let stale_open = tasks.iter().find(|task| task.id == "stale-open").unwrap();
        assert!(stale_open.owner.is_none());
        assert_eq!(stale_open.status, TaskStatus::Pending);
        let stale_completed = tasks
            .iter()
            .find(|task| task.id == "stale-completed")
            .unwrap();
        assert_eq!(stale_completed.owner.as_deref(), Some("member-w1"));
        assert_eq!(stale_completed.status, TaskStatus::Completed);
        let fresh_open = tasks.iter().find(|task| task.id == "fresh-open").unwrap();
        assert_eq!(fresh_open.owner.as_deref(), Some("member-fresh"));
        assert_eq!(fresh_open.status, TaskStatus::InProgress);
    }

    #[test]
    fn stale_worker_release_excludes_current_member_not_same_agent_siblings() {
        use crate::coordination::agent_org_tasks::{
            AgentOrgTaskStore, CreateTaskParams, TaskStatus,
        };

        let _sandbox = test_helpers::test_env::sandbox();
        let mut org = sample_org();
        org.children = vec![
            OrgMember {
                id: "member-current".to_string(),
                name: "Current".to_string(),
                role: "worker".to_string(),
                agent_id: "shared-agent".to_string(),
                runtime_config: None,
                children: Vec::new(),
            },
            OrgMember {
                id: "member-sibling".to_string(),
                name: "Sibling".to_string(),
                role: "worker".to_string(),
                agent_id: "shared-agent".to_string(),
                runtime_config: None,
                children: Vec::new(),
            },
        ];
        let run = create_run_for_root(&org, "coord-root-same-agent-stale-release");
        upsert_session_row_full(
            "coord-root-same-agent-stale-release",
            None,
            Some("agent-coord"),
            "running",
        );

        let stale_time = chrono::Utc::now() - chrono::Duration::minutes(30);
        for (session_id, member_id) in [
            ("worker-current-stale-release", "member-current"),
            ("worker-sibling-stale-release", "member-sibling"),
        ] {
            upsert_session(&UnifiedSessionRecord {
                session_id: session_id.to_string(),
                name: format!("stale {member_id}"),
                status: crate::core::session::SessionStatus::Running
                    .as_str()
                    .to_string(),
                session_type: crate::core::session::persistence::session_type::ORG_MEMBER
                    .to_string(),
                parent_session_id: Some("coord-root-same-agent-stale-release".to_string()),
                agent_definition_id: Some("shared-agent".to_string()),
                org_member_id: Some(member_id.to_string()),
                created_at: stale_time.to_rfc3339(),
                updated_at: stale_time.to_rfc3339(),
                ..Default::default()
            })
            .expect("upsert stale same-agent worker");
        }

        for (task_id, owner) in [
            ("current-open", "member-current"),
            ("sibling-open", "member-sibling"),
        ] {
            AgentOrgTaskStore::create(CreateTaskParams {
                id: task_id.to_string(),
                org_run_id: run.id.clone(),
                subject: task_id.to_string(),
                description: String::new(),
                active_form: None,
                owner: Some(owner.to_string()),
                status: TaskStatus::InProgress,
                blocks: Vec::new(),
                blocked_by: Vec::new(),
                metadata: None,
            })
            .expect("create same-agent stale task");
        }

        let releases = AgentOrgRunStore::release_tasks_for_stale_workers_except_member(
            &run.id,
            chrono::Utc::now() - chrono::Duration::minutes(5),
            "member-current",
        )
        .expect("release stale same-agent sibling");
        assert_eq!(releases.len(), 1);
        assert_eq!(
            releases[0].worker.member_id.as_deref(),
            Some("member-sibling")
        );
        assert_eq!(releases[0].released_tasks[0].id, "sibling-open");

        let tasks = AgentOrgTaskStore::list(&run.id).expect("list same-agent tasks");
        let current_open = tasks
            .iter()
            .find(|task| task.id == "current-open")
            .expect("current task");
        assert_eq!(current_open.owner.as_deref(), Some("member-current"));
        assert_eq!(current_open.status, TaskStatus::InProgress);
        let sibling_open = tasks
            .iter()
            .find(|task| task.id == "sibling-open")
            .expect("sibling task");
        assert!(sibling_open.owner.is_none());
        assert_eq!(sibling_open.status, TaskStatus::Pending);
    }

    // ── HierarchyMode routing checks ────────────────────────────────
    //
    // Pure-function coverage for `AgentOrgRunContext::check_routing`.
    // The fixture mirrors a real two-branch org so cross-branch hops
    // and the coordinator escape hatch can be exercised independently.
    //
    //     coordinator
    //     ├── lead-a (member-a, agent-a)
    //     │     └── ic-a   (member-a-ic, agent-a-ic)
    //     └── lead-b (member-b, agent-b)
    //           └── ic-b   (member-b-ic, agent-b-ic)
    fn routing_ctx(mode: HierarchyMode) -> AgentOrgRunContext {
        AgentOrgRunContext {
            run_id: "run-routing".into(),
            org_id: "org-routing".into(),
            org_name: "RoutingOrg".into(),
            org_role: "lead".into(),
            coordinator_agent_id: "agent-coord".into(),
            coordinator_name: "RoutingOrg".into(),
            coordinator_role: "lead".into(),
            members: vec![
                AgentOrgContextMember {
                    member_id: "member-a".into(),
                    name: "lead-a".into(),
                    role: "lead".into(),
                    agent_id: "agent-a".into(),
                    parent_member_id: None,
                },
                AgentOrgContextMember {
                    member_id: "member-a-ic".into(),
                    name: "ic-a".into(),
                    role: "ic".into(),
                    agent_id: "agent-a-ic".into(),
                    parent_member_id: Some("member-a".into()),
                },
                AgentOrgContextMember {
                    member_id: "member-b".into(),
                    name: "lead-b".into(),
                    role: "lead".into(),
                    agent_id: "agent-b".into(),
                    parent_member_id: None,
                },
                AgentOrgContextMember {
                    member_id: "member-b-ic".into(),
                    name: "ic-b".into(),
                    role: "ic".into(),
                    agent_id: "agent-b-ic".into(),
                    parent_member_id: Some("member-b".into()),
                },
            ],
            hierarchy_mode: mode,
            root_session_id: None,
        }
    }

    #[test]
    fn routing_flat_allows_anything() {
        let ctx = routing_ctx(HierarchyMode::Flat);
        assert_eq!(
            ctx.check_routing("member-a-ic", "member-b-ic"),
            RoutingDecision::Allowed,
        );
        assert_eq!(
            ctx.check_routing("member-b", "member-a"),
            RoutingDecision::Allowed,
        );
    }

    #[test]
    fn routing_soft_allows_anything() {
        // Soft mode renders reports-to in the prompt as a hint but
        // never enforces — same outcome as Flat for the runtime layer.
        let ctx = routing_ctx(HierarchyMode::Soft);
        assert_eq!(
            ctx.check_routing("member-a-ic", "member-b-ic"),
            RoutingDecision::Allowed,
        );
    }

    #[test]
    fn routing_strict_allows_send_to_coordinator() {
        let ctx = routing_ctx(HierarchyMode::Strict);
        assert_eq!(
            ctx.check_routing("member-a-ic", COORDINATOR_MEMBER_ID),
            RoutingDecision::Allowed,
            "anyone may escalate to the coordinator",
        );
    }

    #[test]
    fn routing_strict_allows_coordinator_to_anyone() {
        let ctx = routing_ctx(HierarchyMode::Strict);
        assert_eq!(
            ctx.check_routing(COORDINATOR_MEMBER_ID, "member-a-ic"),
            RoutingDecision::Allowed,
            "coordinator escape hatch — may reach any member",
        );
    }

    #[test]
    fn routing_strict_allows_send_to_direct_manager() {
        let ctx = routing_ctx(HierarchyMode::Strict);
        assert_eq!(
            ctx.check_routing("member-a-ic", "member-a"),
            RoutingDecision::Allowed,
        );
    }

    #[test]
    fn routing_strict_allows_send_to_direct_report() {
        let ctx = routing_ctx(HierarchyMode::Strict);
        assert_eq!(
            ctx.check_routing("member-a", "member-a-ic"),
            RoutingDecision::Allowed,
        );
    }

    #[test]
    fn routing_strict_blocks_cross_branch() {
        let ctx = routing_ctx(HierarchyMode::Strict);
        let RoutingDecision::Blocked(hint) = ctx.check_routing("member-a-ic", "member-b-ic") else {
            panic!("expected cross-branch send to be blocked");
        };
        assert!(
            hint.contains("sender_member_id 'member-a-ic'"),
            "hint should name the sender member id (got: {hint})",
        );
        assert!(
            hint.contains("recipient_member_id 'member-b-ic'"),
            "hint should name the recipient member id (got: {hint})",
        );
        assert!(
            hint.contains("Allowed recipient_member_id values: coordinator, member-a"),
            "hint should expose the canonical member-id allow-list (got: {hint})",
        );
    }

    #[test]
    fn routing_strict_blocks_skip_level_up() {
        // ic-a sending to its grand-manager (the coordinator's other
        // direct report) is also a violation — only direct manager is
        // allowed.
        let ctx = routing_ctx(HierarchyMode::Strict);
        assert!(matches!(
            ctx.check_routing("member-a-ic", "member-b"),
            RoutingDecision::Blocked(_)
        ));
    }

    #[test]
    fn routing_strict_blocks_peer_to_peer_lead() {
        let ctx = routing_ctx(HierarchyMode::Strict);
        let RoutingDecision::Blocked(hint) = ctx.check_routing("member-a", "member-b") else {
            panic!("peer leads must not contact each other directly");
        };
        assert!(
            hint.contains("Allowed recipient_member_id values: coordinator"),
            "top-level lead should only be allowed to route through coordinator (got: {hint})",
        );
    }

    #[test]
    fn routing_strict_blocks_unknown_sender_with_useful_hint() {
        // A sender that isn't in the roster (shouldn't happen in
        // practice, but the function must not panic): the message
        // should still surface a Blocked decision rather than silently
        // letting it through.
        let ctx = routing_ctx(HierarchyMode::Strict);
        assert!(matches!(
            ctx.check_routing("member-stranger", "member-a-ic"),
            RoutingDecision::Blocked(_)
        ));
    }
}
