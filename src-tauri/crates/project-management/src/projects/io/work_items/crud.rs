//! Single-row CRUD entry points against `projects.db`.
//!
//! Frontmatter ↔ row mapping helpers live in `super::mapping`; this
//! module is intentionally limited to the public CRUD surface plus the
//! two strictly CRUD-flavored helpers (`resolve_project_id` and
//! `max_existing_work_item_number`).

use rusqlite::{params, OptionalExtension};

use super::super::helpers::{conn, from_iso8601, map_db, now_ms, to_iso8601};
use super::extras::ExtrasPayload;
use super::history::{append_deleted_event, append_restored_event, ensure_created_event};
use super::mapping::{
    assemble_work_item, read_extras_for, read_labels_for, row_to_core, ConnectionLike,
};
use crate::projects::types::{WorkItemData, WorkItemFrontmatter};

const WORK_ITEM_PREFIX_LENGTH: usize = 3;

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

/// Read every work item under a project, ordered by `updated_at` desc to
/// match the legacy file-layer behavior.
pub fn read_all_work_items(project_slug: &str) -> Result<Vec<WorkItemData>, String> {
    read_all_work_items_scoped(project_slug, None)
}

pub fn read_all_work_items_scoped(
    project_slug: &str,
    org_id: Option<&str>,
) -> Result<Vec<WorkItemData>, String> {
    let connection = conn()?;
    let project_id = resolve_project_id_scoped(&connection, project_slug, org_id)?;

    let mut stmt = map_db(connection.prepare(
        "SELECT id, project_id, short_id, title, body, status, priority, assignee, assignee_type,
                milestone, parent, start_date, target_date, created_at, updated_at, deleted_at
         FROM workitems
         WHERE project_id = ?1
         ORDER BY COALESCE(deleted_at, updated_at) DESC, created_at DESC",
    ))?;
    let rows = map_db(stmt.query_map(params![&project_id], row_to_core))?;

    let mut out = Vec::new();
    for entry in rows {
        let core = map_db(entry)?;
        let labels = read_labels_for(&connection, &core.work_item_id)?;
        let extras = read_extras_for(&connection, &core.work_item_id)?;
        out.push(assemble_work_item(core, labels, extras));
    }
    Ok(out)
}

/// Read one work item by short ID within the given project.
pub fn read_work_item(project_slug: &str, short_id: &str) -> Result<WorkItemData, String> {
    read_work_item_scoped(project_slug, short_id, None)
}

pub fn read_work_item_scoped(
    project_slug: &str,
    short_id: &str,
    org_id: Option<&str>,
) -> Result<WorkItemData, String> {
    let connection = conn()?;
    let project_id = resolve_project_id_scoped(&connection, project_slug, org_id)?;

    let core = map_db(
        connection
            .query_row(
                "SELECT id, project_id, short_id, title, body, status, priority, assignee, assignee_type,
                        milestone, parent, start_date, target_date, created_at, updated_at, deleted_at
                 FROM workitems
                 WHERE project_id = ?1 AND short_id = ?2",
                params![&project_id, short_id],
                row_to_core,
            )
            .optional(),
    )?
    .ok_or_else(|| format!("Work item '{}' not found", short_id))?;

    let labels = read_labels_for(&connection, &core.work_item_id)?;
    let extras = read_extras_for(&connection, &core.work_item_id)?;
    Ok(assemble_work_item(core, labels, extras))
}

pub fn read_standalone_work_items(org_id: Option<&str>) -> Result<Vec<WorkItemData>, String> {
    let connection = conn()?;
    let org_id = org_id.unwrap_or("personal-org");
    let mut stmt = map_db(connection.prepare(
        "SELECT id, project_id, short_id, title, body, status, priority, assignee, assignee_type,
                milestone, parent, start_date, target_date, created_at, updated_at, deleted_at
         FROM workitems
         WHERE org_id = ?1 AND project_id IS NULL
         ORDER BY COALESCE(deleted_at, updated_at) DESC, created_at DESC",
    ))?;
    let rows = map_db(stmt.query_map(params![org_id], row_to_core))?;

    let mut out = Vec::new();
    for entry in rows {
        let core = map_db(entry)?;
        let labels = read_labels_for(&connection, &core.work_item_id)?;
        let extras = read_extras_for(&connection, &core.work_item_id)?;
        out.push(assemble_work_item(core, labels, extras));
    }
    Ok(out)
}

pub fn read_standalone_work_item(
    org_id: Option<&str>,
    short_id: &str,
) -> Result<WorkItemData, String> {
    let connection = conn()?;
    let org_id = org_id.unwrap_or("personal-org");
    let core = map_db(
        connection
            .query_row(
                "SELECT id, project_id, short_id, title, body, status, priority, assignee, assignee_type,
                        milestone, parent, start_date, target_date, created_at, updated_at, deleted_at
                 FROM workitems
                 WHERE org_id = ?1 AND project_id IS NULL AND short_id = ?2",
                params![org_id, short_id],
                row_to_core,
            )
            .optional(),
    )?
    .ok_or_else(|| format!("Standalone work item '{}' not found", short_id))?;

    let labels = read_labels_for(&connection, &core.work_item_id)?;
    let extras = read_extras_for(&connection, &core.work_item_id)?;
    Ok(assemble_work_item(core, labels, extras))
}

/// Create or update a work item.
///
/// Hot columns are written to `workitems`, the label set fully replaces
/// `workitem_labels`, and everything else lives in `workitem_extras`. The
/// whole write happens inside one transaction so partial failures cannot
/// leave the row, label join, and extras blob out of sync.
pub fn write_work_item(
    project_slug: &str,
    short_id: &str,
    frontmatter: &WorkItemFrontmatter,
    body: &str,
) -> Result<(), String> {
    let connection = conn()?;
    let project_id = resolve_project_id(&connection, project_slug)?;
    let org_id: String = map_db(connection.query_row(
        "SELECT org_id FROM projects WHERE id = ?1",
        params![&project_id],
        |row| row.get(0),
    ))?;
    drop(connection);

    write_work_item_with_scope(
        Some(project_id),
        &org_id,
        short_id,
        frontmatter,
        body,
    )
}

pub fn write_standalone_work_item(
    org_id: Option<&str>,
    short_id: &str,
    frontmatter: &WorkItemFrontmatter,
    body: &str,
) -> Result<(), String> {
    write_work_item_with_scope(
        None,
        org_id.unwrap_or("personal-org"),
        short_id,
        frontmatter,
        body,
    )
}

fn write_work_item_with_scope(
    project_id: Option<String>,
    org_id: &str,
    short_id: &str,
    frontmatter: &WorkItemFrontmatter,
    body: &str,
) -> Result<(), String> {
    let mut connection = conn()?;
    let now = now_ms();
    let mut next_frontmatter = frontmatter.clone();
    next_frontmatter.project = project_id.clone();
    let created_at = if next_frontmatter.created_at.is_empty() {
        now
    } else {
        from_iso8601(&next_frontmatter.created_at)
    };
    let updated_at = if next_frontmatter.updated_at.is_empty() {
        now
    } else {
        from_iso8601(&next_frontmatter.updated_at)
    };
    let deleted_at = next_frontmatter.deleted_at.as_deref().map(from_iso8601);
    let tx = map_db(connection.transaction())?;
    let existing_item: Option<String> = map_db(
        tx.query_row(
            "SELECT id FROM workitems WHERE id = ?1",
            params![&next_frontmatter.id],
            |row| row.get(0),
        )
        .optional(),
    )?;
    if existing_item.is_none() {
        ensure_created_event(&mut next_frontmatter, &to_iso8601(created_at));
    }

    let extras = ExtrasPayload::from_frontmatter(&next_frontmatter);
    let extras_json =
        serde_json::to_string(&extras).map_err(|err| format!("serialize extras: {}", err))?;

    map_db(tx.execute(
        "INSERT INTO workitems (
            id, org_id, project_id, short_id, title, body, status, priority,
            assignee, assignee_type, milestone, parent,
            start_date, target_date, created_at, updated_at, deleted_at
         ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
            ?9, ?10, ?11, ?12,
            ?13, ?14, ?15, ?16, ?17
         )
         ON CONFLICT(id) DO UPDATE SET
            org_id       = excluded.org_id,
            project_id   = excluded.project_id,
            short_id     = excluded.short_id,
            title        = excluded.title,
            body         = excluded.body,
            status       = excluded.status,
            priority     = excluded.priority,
            assignee     = excluded.assignee,
            assignee_type= excluded.assignee_type,
            milestone    = excluded.milestone,
            parent       = excluded.parent,
            start_date   = excluded.start_date,
            target_date  = excluded.target_date,
            updated_at   = excluded.updated_at,
            deleted_at   = excluded.deleted_at",
        params![
            &next_frontmatter.id,
            org_id,
            &project_id,
            short_id,
            &next_frontmatter.title,
            body,
            &next_frontmatter.status,
            &next_frontmatter.priority,
            &next_frontmatter.assignee,
            &next_frontmatter.assignee_type,
            &next_frontmatter.milestone,
            &next_frontmatter.parent,
            &next_frontmatter.start_date,
            &next_frontmatter.target_date,
            created_at,
            updated_at,
            deleted_at,
        ],
    ))?;

    map_db(tx.execute(
        "DELETE FROM workitem_labels WHERE work_item_id = ?1",
        params![&next_frontmatter.id],
    ))?;
    for label_id in &next_frontmatter.labels {
        map_db(tx.execute(
            "INSERT INTO workitem_labels (work_item_id, label_id) VALUES (?1, ?2)",
            params![&next_frontmatter.id, label_id],
        ))?;
    }

    map_db(tx.execute(
        "INSERT INTO workitem_extras (work_item_id, extras_json)
         VALUES (?1, ?2)
         ON CONFLICT(work_item_id) DO UPDATE SET extras_json = excluded.extras_json",
        params![&next_frontmatter.id, extras_json],
    ))?;

    map_db(tx.commit())?;
    Ok(())
}

/// Move a work item to the recoverable delete bin.
pub fn delete_work_item(project_slug: &str, short_id: &str) -> Result<(), String> {
    let mut existing = read_work_item(project_slug, short_id)?;
    if existing.frontmatter.deleted_at.is_some() {
        return Ok(());
    }

    let deleted_at = chrono::Utc::now().to_rfc3339();
    append_deleted_event(&mut existing.frontmatter, &deleted_at);
    existing.frontmatter.deleted_at = Some(deleted_at.clone());
    existing.frontmatter.updated_at = deleted_at;
    write_work_item(
        project_slug,
        short_id,
        &existing.frontmatter,
        &existing.body,
    )
}

pub fn restore_work_item(project_slug: &str, short_id: &str) -> Result<WorkItemData, String> {
    let mut existing = read_work_item(project_slug, short_id)?;
    if existing.frontmatter.deleted_at.is_none() {
        return Ok(existing);
    }

    let restored_at = chrono::Utc::now().to_rfc3339();
    append_restored_event(&mut existing.frontmatter, &restored_at);
    existing.frontmatter.deleted_at = None;
    existing.frontmatter.updated_at = restored_at;
    write_work_item(
        project_slug,
        short_id,
        &existing.frontmatter,
        &existing.body,
    )?;
    read_work_item(project_slug, short_id)
}

pub fn purge_expired_deleted_work_items(project_slug: &str) -> Result<usize, String> {
    let connection = conn()?;
    let project_id = resolve_project_id(&connection, project_slug)?;
    let expires_before = chrono::Utc::now()
        .checked_sub_signed(chrono::Duration::days(7))
        .ok_or_else(|| "Failed to compute delete bin expiration".to_string())?
        .timestamp_millis();

    map_db(connection.execute(
        "DELETE FROM workitems WHERE project_id = ?1 AND deleted_at IS NOT NULL AND deleted_at < ?2",
        params![&project_id, expires_before],
    ))
}

/// Allocate the next short ID for a work item under `project_slug`.
///
/// Reads the project's current `next_work_item_id`, scans `workitems`
/// for the highest existing numeric suffix on the same prefix (so a
/// hand-edited DB or an out-of-band insert won't collide), bumps the
/// counter, and writes it back — all inside one `IMMEDIATE` transaction
/// so two concurrent allocators can't hand out the same ID.
pub fn allocate_short_id(project_slug: &str) -> Result<String, String> {
    let mut connection = conn()?;
    let tx =
        map_db(connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate))?;

    let (project_id, prefix, mut next_id) = map_db(
        tx.query_row(
            "SELECT id, short_id_prefix, next_work_item_id
             FROM projects WHERE slug = ?1",
            params![project_slug],
            |row| {
                let id: String = row.get(0)?;
                let prefix: String = row.get(1)?;
                let next_id: i64 = row.get(2)?;
                Ok((id, prefix, next_id))
            },
        )
        .optional(),
    )?
    .ok_or_else(|| format!("Project '{}' not found", project_slug))?;

    if let Some(max_existing) = max_existing_work_item_number(&tx, &project_id, &prefix)? {
        let min_next = (max_existing as i64).saturating_add(1);
        if next_id < min_next {
            next_id = min_next;
        }
    }

    let short_id = format!("{}-{:04}", prefix, next_id);
    let bumped = next_id.saturating_add(1);

    map_db(tx.execute(
        "UPDATE projects SET next_work_item_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![bumped, now_ms(), project_id],
    ))?;

    map_db(tx.commit())?;
    Ok(short_id)
}

pub fn allocate_standalone_short_id(org_id: Option<&str>) -> Result<String, String> {
    let mut connection = conn()?;
    let tx =
        map_db(connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate))?;
    let org_id = org_id.unwrap_or("personal-org");
    let prefix = "WI";
    let mut next_id = 1_i64;
    if let Some(max_existing) = max_existing_standalone_work_item_number(&tx, org_id, prefix)? {
        next_id = (max_existing as i64).saturating_add(1);
    }
    let short_id = format!("{}-{:04}", prefix, next_id);
    map_db(tx.commit())?;
    Ok(short_id)
}

/// Move a work item from one project to another. The `short_id` does
/// NOT change; only the owning project UUID changes.
pub fn move_work_item(short_id: &str, from_project: &str, to_project: &str) -> Result<(), String> {
    let mut connection = conn()?;
    let tx =
        map_db(connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate))?;

    let from_id = resolve_project_id(&tx, from_project)?;
    let to_id = resolve_project_id(&tx, to_project)?;

    let exists_at_dest: bool = map_db(
        tx.query_row(
            "SELECT 1 FROM workitems WHERE project_id = ?1 AND short_id = ?2",
            params![&to_id, short_id],
            |_| Ok(true),
        )
        .optional(),
    )?
    .unwrap_or(false);
    if exists_at_dest {
        return Err(format!(
            "Work item '{}' already exists in project '{}'",
            short_id, to_project
        ));
    }

    let affected = map_db(tx.execute(
        "UPDATE workitems SET project_id = ?1, updated_at = ?2
         WHERE project_id = ?3 AND short_id = ?4",
        params![&to_id, now_ms(), &from_id, short_id],
    ))?;
    if affected == 0 {
        return Err(format!(
            "Work item '{}' not found in project '{}'",
            short_id, from_project
        ));
    }

    map_db(tx.commit())?;
    Ok(())
}

// ---------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------

/// Resolve `slug → project_id` against the `projects` table.
///
/// Generic over the connection type so it works inside both bare
/// `Connection` and an active `Transaction`.
fn resolve_project_id<C>(connection: &C, slug: &str) -> Result<String, String>
where
    C: ConnectionLike,
{
    resolve_project_id_scoped(connection, slug, None)
}

fn resolve_project_id_scoped<C>(
    connection: &C,
    slug: &str,
    org_id: Option<&str>,
) -> Result<String, String>
where
    C: ConnectionLike,
{
    let project_id = if let Some(org_id) = org_id {
        connection.query_row_optional(
            "SELECT id FROM projects WHERE slug = ?1 AND org_id = ?2",
            params![slug, org_id],
            |row| row.get::<_, String>(0),
        )?
    } else {
        connection.query_row_optional(
            "SELECT id FROM projects WHERE slug = ?1",
            params![slug],
            |row| row.get::<_, String>(0),
        )?
    };

    project_id.ok_or_else(|| format!("Project '{}' not found", slug))
}

/// Count the largest numeric suffix used by an existing work item with
/// `prefix` inside `project_id`. Returns `None` when none exist.
fn max_existing_work_item_number<C>(
    connection: &C,
    project_id: &str,
    prefix: &str,
) -> Result<Option<u32>, String>
where
    C: ConnectionLike,
{
    if prefix.chars().count() != WORK_ITEM_PREFIX_LENGTH {
        return Ok(None);
    }

    let pattern = format!("{}-%", prefix);
    let rows = connection.query_string_rows(
        "SELECT short_id FROM workitems WHERE project_id = ?1 AND short_id LIKE ?2",
        params![project_id, pattern],
    )?;

    max_numeric_suffix(rows, prefix)
}

fn max_existing_standalone_work_item_number<C>(
    connection: &C,
    org_id: &str,
    prefix: &str,
) -> Result<Option<u32>, String>
where
    C: ConnectionLike,
{
    let pattern = format!("{}-%", prefix);
    let rows = connection.query_string_rows(
        "SELECT short_id FROM workitems WHERE org_id = ?1 AND project_id IS NULL AND short_id LIKE ?2",
        params![org_id, pattern],
    )?;

    max_numeric_suffix(rows, prefix)
}

fn max_numeric_suffix(rows: Vec<String>, prefix: &str) -> Result<Option<u32>, String> {
    let prefix_with_dash = format!("{}-", prefix);
    let max = rows
        .into_iter()
        .filter_map(|sid| {
            sid.strip_prefix(&prefix_with_dash)
                .and_then(|tail| tail.parse::<u32>().ok())
        })
        .max();
    Ok(max)
}

#[cfg(test)]
#[path = "crud_tests.rs"]
mod tests;
