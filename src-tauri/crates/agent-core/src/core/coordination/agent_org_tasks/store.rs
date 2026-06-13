use rusqlite::{params, OptionalExtension};

use database::db::{get_connection, with_sessions_writer};

use super::graph::{
    blockers_resolved, find_busy_task, unresolved_blockers, validate_dependency_graph_after_upsert,
};
use super::helpers::{
    encode_json_array, encode_metadata, insert_task_history_event, list_tasks_with_conn,
    now_rfc3339, row_to_task, row_to_task_history_event, SELECT_COLUMNS,
};
use super::{
    ClaimError, ClaimOptions, CreateTaskParams, Task, TaskHistoryEvent, TaskStatus,
    UpdateTaskPatch, TASK_EVENT_CLAIMED, TASK_EVENT_CREATED, TASK_EVENT_RELEASED,
    TASK_EVENT_UPDATED,
};

pub struct AgentOrgTaskStore;

impl AgentOrgTaskStore {
    /// Insert a task. Fails if `(org_run_id, id)` already exists.
    pub fn create(params: CreateTaskParams) -> Result<Task, String> {
        if params.id.trim().is_empty() {
            return Err("task id must be non-empty".into());
        }
        if params.org_run_id.trim().is_empty() {
            return Err("org_run_id must be non-empty".into());
        }
        if params.subject.trim().is_empty() {
            return Err("task subject must be non-empty".into());
        }
        if params.status == TaskStatus::InProgress && params.owner.is_none() {
            return Err("in_progress task must have an owner".into());
        }

        let metadata_json = encode_metadata(params.metadata.as_ref())?;
        let now = now_rfc3339();

        with_sessions_writer(|| -> Result<Task, String> {
            let mut conn = get_connection().map_err(|err| err.to_string())?;
            let tx = conn
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(|err| err.to_string())?;
            let existing_tasks = list_tasks_with_conn(&tx, &params.org_run_id)?;
            validate_dependency_graph_after_upsert(
                &existing_tasks,
                &params.org_run_id,
                &params.id,
                &params.blocks,
                &params.blocked_by,
            )?;
            let blocks_json = encode_json_array(&params.blocks)?;
            let blocked_by_json = encode_json_array(&params.blocked_by)?;

            tx.execute(
                "INSERT INTO agent_org_tasks (
                    id, org_run_id, subject, description, active_form, owner,
                    status, blocks_json, blocked_by_json, metadata_json,
                    created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
                params![
                    &params.id,
                    &params.org_run_id,
                    &params.subject,
                    &params.description,
                    params.active_form.as_deref(),
                    params.owner.as_deref(),
                    params.status.as_wire(),
                    &blocks_json,
                    &blocked_by_json,
                    metadata_json.as_deref(),
                    &now,
                ],
            )
            .map_err(|err| err.to_string())?;

            let task = Task {
                id: params.id,
                org_run_id: params.org_run_id,
                subject: params.subject,
                description: params.description,
                active_form: params.active_form,
                owner: params.owner,
                status: params.status,
                blocks: params.blocks,
                blocked_by: params.blocked_by,
                metadata: params.metadata,
                created_at: now.clone(),
                updated_at: now,
            };
            insert_task_history_event(
                &tx,
                &task.org_run_id,
                &task.id,
                TASK_EVENT_CREATED,
                None,
                &task,
                task.owner.as_deref(),
            )?;
            tx.commit().map_err(|err| err.to_string())?;

            Ok(task)
        })
    }

    pub fn get(org_run_id: &str, task_id: &str) -> Result<Option<Task>, String> {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let sql = format!(
            "SELECT {SELECT_COLUMNS} FROM agent_org_tasks WHERE org_run_id = ?1 AND id = ?2"
        );
        let mut stmt = conn.prepare(&sql).map_err(|err| err.to_string())?;
        let task = stmt
            .query_row(params![org_run_id, task_id], row_to_task)
            .optional()
            .map_err(|err| err.to_string())?;
        Ok(task)
    }

    pub fn list(org_run_id: &str) -> Result<Vec<Task>, String> {
        let conn = get_connection().map_err(|err| err.to_string())?;
        list_tasks_with_conn(&conn, org_run_id)
    }

    pub fn list_history(org_run_id: &str) -> Result<Vec<TaskHistoryEvent>, String> {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, org_run_id, task_id, event_type, previous_owner, next_owner,
                    previous_status, next_status, actor_member_id, created_at
                 FROM agent_org_task_events
                 WHERE org_run_id = ?1
                 ORDER BY created_at ASC, id ASC",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map(params![org_run_id], row_to_task_history_event)
            .map_err(|err| err.to_string())?;
        let mut events = Vec::new();
        for row in rows {
            events.push(row.map_err(|err| err.to_string())?);
        }
        Ok(events)
    }

    /// Apply a partial update. The full updated row is returned. `Err` on
    /// missing row so callers can surface a clear "task_not_found" without
    /// a separate get round-trip.
    pub fn update(org_run_id: &str, task_id: &str, patch: UpdateTaskPatch) -> Result<Task, String> {
        with_sessions_writer(|| Self::update_inner(org_run_id, task_id, patch))
    }

    fn update_inner(
        org_run_id: &str,
        task_id: &str,
        patch: UpdateTaskPatch,
    ) -> Result<Task, String> {
        let mut conn = get_connection().map_err(|err| err.to_string())?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;

        let existing: Option<Task> = {
            let sql = format!(
                "SELECT {SELECT_COLUMNS} FROM agent_org_tasks
                 WHERE org_run_id = ?1 AND id = ?2"
            );
            let mut stmt = tx.prepare(&sql).map_err(|err| err.to_string())?;
            stmt.query_row(params![org_run_id, task_id], row_to_task)
                .optional()
                .map_err(|err| err.to_string())?
        };
        let Some(mut task) = existing else {
            return Err(format!("task_not_found: {task_id} in run {org_run_id}"));
        };
        let previous_task = task.clone();

        if let Some(subject) = patch.subject {
            if subject.trim().is_empty() {
                return Err("task subject must be non-empty".into());
            }
            task.subject = subject;
        }
        if let Some(description) = patch.description {
            task.description = description;
        }
        if let Some(active_form) = patch.active_form {
            task.active_form = active_form;
        }
        if let Some(owner) = patch.owner {
            task.owner = owner;
        }
        if let Some(status) = patch.status {
            task.status = status;
        }
        if task.status == TaskStatus::InProgress && task.owner.is_none() {
            return Err("in_progress task must have an owner".into());
        }
        if let Some(blocks) = patch.blocks {
            task.blocks = blocks;
        }
        if let Some(blocked_by) = patch.blocked_by {
            task.blocked_by = blocked_by;
        }
        if let Some(metadata) = patch.metadata {
            task.metadata = metadata;
        }
        task.updated_at = now_rfc3339();

        let existing_tasks = list_tasks_with_conn(&tx, org_run_id)?;
        validate_dependency_graph_after_upsert(
            &existing_tasks,
            org_run_id,
            &task.id,
            &task.blocks,
            &task.blocked_by,
        )?;
        let blocks_json = encode_json_array(&task.blocks)?;
        let blocked_by_json = encode_json_array(&task.blocked_by)?;
        let metadata_json = encode_metadata(task.metadata.as_ref())?;

        tx.execute(
            "UPDATE agent_org_tasks SET
                subject = ?1,
                description = ?2,
                active_form = ?3,
                owner = ?4,
                status = ?5,
                blocks_json = ?6,
                blocked_by_json = ?7,
                metadata_json = ?8,
                updated_at = ?9
             WHERE org_run_id = ?10 AND id = ?11",
            params![
                &task.subject,
                &task.description,
                task.active_form.as_deref(),
                task.owner.as_deref(),
                task.status.as_wire(),
                &blocks_json,
                &blocked_by_json,
                metadata_json.as_deref(),
                &task.updated_at,
                org_run_id,
                task_id,
            ],
        )
        .map_err(|err| err.to_string())?;
        insert_task_history_event(
            &tx,
            org_run_id,
            task_id,
            TASK_EVENT_UPDATED,
            Some(&previous_task),
            &task,
            task.owner.as_deref(),
        )?;

        tx.commit().map_err(|err| err.to_string())?;
        Ok(task)
    }

    pub fn delete(org_run_id: &str, task_id: &str) -> Result<bool, String> {
        with_sessions_writer(|| -> Result<bool, String> {
            let conn = get_connection().map_err(|err| err.to_string())?;
            let n = conn
                .execute(
                    "DELETE FROM agent_org_tasks WHERE org_run_id = ?1 AND id = ?2",
                    params![org_run_id, task_id],
                )
                .map_err(|err| err.to_string())?;
            Ok(n > 0)
        })
    }

    /// Return the first task in the run that is `pending`, `owner IS
    /// NULL`, and whose `blocked_by` are all `completed`. Ordered by
    /// `created_at ASC` (insertion order).
    pub fn find_available(org_run_id: &str) -> Result<Option<Task>, String> {
        let pending = Self::list(org_run_id)?;
        for task in &pending {
            if task.owner.is_some() {
                continue;
            }
            if task.status != TaskStatus::Pending {
                continue;
            }
            if !blockers_resolved(&pending, &task.blocked_by) {
                continue;
            }
            return Ok(Some(task.clone()));
        }
        Ok(None)
    }

    /// Atomic SQLite CAS-based claim.
    ///
    /// Failure precedence:
    /// 1. `task_not_found`
    /// 2. `already_resolved` (terminal status takes priority over
    ///    ownership: a completed task is not stealable even by its
    ///    original owner)
    /// 3. `already_claimed` (owner != claimant_member_id)
    /// 4. `blocked` (unresolved dependencies)
    /// 5. `member_busy` (only when `check_member_busy = true`)
    ///
    /// On success the task transitions to `(owner = claimant_member_id,
    /// status = in_progress)` and the updated row is returned. Re-claim by
    /// the current owner is idempotent (same status transition).
    pub fn try_claim(
        org_run_id: &str,
        task_id: &str,
        claimant_member_id: &str,
        options: ClaimOptions,
    ) -> Result<Task, ClaimError> {
        if claimant_member_id.trim().is_empty() {
            return Err(ClaimError::Storage(
                "claimant_member_id must be non-empty".into(),
            ));
        }

        with_sessions_writer(|| {
            Self::try_claim_inner(org_run_id, task_id, claimant_member_id, options)
        })
    }

    fn try_claim_inner(
        org_run_id: &str,
        task_id: &str,
        claimant_member_id: &str,
        options: ClaimOptions,
    ) -> Result<Task, ClaimError> {
        let mut conn = get_connection().map_err(|err| ClaimError::Storage(err.to_string()))?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|err| ClaimError::Storage(err.to_string()))?;

        let task: Task = {
            let sql = format!(
                "SELECT {SELECT_COLUMNS} FROM agent_org_tasks
                 WHERE org_run_id = ?1 AND id = ?2"
            );
            let mut stmt = tx
                .prepare(&sql)
                .map_err(|err| ClaimError::Storage(err.to_string()))?;
            match stmt
                .query_row(params![org_run_id, task_id], row_to_task)
                .optional()
                .map_err(|err| ClaimError::Storage(err.to_string()))?
            {
                Some(row) => row,
                None => return Err(ClaimError::TaskNotFound),
            }
        };

        if task.status.is_resolved() {
            return Err(ClaimError::AlreadyResolved {
                status: task.status,
            });
        }
        if let Some(owner) = &task.owner {
            if owner != claimant_member_id {
                return Err(ClaimError::AlreadyClaimed {
                    current_owner: owner.clone(),
                });
            }
        }

        let all_in_run = {
            let sql = format!(
                "SELECT {SELECT_COLUMNS} FROM agent_org_tasks
                 WHERE org_run_id = ?1
                 ORDER BY created_at ASC, id ASC"
            );
            let mut stmt = tx
                .prepare(&sql)
                .map_err(|err| ClaimError::Storage(err.to_string()))?;
            let rows = stmt
                .query_map(params![org_run_id], row_to_task)
                .map_err(|err| ClaimError::Storage(err.to_string()))?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(|err| ClaimError::Storage(err.to_string()))?);
            }
            out
        };

        let unresolved = unresolved_blockers(&all_in_run, &task.blocked_by);
        if !unresolved.is_empty() {
            return Err(ClaimError::Blocked {
                by_task_ids: unresolved,
            });
        }

        if options.check_member_busy {
            if let Some(busy_with) = find_busy_task(&all_in_run, claimant_member_id, &task.id) {
                return Err(ClaimError::MemberBusy { busy_with });
            }
        }

        let now = now_rfc3339();
        let updated = tx
            .execute(
                "UPDATE agent_org_tasks SET owner = ?1, status = ?2, updated_at = ?3
                 WHERE org_run_id = ?4 AND id = ?5
                   AND status != ?6
                   AND (owner IS NULL OR owner = ?1)",
                params![
                    claimant_member_id,
                    TaskStatus::InProgress.as_wire(),
                    &now,
                    org_run_id,
                    task_id,
                    TaskStatus::Completed.as_wire(),
                ],
            )
            .map_err(|err| ClaimError::Storage(err.to_string()))?;

        if updated == 0 {
            // Lost the CAS race. Re-read to surface the precise reason.
            let sql = format!(
                "SELECT {SELECT_COLUMNS} FROM agent_org_tasks
                 WHERE org_run_id = ?1 AND id = ?2"
            );
            let mut stmt = tx
                .prepare(&sql)
                .map_err(|err| ClaimError::Storage(err.to_string()))?;
            let race_winner: Task = stmt
                .query_row(params![org_run_id, task_id], row_to_task)
                .map_err(|err| ClaimError::Storage(err.to_string()))?;
            if race_winner.status.is_resolved() {
                return Err(ClaimError::AlreadyResolved {
                    status: race_winner.status,
                });
            }
            if let Some(owner) = &race_winner.owner {
                if owner != claimant_member_id {
                    return Err(ClaimError::AlreadyClaimed {
                        current_owner: owner.clone(),
                    });
                }
            }
            return Err(ClaimError::Storage(
                "claim CAS failed for unknown reason".into(),
            ));
        }

        let mut claimed = task.clone();
        claimed.owner = Some(claimant_member_id.to_string());
        claimed.status = TaskStatus::InProgress;
        claimed.updated_at = now;
        insert_task_history_event(
            &tx,
            org_run_id,
            task_id,
            TASK_EVENT_CLAIMED,
            Some(&task),
            &claimed,
            Some(claimant_member_id),
        )
        .map_err(ClaimError::Storage)?;

        tx.commit()
            .map_err(|err| ClaimError::Storage(err.to_string()))?;

        Ok(claimed)
    }

    /// Clear `owner` and reset `status` to `pending` for every
    /// non-completed task currently owned by the given member_id in the
    /// run. Used by the member-shutdown hook so a worker dying
    /// mid-task does not leave its in-flight rows orphaned.
    ///
    /// Returns the list of tasks that were unassigned (full updated
    /// rows). Empty list if the member owns nothing or only completed
    /// tasks.
    pub fn unassign_for_owner(
        org_run_id: &str,
        owner_member_id: &str,
    ) -> Result<Vec<Task>, String> {
        with_sessions_writer(|| Self::unassign_for_owner_inner(org_run_id, owner_member_id))
    }

    fn unassign_for_owner_inner(
        org_run_id: &str,
        owner_member_id: &str,
    ) -> Result<Vec<Task>, String> {
        let mut conn = get_connection().map_err(|err| err.to_string())?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;

        let owned: Vec<Task> = {
            let sql = format!(
                "SELECT {SELECT_COLUMNS} FROM agent_org_tasks
                 WHERE org_run_id = ?1 AND owner = ?2 AND status != ?3
                 ORDER BY created_at ASC, id ASC"
            );
            let mut stmt = tx.prepare(&sql).map_err(|err| err.to_string())?;
            let rows = stmt
                .query_map(
                    params![org_run_id, owner_member_id, TaskStatus::Completed.as_wire()],
                    row_to_task,
                )
                .map_err(|err| err.to_string())?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(|err| err.to_string())?);
            }
            out
        };

        if owned.is_empty() {
            tx.commit().map_err(|err| err.to_string())?;
            return Ok(Vec::new());
        }

        let now = now_rfc3339();
        let mut updated_rows = Vec::with_capacity(owned.len());
        for task in owned {
            tx.execute(
                "UPDATE agent_org_tasks
                 SET owner = NULL, status = ?1, updated_at = ?2
                 WHERE org_run_id = ?3 AND id = ?4 AND owner = ?5",
                params![
                    TaskStatus::Pending.as_wire(),
                    &now,
                    org_run_id,
                    &task.id,
                    owner_member_id,
                ],
            )
            .map_err(|err| err.to_string())?;
            let mut updated_task = task.clone();
            updated_task.owner = None;
            updated_task.status = TaskStatus::Pending;
            updated_task.updated_at = now.clone();
            insert_task_history_event(
                &tx,
                org_run_id,
                &updated_task.id,
                TASK_EVENT_RELEASED,
                Some(&task),
                &updated_task,
                Some(owner_member_id),
            )?;
            updated_rows.push(updated_task);
        }

        tx.commit().map_err(|err| err.to_string())?;
        Ok(updated_rows)
    }

    pub fn requeue_in_progress_for_owner(
        org_run_id: &str,
        owner_member_id: &str,
    ) -> Result<Vec<Task>, String> {
        with_sessions_writer(|| {
            Self::requeue_in_progress_for_owner_inner(org_run_id, owner_member_id)
        })
    }

    fn requeue_in_progress_for_owner_inner(
        org_run_id: &str,
        owner_member_id: &str,
    ) -> Result<Vec<Task>, String> {
        let mut conn = get_connection().map_err(|err| err.to_string())?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;

        let owned: Vec<Task> = {
            let sql = format!(
                "SELECT {SELECT_COLUMNS} FROM agent_org_tasks
                 WHERE org_run_id = ?1 AND owner = ?2 AND status = ?3
                 ORDER BY created_at ASC, id ASC"
            );
            let mut stmt = tx.prepare(&sql).map_err(|err| err.to_string())?;
            let rows = stmt
                .query_map(
                    params![
                        org_run_id,
                        owner_member_id,
                        TaskStatus::InProgress.as_wire()
                    ],
                    row_to_task,
                )
                .map_err(|err| err.to_string())?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(|err| err.to_string())?);
            }
            out
        };

        if owned.is_empty() {
            tx.commit().map_err(|err| err.to_string())?;
            return Ok(Vec::new());
        }

        let now = now_rfc3339();
        let mut updated_rows = Vec::with_capacity(owned.len());
        for task in owned {
            tx.execute(
                "UPDATE agent_org_tasks
                 SET status = ?1, updated_at = ?2
                 WHERE org_run_id = ?3 AND id = ?4 AND owner = ?5 AND status = ?6",
                params![
                    TaskStatus::Pending.as_wire(),
                    &now,
                    org_run_id,
                    &task.id,
                    owner_member_id,
                    TaskStatus::InProgress.as_wire(),
                ],
            )
            .map_err(|err| err.to_string())?;
            let mut updated_task = task.clone();
            updated_task.status = TaskStatus::Pending;
            updated_task.updated_at = now.clone();
            insert_task_history_event(
                &tx,
                org_run_id,
                &updated_task.id,
                TASK_EVENT_RELEASED,
                Some(&task),
                &updated_task,
                Some(owner_member_id),
            )?;
            updated_rows.push(updated_task);
        }

        tx.commit().map_err(|err| err.to_string())?;
        Ok(updated_rows)
    }

    /// Returns `true` iff `owner_member_id` currently owns at least one
    /// non-completed task in the run. Used by the autonomous claim
    /// path so a member that already has work in flight does not steal
    /// another row.
    pub fn has_open_task_for_owner(
        org_run_id: &str,
        owner_member_id: &str,
    ) -> Result<bool, String> {
        let conn = get_connection().map_err(|err| err.to_string())?;
        let sql = "SELECT COUNT(*) FROM agent_org_tasks
                   WHERE org_run_id = ?1 AND owner = ?2 AND status != ?3";
        let count: i64 = conn
            .query_row(
                sql,
                params![org_run_id, owner_member_id, TaskStatus::Completed.as_wire()],
                |row| row.get(0),
            )
            .map_err(|err| err.to_string())?;
        Ok(count > 0)
    }
}
