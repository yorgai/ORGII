use std::collections::HashSet;

use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension};

use crate::coordination::agent_member_interventions::AgentMemberInterventionStore;
use crate::coordination::agent_org_tasks::{AgentOrgTaskStore, TaskStatus};
use crate::definitions::orgs::AgentOrgsStore;
use database::db::{get_connection, with_sessions_writer};

use super::helpers::{
    context_for_run_record, insert_run, load_by_id, load_by_root_session, parent_session_id_of,
    row_to_run, validate_entry_mode, validate_status,
};
use super::worker::{StaleWorkerRelease, WorkerSessionInfo, WorkerSessionRuntime};
use super::{
    AgentOrgRunContext, AgentOrgRunRecord, AgentOrgRunStatus, CreateAgentOrgRunParams,
    COORDINATOR_MEMBER_ID,
};

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

        with_sessions_writer(|| -> Result<(), String> {
            let conn = get_connection().map_err(|err| err.to_string())?;
            insert_run(&conn, &run).map_err(|err| err.to_string())?;
            Ok(())
        })?;
        Ok(run)
    }

    /// Pause a running run. Only transitions `running → paused`; already
    /// non-running runs are left unchanged and return `Ok(false)` (idempotent).
    pub fn mark_paused(run_id: &str) -> Result<bool, String> {
        let paused = validate_status(AgentOrgRunStatus::Paused.as_str())?;
        let running = validate_status(AgentOrgRunStatus::Running.as_str())?;
        let now = chrono::Utc::now().to_rfc3339();
        with_sessions_writer(|| -> Result<bool, String> {
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
        })
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
        with_sessions_writer(|| -> Result<usize, String> {
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
        })
    }

    /// Resume a paused run. Only transitions `paused → running`; already
    /// non-paused runs are left unchanged and return `Ok(false)` (idempotent).
    pub fn mark_resumed(run_id: &str) -> Result<bool, String> {
        let running = validate_status(AgentOrgRunStatus::Running.as_str())?;
        let paused = validate_status(AgentOrgRunStatus::Paused.as_str())?;
        let now = chrono::Utc::now().to_rfc3339();
        with_sessions_writer(|| -> Result<bool, String> {
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
        })
    }

    pub fn mark_failed(run_id: &str, error_message: &str) -> Result<(), String> {
        let status = validate_status(AgentOrgRunStatus::Failed.as_str())?;
        let now = chrono::Utc::now().to_rfc3339();
        with_sessions_writer(|| -> Result<(), String> {
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
        })
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
        with_sessions_writer(|| -> Result<(), String> {
            let conn = get_connection().map_err(|err| err.to_string())?;
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
            Ok(())
        })?;
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
        with_sessions_writer(|| -> Result<(), String> {
            let conn = get_connection().map_err(|err| err.to_string())?;
            conn.execute("DELETE FROM agent_org_runs WHERE id = ?1", params![run_id])
                .map_err(|err| err.to_string())?;
            Ok(())
        })
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
