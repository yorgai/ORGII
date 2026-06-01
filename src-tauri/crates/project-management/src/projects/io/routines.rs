//! SQLite-backed RoutineDefinition and RoutineFire IO.

use rusqlite::{params, OptionalExtension};

use super::helpers::{conn, from_iso8601, map_db, now_ms, to_iso8601};
use crate::projects::types::{
    RoutineDefinition, RoutineFire, RoutineFireStatus, RoutineRunTemplate, RoutineTrigger,
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
        created_at: to_iso8601(row.get(6)?),
        updated_at: to_iso8601(row.get(7)?),
    })
}

fn row_to_fire(row: &rusqlite::Row<'_>) -> rusqlite::Result<RoutineFire> {
    let status_raw: String = row.get(3)?;
    let status = match status_raw.as_str() {
        "pending" => RoutineFireStatus::Pending,
        "started" => RoutineFireStatus::Started,
        "failed" => RoutineFireStatus::Failed,
        _ => RoutineFireStatus::Failed,
    };

    Ok(RoutineFire {
        id: row.get(0)?,
        routine_id: row.get(1)?,
        fired_at: to_iso8601(row.get(2)?),
        status,
        session_id: row.get(4)?,
        agent_org_run_id: row.get(5)?,
        error: row.get(6)?,
    })
}

fn status_to_str(status: &RoutineFireStatus) -> &'static str {
    match status {
        RoutineFireStatus::Pending => "pending",
        RoutineFireStatus::Started => "started",
        RoutineFireStatus::Failed => "failed",
    }
}

pub fn list_routines() -> Result<Vec<RoutineDefinition>, String> {
    let connection = conn()?;
    let mut stmt = map_db(connection.prepare(
        "SELECT id, name, description, enabled, trigger_json, run_template_json,
                created_at, updated_at
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
                        created_at, updated_at
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

    map_db(connection.execute(
        "INSERT INTO routine_definitions (
            id, name, description, enabled, trigger_json, run_template_json,
            created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            enabled = excluded.enabled,
            trigger_json = excluded.trigger_json,
            run_template_json = excluded.run_template_json,
            updated_at = excluded.updated_at",
        params![
            routine.id,
            routine.name,
            routine.description,
            if routine.enabled { 1 } else { 0 },
            trigger_json,
            template_json,
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
        "SELECT id, routine_id, fired_at, status, session_id, agent_org_run_id, error
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
    let now = now_ms();
    let fire = RoutineFire {
        id: timestamp_id("routine-fire"),
        routine_id: routine_id.to_string(),
        fired_at: to_iso8601(now),
        status: RoutineFireStatus::Pending,
        session_id: None,
        agent_org_run_id: None,
        error: None,
    };
    let connection = conn()?;
    map_db(connection.execute(
        "INSERT INTO routine_fires (
            id, routine_id, fired_at, status, session_id, agent_org_run_id, error
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            fire.id,
            fire.routine_id,
            now,
            status_to_str(&fire.status),
            fire.session_id,
            fire.agent_org_run_id,
            fire.error,
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
    map_db(connection.execute(
        "UPDATE routine_fires
         SET status = ?2, session_id = ?3, agent_org_run_id = ?4, error = NULL
         WHERE id = ?1",
        params![fire_id, "started", session_id, agent_org_run_id],
    ))?;
    read_routine_fire(fire_id)
}

pub fn mark_routine_fire_failed(fire_id: &str, error: &str) -> Result<RoutineFire, String> {
    let connection = conn()?;
    map_db(connection.execute(
        "UPDATE routine_fires
         SET status = ?2, error = ?3
         WHERE id = ?1",
        params![fire_id, "failed", error],
    ))?;
    read_routine_fire(fire_id)
}

fn read_routine_fire(fire_id: &str) -> Result<RoutineFire, String> {
    let connection = conn()?;
    let fire = map_db(
        connection
            .query_row(
                "SELECT id, routine_id, fired_at, status, session_id, agent_org_run_id, error
                 FROM routine_fires
                 WHERE id = ?1",
                params![fire_id],
                row_to_fire,
            )
            .optional(),
    )?;
    fire.ok_or_else(|| format!("Routine fire not found: {fire_id}"))
}
