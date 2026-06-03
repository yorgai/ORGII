//! SQLite-backed RoutineDefinition and RoutineFire IO.

use rusqlite::{params, OptionalExtension};

use super::helpers::{conn, from_iso8601, map_db, now_ms, to_iso8601};
use crate::projects::types::{
    RoutineConcurrencyPolicy, RoutineDefinition, RoutineFire, RoutineFireStatus,
    RoutineOutputPolicy, RoutineRunTemplate, RoutineTrigger,
};

fn timestamp_id(prefix: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{prefix}-{nanos}")
}

fn encode_json<T: serde::Serialize>(label: &str, value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|err| format!("serialize {label}: {err}"))
}

fn row_to_routine(row: &rusqlite::Row<'_>) -> rusqlite::Result<RoutineDefinition> {
    let trigger_json: String = row.get(4)?;
    let template_json: String = row.get(5)?;
    let output_policy_json: String = row.get(6)?;

    Ok(RoutineDefinition {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        enabled: row.get::<_, i64>(3)? != 0,
        trigger: serde_json::from_str::<RoutineTrigger>(&trigger_json).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(err))
        })?,
        run_template: serde_json::from_str::<RoutineRunTemplate>(&template_json).map_err(
            |err| {
                rusqlite::Error::FromSqlConversionFailure(
                    5,
                    rusqlite::types::Type::Text,
                    Box::new(err),
                )
            },
        )?,
        output_policy: decode_output_policy(&output_policy_json)?,
        created_at: to_iso8601(row.get(7)?),
        updated_at: to_iso8601(row.get(8)?),
    })
}

fn decode_output_policy(raw: &str) -> rusqlite::Result<RoutineOutputPolicy> {
    if raw.trim().is_empty() || raw.trim() == "{}" {
        return Ok(RoutineOutputPolicy::default());
    }
    serde_json::from_str::<RoutineOutputPolicy>(raw).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(err))
    })
}

fn row_to_fire(row: &rusqlite::Row<'_>) -> rusqlite::Result<RoutineFire> {
    let status_raw: String = row.get(3)?;
    let status = match status_raw.as_str() {
        "pending" => RoutineFireStatus::Pending,
        "started" => RoutineFireStatus::Started,
        "succeeded" => RoutineFireStatus::Succeeded,
        "failed" => RoutineFireStatus::Failed,
        "skipped" => RoutineFireStatus::Skipped,
        "coalesced" => RoutineFireStatus::Coalesced,
        "queued" => RoutineFireStatus::Queued,
        other => {
            return Err(rusqlite::Error::FromSqlConversionFailure(
                3,
                rusqlite::types::Type::Text,
                format!("unknown routine fire status: {other}").into(),
            ));
        }
    };

    Ok(RoutineFire {
        id: row.get(0)?,
        routine_id: row.get(1)?,
        fired_at: to_iso8601(row.get(2)?),
        status,
        session_id: row.get(4)?,
        agent_org_run_id: row.get(5)?,
        work_item_id: row.get(6)?,
        coalesced_into_fire_id: row.get(7)?,
        idempotency_key: row.get(8)?,
        started_at: row.get::<_, Option<i64>>(9)?.map(to_iso8601),
        completed_at: row.get::<_, Option<i64>>(10)?.map(to_iso8601),
        error: row.get(11)?,
    })
}

fn status_to_str(status: &RoutineFireStatus) -> &'static str {
    match status {
        RoutineFireStatus::Pending => "pending",
        RoutineFireStatus::Started => "started",
        RoutineFireStatus::Succeeded => "succeeded",
        RoutineFireStatus::Failed => "failed",
        RoutineFireStatus::Skipped => "skipped",
        RoutineFireStatus::Coalesced => "coalesced",
        RoutineFireStatus::Queued => "queued",
    }
}

pub fn list_routines() -> Result<Vec<RoutineDefinition>, String> {
    let connection = conn()?;
    let mut stmt = map_db(connection.prepare(
        "SELECT id, name, description, enabled, trigger_json, run_template_json,
                output_policy_json, created_at, updated_at
         FROM routine_definitions
         ORDER BY updated_at DESC, created_at DESC",
    ))?;
    let rows = map_db(stmt.query_map([], row_to_routine))?;
    let mut routines = Vec::new();
    for entry in rows {
        routines.push(map_db(entry)?);
    }
    Ok(routines)
}

pub fn read_routine(id: &str) -> Result<RoutineDefinition, String> {
    let connection = conn()?;
    let routine = map_db(
        connection
            .query_row(
                "SELECT id, name, description, enabled, trigger_json, run_template_json,
                        output_policy_json, created_at, updated_at
                 FROM routine_definitions
                 WHERE id = ?1",
                params![id],
                row_to_routine,
            )
            .optional(),
    )?;
    routine.ok_or_else(|| format!("Routine not found: {id}"))
}

pub fn upsert_routine(mut routine: RoutineDefinition) -> Result<RoutineDefinition, String> {
    let connection = conn()?;
    let now = now_ms();
    if routine.id.trim().is_empty() {
        routine.id = timestamp_id("routine");
    }
    if routine.created_at.trim().is_empty() {
        routine.created_at = to_iso8601(now);
    }
    routine.updated_at = to_iso8601(now);

    let created_at_ms = from_iso8601(&routine.created_at);
    let trigger_json = encode_json("routine trigger", &routine.trigger)?;
    let template_json = encode_json("routine run template", &routine.run_template)?;
    let output_policy_json = encode_json("routine output policy", &routine.output_policy)?;

    map_db(connection.execute(
        "INSERT INTO routine_definitions (
            id, name, description, enabled, trigger_json, run_template_json,
            output_policy_json, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            enabled = excluded.enabled,
            trigger_json = excluded.trigger_json,
            run_template_json = excluded.run_template_json,
            output_policy_json = excluded.output_policy_json,
            updated_at = excluded.updated_at",
        params![
            routine.id,
            routine.name,
            routine.description,
            if routine.enabled { 1 } else { 0 },
            trigger_json,
            template_json,
            output_policy_json,
            created_at_ms,
            now,
        ],
    ))?;

    read_routine(&routine.id)
}

pub fn delete_routine(id: &str) -> Result<bool, String> {
    let connection = conn()?;
    let removed =
        map_db(connection.execute("DELETE FROM routine_definitions WHERE id = ?1", [id]))?;
    Ok(removed > 0)
}

pub fn list_routine_fires(routine_id: &str) -> Result<Vec<RoutineFire>, String> {
    let connection = conn()?;
    let mut stmt = map_db(connection.prepare(
        "SELECT id, routine_id, fired_at, status, session_id, agent_org_run_id,
                work_item_id, coalesced_into_fire_id, idempotency_key, started_at,
                completed_at, error
         FROM routine_fires
         WHERE routine_id = ?1
         ORDER BY fired_at DESC",
    ))?;
    let rows = map_db(stmt.query_map([routine_id], row_to_fire))?;
    let mut fires = Vec::new();
    for entry in rows {
        fires.push(map_db(entry)?);
    }
    Ok(fires)
}

pub fn create_routine_fire(routine_id: &str) -> Result<RoutineFire, String> {
    let mut connection = conn()?;
    let transaction =
        map_db(connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate))?;
    let fire = insert_routine_fire_in_transaction(
        &transaction,
        routine_id,
        RoutineFireStatus::Pending,
        None,
        None,
        None,
        None,
        None,
    )?;
    map_db(transaction.commit())?;
    Ok(fire)
}

pub fn create_routine_fire_for_policy(
    routine_id: &str,
    policy: &RoutineOutputPolicy,
) -> Result<RoutineFire, String> {
    let mut connection = conn()?;
    let transaction =
        map_db(connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate))?;
    let active = find_active_routine_fire_in_transaction(&transaction, routine_id)?;
    let fire = match active {
        None => insert_routine_fire_in_transaction(
            &transaction,
            routine_id,
            RoutineFireStatus::Pending,
            None,
            None,
            None,
            None,
            None,
        )?,
        Some(active_fire) => match policy.concurrency_policy {
            RoutineConcurrencyPolicy::CoalesceIfActive => insert_routine_fire_in_transaction(
                &transaction,
                routine_id,
                RoutineFireStatus::Coalesced,
                None,
                Some(active_fire.id),
                None,
                Some("Coalesced into active routine fire".to_string()),
                Some(now_ms()),
            )?,
            RoutineConcurrencyPolicy::SkipIfActive => insert_routine_fire_in_transaction(
                &transaction,
                routine_id,
                RoutineFireStatus::Skipped,
                None,
                None,
                None,
                Some(format!(
                    "Skipped because routine has active fire {}",
                    active_fire.id
                )),
                Some(now_ms()),
            )?,
            RoutineConcurrencyPolicy::QueueIfActive => insert_routine_fire_in_transaction(
                &transaction,
                routine_id,
                RoutineFireStatus::Queued,
                None,
                None,
                None,
                Some(format!("Queued behind active fire {}", active_fire.id)),
                None,
            )?,
            RoutineConcurrencyPolicy::AlwaysCreate => insert_routine_fire_in_transaction(
                &transaction,
                routine_id,
                RoutineFireStatus::Pending,
                None,
                None,
                None,
                None,
                None,
            )?,
        },
    };
    map_db(transaction.commit())?;
    Ok(fire)
}

fn find_active_routine_fire_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    routine_id: &str,
) -> Result<Option<RoutineFire>, String> {
    map_db(
        transaction
            .query_row(
                "SELECT id, routine_id, fired_at, status, session_id, agent_org_run_id,
                        work_item_id, coalesced_into_fire_id, idempotency_key, started_at,
                        completed_at, error
                 FROM routine_fires
                 WHERE routine_id = ?1 AND status IN ('pending', 'started', 'queued')
                 ORDER BY fired_at DESC
                 LIMIT 1",
                params![routine_id],
                row_to_fire,
            )
            .optional(),
    )
}

fn insert_routine_fire_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    routine_id: &str,
    status: RoutineFireStatus,
    session_id: Option<String>,
    coalesced_into_fire_id: Option<String>,
    idempotency_key: Option<String>,
    error: Option<String>,
    completed_at_ms: Option<i64>,
) -> Result<RoutineFire, String> {
    let now = now_ms();
    let fire = RoutineFire {
        id: timestamp_id("routine-fire"),
        routine_id: routine_id.to_string(),
        fired_at: to_iso8601(now),
        status,
        session_id,
        agent_org_run_id: None,
        work_item_id: None,
        coalesced_into_fire_id,
        idempotency_key,
        started_at: None,
        completed_at: completed_at_ms.map(to_iso8601),
        error,
    };
    map_db(transaction.execute(
        "INSERT INTO routine_fires (
            id, routine_id, fired_at, status, session_id, agent_org_run_id,
            work_item_id, coalesced_into_fire_id, idempotency_key, started_at,
            completed_at, error
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            &fire.id,
            &fire.routine_id,
            now,
            status_to_str(&fire.status),
            &fire.session_id,
            &fire.agent_org_run_id,
            &fire.work_item_id,
            &fire.coalesced_into_fire_id,
            &fire.idempotency_key,
            fire.started_at.as_deref().map(from_iso8601),
            fire.completed_at.as_deref().map(from_iso8601),
            &fire.error,
        ],
    ))?;
    Ok(fire)
}

pub fn mark_routine_fire_started(
    fire_id: &str,
    session_id: &str,
    agent_org_run_id: Option<&str>,
) -> Result<RoutineFire, String> {
    let connection = conn()?;
    let now = now_ms();
    map_db(connection.execute(
        "UPDATE routine_fires
         SET status = ?2, session_id = ?3, agent_org_run_id = ?4, started_at = ?5, error = NULL
         WHERE id = ?1",
        params![fire_id, "started", session_id, agent_org_run_id, now],
    ))?;
    read_routine_fire(fire_id)
}

pub fn mark_routine_fire_work_item_created(
    fire_id: &str,
    work_item_id: &str,
) -> Result<RoutineFire, String> {
    let connection = conn()?;
    let now = now_ms();
    map_db(connection.execute(
        "UPDATE routine_fires
         SET status = ?2, work_item_id = ?3, started_at = ?4, completed_at = ?5, error = NULL
         WHERE id = ?1",
        params![fire_id, "succeeded", work_item_id, now, now],
    ))?;
    read_routine_fire(fire_id)
}

pub fn mark_routine_fire_failed(fire_id: &str, error: &str) -> Result<RoutineFire, String> {
    let connection = conn()?;
    let now = now_ms();
    map_db(connection.execute(
        "UPDATE routine_fires
         SET status = ?2, error = ?3, completed_at = ?4
         WHERE id = ?1",
        params![fire_id, "failed", error, now],
    ))?;
    read_routine_fire(fire_id)
}

fn read_routine_fire(fire_id: &str) -> Result<RoutineFire, String> {
    let connection = conn()?;
    let fire = map_db(
        connection
            .query_row(
                "SELECT id, routine_id, fired_at, status, session_id, agent_org_run_id,
                        work_item_id, coalesced_into_fire_id, idempotency_key, started_at,
                        completed_at, error
                 FROM routine_fires
                 WHERE id = ?1",
                params![fire_id],
                row_to_fire,
            )
            .optional(),
    )?;
    fire.ok_or_else(|| format!("Routine fire not found: {fire_id}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::types::{
        RoutineCatchUpPolicy, RoutineOutputMode, RoutineResourceSelection, RoutineRunTarget,
        RoutineWorkspaceTarget,
    };
    use test_helpers::test_env;

    fn routine_fixture(id: &str, policy: RoutineOutputPolicy) -> RoutineDefinition {
        RoutineDefinition {
            id: id.to_string(),
            name: format!("Routine {id}"),
            description: "Routine test fixture".to_string(),
            enabled: true,
            trigger: RoutineTrigger::OneTime {
                at: "2026-05-30T00:00:00Z".to_string(),
            },
            run_template: RoutineRunTemplate {
                prompt: "Ask about the fixture".to_string(),
                target: RoutineRunTarget::AgentDefinition {
                    agent_definition_id: Some("builtin:sde".to_string()),
                },
                resources: RoutineResourceSelection {
                    key_source: Some("own_key".to_string()),
                    account_id: Some("account-1".to_string()),
                    model: Some("model-1".to_string()),
                    native_harness_type: None,
                },
                workspace: RoutineWorkspaceTarget::LocalWorkspace {
                    workspace_path: "/tmp/orgii-routine-test".to_string(),
                    additional_directories: vec![],
                },
                mode: Some("ask".to_string()),
                name: Some("Routine fixture session".to_string()),
            },
            output_policy: policy,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn policy(concurrency_policy: RoutineConcurrencyPolicy) -> RoutineOutputPolicy {
        RoutineOutputPolicy {
            mode: RoutineOutputMode::DirectSession,
            concurrency_policy,
            catch_up_policy: RoutineCatchUpPolicy::RunOnce,
            max_catch_up_runs: 1,
            idempotency_scope: "routine_fire".to_string(),
            create_work_item_status: "planned".to_string(),
            create_work_item_project_slug: None,
            create_work_item_title: None,
            create_work_item_body: None,
        }
    }

    #[test]
    fn upsert_round_trips_output_policy() {
        let _sandbox = test_env::sandbox();
        let saved = upsert_routine(routine_fixture(
            "routine-roundtrip",
            policy(RoutineConcurrencyPolicy::QueueIfActive),
        ))
        .expect("upsert routine");

        assert_eq!(
            saved.output_policy.concurrency_policy,
            RoutineConcurrencyPolicy::QueueIfActive
        );
        assert_eq!(saved.output_policy.mode, RoutineOutputMode::DirectSession);
        assert_eq!(saved.output_policy.idempotency_scope, "routine_fire");

        let read = read_routine("routine-roundtrip").expect("read routine");
        assert_eq!(read.output_policy, saved.output_policy);
    }

    #[test]
    fn empty_output_policy_json_decodes_to_default_policy() {
        assert_eq!(
            decode_output_policy("{}").expect("decode default"),
            RoutineOutputPolicy::default()
        );
        assert_eq!(
            decode_output_policy("   ").expect("decode blank default"),
            RoutineOutputPolicy::default()
        );
    }

    #[test]
    fn coalesce_policy_records_pointer_without_session() {
        let _sandbox = test_env::sandbox();
        upsert_routine(routine_fixture(
            "routine-coalesce",
            policy(RoutineConcurrencyPolicy::CoalesceIfActive),
        ))
        .expect("upsert routine");

        let first = create_routine_fire_for_policy(
            "routine-coalesce",
            &policy(RoutineConcurrencyPolicy::CoalesceIfActive),
        )
        .expect("first fire");
        let second = create_routine_fire_for_policy(
            "routine-coalesce",
            &policy(RoutineConcurrencyPolicy::CoalesceIfActive),
        )
        .expect("second fire");

        assert_eq!(first.status, RoutineFireStatus::Pending);
        assert_eq!(second.status, RoutineFireStatus::Coalesced);
        assert_eq!(
            second.coalesced_into_fire_id.as_deref(),
            Some(first.id.as_str())
        );
        assert!(second.session_id.is_none());
        assert!(second.completed_at.is_some());
    }

    #[test]
    fn skip_policy_records_terminal_fire_without_session() {
        let _sandbox = test_env::sandbox();
        upsert_routine(routine_fixture(
            "routine-skip",
            policy(RoutineConcurrencyPolicy::SkipIfActive),
        ))
        .expect("upsert routine");

        let first = create_routine_fire_for_policy(
            "routine-skip",
            &policy(RoutineConcurrencyPolicy::SkipIfActive),
        )
        .expect("first fire");
        let second = create_routine_fire_for_policy(
            "routine-skip",
            &policy(RoutineConcurrencyPolicy::SkipIfActive),
        )
        .expect("second fire");

        assert_eq!(first.status, RoutineFireStatus::Pending);
        assert_eq!(second.status, RoutineFireStatus::Skipped);
        assert!(second.session_id.is_none());
        assert!(second.completed_at.is_some());
        assert!(second
            .error
            .as_deref()
            .is_some_and(|error| error.contains(first.id.as_str())));
    }

    #[test]
    fn queue_policy_records_non_terminal_queued_fire() {
        let _sandbox = test_env::sandbox();
        upsert_routine(routine_fixture(
            "routine-queue",
            policy(RoutineConcurrencyPolicy::QueueIfActive),
        ))
        .expect("upsert routine");

        let first = create_routine_fire_for_policy(
            "routine-queue",
            &policy(RoutineConcurrencyPolicy::QueueIfActive),
        )
        .expect("first fire");
        let second = create_routine_fire_for_policy(
            "routine-queue",
            &policy(RoutineConcurrencyPolicy::QueueIfActive),
        )
        .expect("second fire");

        assert_eq!(first.status, RoutineFireStatus::Pending);
        assert_eq!(second.status, RoutineFireStatus::Queued);
        assert!(second.session_id.is_none());
        assert!(second.completed_at.is_none());
        assert!(second
            .error
            .as_deref()
            .is_some_and(|error| error.contains(first.id.as_str())));
    }

    #[test]
    fn always_create_policy_ignores_active_fire() {
        let _sandbox = test_env::sandbox();
        upsert_routine(routine_fixture(
            "routine-always",
            policy(RoutineConcurrencyPolicy::AlwaysCreate),
        ))
        .expect("upsert routine");

        let first = create_routine_fire_for_policy(
            "routine-always",
            &policy(RoutineConcurrencyPolicy::AlwaysCreate),
        )
        .expect("first fire");
        let second = create_routine_fire_for_policy(
            "routine-always",
            &policy(RoutineConcurrencyPolicy::AlwaysCreate),
        )
        .expect("second fire");

        assert_eq!(first.status, RoutineFireStatus::Pending);
        assert_eq!(second.status, RoutineFireStatus::Pending);
        assert_ne!(first.id, second.id);
    }

    #[test]
    fn mark_started_and_failed_update_fire_metadata() {
        let _sandbox = test_env::sandbox();
        upsert_routine(routine_fixture(
            "routine-status",
            policy(RoutineConcurrencyPolicy::CoalesceIfActive),
        ))
        .expect("upsert routine");
        let fire = create_routine_fire("routine-status").expect("create fire");

        let started = mark_routine_fire_started(&fire.id, "session-1", Some("org-run-1"))
            .expect("mark started");
        assert_eq!(started.status, RoutineFireStatus::Started);
        assert_eq!(started.session_id.as_deref(), Some("session-1"));
        assert_eq!(started.agent_org_run_id.as_deref(), Some("org-run-1"));
        assert!(started.started_at.is_some());
        assert!(started.error.is_none());

        let failed =
            mark_routine_fire_failed(&fire.id, "provider unavailable").expect("mark failed");
        assert_eq!(failed.status, RoutineFireStatus::Failed);
        assert_eq!(failed.error.as_deref(), Some("provider unavailable"));
        assert_eq!(failed.session_id.as_deref(), Some("session-1"));
        assert!(failed.completed_at.is_some());
    }

    #[test]
    fn mark_work_item_created_links_fire_without_session() {
        let _sandbox = test_env::sandbox();
        upsert_routine(routine_fixture(
            "routine-work-item-link",
            policy(RoutineConcurrencyPolicy::CoalesceIfActive),
        ))
        .expect("upsert routine");
        let fire = create_routine_fire("routine-work-item-link").expect("create fire");

        let linked = mark_routine_fire_work_item_created(&fire.id, "AAA-0001")
            .expect("mark work item created");
        assert_eq!(linked.status, RoutineFireStatus::Succeeded);
        assert_eq!(linked.work_item_id.as_deref(), Some("AAA-0001"));
        assert!(linked.session_id.is_none());
        assert!(linked.agent_org_run_id.is_none());
        assert!(linked.started_at.is_some());
        assert!(linked.completed_at.is_some());
        assert!(linked.error.is_none());
    }

    #[test]
    fn unknown_fire_status_is_a_decode_error() {
        let _sandbox = test_env::sandbox();
        upsert_routine(routine_fixture(
            "routine-bad-status",
            policy(RoutineConcurrencyPolicy::CoalesceIfActive),
        ))
        .expect("upsert routine");
        let connection = conn().expect("conn");
        connection
            .execute(
                "INSERT INTO routine_fires (
                    id, routine_id, fired_at, status, session_id, agent_org_run_id,
                    work_item_id, coalesced_into_fire_id, idempotency_key, started_at,
                    completed_at, error
                 ) VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)",
                params!["bad-fire", "routine-bad-status", now_ms(), "mystery"],
            )
            .expect("insert bad fire");

        let error = list_routine_fires("routine-bad-status").expect_err("decode should fail");
        assert!(
            error.contains("unknown routine fire status"),
            "unexpected error: {error}"
        );
    }
}
