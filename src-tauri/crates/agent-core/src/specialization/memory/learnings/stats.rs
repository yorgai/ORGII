//! Browser/UI list and aggregate queries for the L3 learnings store.
//!
//! These are read-only queries that drive the Learnings Browser list panel
//! and the Consolidation Status card. Status mutations live in
//! `super::lifecycle`; embedding-similarity retrieval lives in `super::query`.

use rusqlite::{params, Connection, Result as SqliteResult};

use super::crud::row_to_learning;
use super::lifecycle::ConsolidationRunRecord;
use super::schema::SELECT_COLS;
use super::types::{Learning, LearningCategory, LearningSource, LearningStatus};

/// Filter predicate for the Learnings Browser list panel. All
/// fields are optional — `None` matches everything.
#[derive(Debug, Clone, Default)]
pub struct LearningListFilter {
    pub status: Option<LearningStatus>,
    pub source: Option<LearningSource>,
    pub category: Option<LearningCategory>,
    pub search: Option<String>,
    pub limit: Option<u32>,
}

/// List learnings with status/source/category filters. Orders
/// by `updated_at DESC` so the most recently touched rows surface first
/// (matches the Browser's "what changed?" mental model better than
/// salience, which is still available in `load_active_learnings_ranked`).
pub fn list_learnings(
    conn: &Connection,
    agent_scope: &str,
    filter: &LearningListFilter,
) -> SqliteResult<Vec<Learning>> {
    let mut sql = format!("SELECT {SELECT_COLS} FROM learnings WHERE agent_scope = ?1");
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(agent_scope.to_string())];

    if let Some(status) = filter.status {
        sql.push_str(" AND status = ?");
        sql.push_str(&(params_vec.len() + 1).to_string());
        params_vec.push(Box::new(status.as_str().to_string()));
    }
    if let Some(source) = filter.source {
        sql.push_str(" AND source = ?");
        sql.push_str(&(params_vec.len() + 1).to_string());
        params_vec.push(Box::new(source.as_str().to_string()));
    }
    if let Some(category) = filter.category {
        sql.push_str(" AND category = ?");
        sql.push_str(&(params_vec.len() + 1).to_string());
        params_vec.push(Box::new(category.as_str().to_string()));
    }
    if let Some(ref needle) = filter.search {
        if !needle.trim().is_empty() {
            sql.push_str(" AND (LOWER(content) LIKE ?");
            sql.push_str(&(params_vec.len() + 1).to_string());
            sql.push_str(" OR LOWER(COALESCE(takeaway, '')) LIKE ?");
            sql.push_str(&(params_vec.len() + 1).to_string());
            sql.push(')');
            let like = format!("%{}%", needle.trim().to_lowercase());
            params_vec.push(Box::new(like));
        }
    }

    sql.push_str(" ORDER BY updated_at DESC");
    if let Some(limit) = filter.limit {
        sql.push_str(&format!(" LIMIT {}", limit));
    }

    let mut stmt = conn.prepare(&sql)?;
    let refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
    let rows = stmt.query_map(refs.as_slice(), row_to_learning)?;
    rows.collect()
}

/// Per-scope status aggregates for the Consolidation Status card.
#[derive(Debug, Clone, Default)]
pub struct LearningsStatusCounts {
    pub pending: u64,
    pub active: u64,
    pub merged: u64,
    pub deprecated: u64,
    pub abandoned: u64,
}

/// Count learnings grouped by status. Scope-limited so the card
/// only shows rows that belong to the agent the user is looking at.
pub fn count_status_per_scope(
    conn: &Connection,
    agent_scope: &str,
) -> SqliteResult<LearningsStatusCounts> {
    let mut counts = LearningsStatusCounts::default();
    let mut stmt = conn.prepare(
        "SELECT status, COUNT(*) FROM learnings
         WHERE agent_scope = ?1 GROUP BY status",
    )?;
    let rows = stmt.query_map(params![agent_scope], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    for row in rows {
        let (status, count) = row?;
        let count = count.max(0) as u64;
        // Surface unknown status strings via warn rather than silently
        // double-counting them as `Pending` (which the previous
        // `parse_str` catch-all did and which made schema drift
        // invisible in the Learnings Browser counts panel).
        match LearningStatus::parse(&status) {
            Some(LearningStatus::Pending) => counts.pending = count,
            Some(LearningStatus::Active) => counts.active = count,
            Some(LearningStatus::Merged) => counts.merged = count,
            Some(LearningStatus::Deprecated) => counts.deprecated = count,
            Some(LearningStatus::Abandoned) => counts.abandoned = count,
            None => {
                tracing::warn!(
                    scope = %agent_scope,
                    status = %status,
                    count = count,
                    "[learnings::stats] dropping {} rows with unknown status value '{}' from counts",
                    count, status
                );
            }
        }
    }
    Ok(counts)
}

/// Latest consolidation run row for a scope. `None` if the
/// scope has never been consolidated (or if `consolidation_runs` is empty).
pub fn latest_consolidation_run(
    conn: &Connection,
    agent_scope: &str,
) -> SqliteResult<Option<ConsolidationRunRecord>> {
    conn.query_row(
        "SELECT agent_scope, account_id, trigger, mode,
                pending_input, added, updated, deleted, none_count, abandoned, reinforced,
                error, started_at, finished_at
         FROM consolidation_runs
         WHERE agent_scope = ?1
         ORDER BY finished_at DESC
         LIMIT 1",
        params![agent_scope],
        |row| {
            Ok(ConsolidationRunRecord {
                agent_scope: row.get(0)?,
                account_id: row.get(1)?,
                trigger: row.get(2)?,
                mode: row.get(3)?,
                pending_input: row.get::<_, i64>(4)?.max(0) as u32,
                added: row.get::<_, i64>(5)?.max(0) as u32,
                updated: row.get::<_, i64>(6)?.max(0) as u32,
                deleted: row.get::<_, i64>(7)?.max(0) as u32,
                none_count: row.get::<_, i64>(8)?.max(0) as u32,
                abandoned: row.get::<_, i64>(9)?.max(0) as u32,
                reinforced: row.get::<_, i64>(10)?.max(0) as u32,
                error: row.get(11)?,
                started_at: row.get(12)?,
                finished_at: row.get(13)?,
            })
        },
    )
    .map(Some)
    .or_else(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other),
    })
}
