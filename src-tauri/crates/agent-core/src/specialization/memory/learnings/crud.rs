//! Base CRUD for the L3 `learnings` table: insert, load by id, load all
//! non-deprecated rows for a scope, and the row-to-struct mapper. Also hosts
//! the write-time hash-dedup guard (`content_hash_dedup`) since it is the
//! single write path's natural companion.
//!
//! Status transitions (deprecate, reactivate, promote_pending_to_active,
//! mark_merged, etc.) live in `super::lifecycle`; browser/UI list/count
//! queries live in `super::stats`; embedding-similarity retrieval lives in
//! `super::query`.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Result as SqliteResult};
use tracing::info;
use uuid::Uuid;

use super::schema::{compute_content_hash, SELECT_COLS};
use super::types::{EvolutionType, Learning, LearningCategory, LearningSource, LearningStatus};

/// Insert a new learning. Returns the generated ID. If `content_hash` is
/// `None`, the write-time dedup path is expected to populate it; legacy callers
/// (reflection.rs / orchestrator learning bridge / tests) can pre-compute via
/// `compute_content_hash()`.
pub fn insert_learning(conn: &Connection, learning: &Learning) -> SqliteResult<String> {
    let id = if learning.id.is_empty() {
        Uuid::new_v4().to_string()
    } else {
        learning.id.clone()
    };
    let now = Utc::now().to_rfc3339();
    let embedding_bytes: Vec<u8> = learning
        .embedding
        .iter()
        .flat_map(|v| v.to_le_bytes())
        .collect();
    let embedding_blob: Option<&[u8]> = if embedding_bytes.is_empty() {
        None
    } else {
        Some(&embedding_bytes)
    };

    conn.execute(
        "INSERT INTO learnings (
            id, agent_scope, content, takeaway, category, importance, confidence, embedding, embedding_model,
            status, content_hash, reinforcement_count, source, account_id,
            evolution_type, parent_id,
            last_recalled_at, source_session_id, created_at, updated_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)",
        params![
            id,
            learning.agent_scope,
            learning.content,
            learning.takeaway,
            learning.category.as_str(),
            learning.importance,
            learning.confidence,
            embedding_blob,
            learning.embedding_model,
            learning.status.as_str(),
            learning.content_hash,
            learning.reinforcement_count,
            learning.source.as_str(),
            learning.account_id,
            learning.evolution_type.as_str(),
            learning.parent_id,
            learning.last_recalled_at,
            learning.source_session_id,
            now,
            now,
        ],
    )?;
    info!(
        "[learnings] Inserted '{}' (scope={}, cat={}, status={}, source={})",
        id,
        learning.agent_scope,
        learning.category.as_str(),
        learning.status.as_str(),
        learning.source.as_str()
    );
    Ok(id)
}

/// Load active prompt candidates for a scope. Includes `pending` and `active`;
/// excludes `merged`, `deprecated`, and `abandoned` tombstones.
pub fn load_active_learnings(conn: &Connection, agent_scope: &str) -> SqliteResult<Vec<Learning>> {
    let sql = format!(
        "SELECT {SELECT_COLS}
         FROM learnings
         WHERE agent_scope = ?1
           AND status NOT IN ('merged', 'deprecated', 'abandoned')
         ORDER BY importance DESC, reinforcement_count DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![agent_scope], row_to_learning)?;
    rows.collect()
}

/// Load a single learning by ID (any status).
pub fn load_learning_by_id(conn: &Connection, id: &str) -> SqliteResult<Option<Learning>> {
    let sql = format!("SELECT {SELECT_COLS} FROM learnings WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;

    let mut rows = stmt.query_map(params![id], row_to_learning)?;
    match rows.next() {
        Some(Ok(l)) => Ok(Some(l)),
        Some(Err(e)) => Err(e),
        None => Ok(None),
    }
}

/// Convert a database row to a Learning struct. Column order MUST match
/// `SELECT_COLS`:
///   0: id, 1: agent_scope, 2: content, 3: takeaway, 4: category,
///   5: importance, 6: confidence, 7: embedding, 8: embedding_model,
///   9: status, 10: content_hash, 11: reinforcement_count, 12: source,
///   13: account_id, 14: evolution_type, 15: parent_id, 16: last_recalled_at,
///   17: source_session_id, 18: created_at, 19: updated_at
pub(super) fn row_to_learning(row: &rusqlite::Row<'_>) -> rusqlite::Result<Learning> {
    let embedding_blob: Option<Vec<u8>> = row.get(7)?;
    let embedding = embedding_blob
        .map(|blob| {
            blob.chunks_exact(4)
                .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
                .collect()
        })
        .unwrap_or_default();

    // Parse each enum column via the typed `parse(...)` and surface a
    // `FromSqlConversionFailure` on unknown values. The previous
    // `parse_str` helpers silently mapped unknown strings to a default
    // variant (`Pattern` / `Pending` / `Reflection` / `Original`),
    // which masked DB corruption and — in the `Pending` case — caused
    // a hot-loop where every consolidation tick re-queued the corrupt
    // row. Failing the row read instead lets the caller decide
    // (typically: skip the row, log, and continue).
    let category_str: String = row.get(4)?;
    let category = LearningCategory::parse(&category_str).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            4,
            rusqlite::types::Type::Text,
            format!("unknown LearningCategory value: {:?}", category_str).into(),
        )
    })?;
    let status_str: String = row.get(9)?;
    let status = LearningStatus::parse(&status_str).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            9,
            rusqlite::types::Type::Text,
            format!("unknown LearningStatus value: {:?}", status_str).into(),
        )
    })?;
    let source_str: String = row.get(12)?;
    let source = LearningSource::parse(&source_str).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            12,
            rusqlite::types::Type::Text,
            format!("unknown LearningSource value: {:?}", source_str).into(),
        )
    })?;
    let evolution_str: String = row.get(14)?;
    let evolution_type = EvolutionType::parse(&evolution_str).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            14,
            rusqlite::types::Type::Text,
            format!("unknown EvolutionType value: {:?}", evolution_str).into(),
        )
    })?;

    Ok(Learning {
        id: row.get(0)?,
        agent_scope: row.get(1)?,
        content: row.get(2)?,
        takeaway: row.get(3)?,
        category,
        importance: row.get(5)?,
        confidence: row.get(6)?,
        embedding,
        embedding_model: row.get(8)?,
        status,
        content_hash: row.get(10)?,
        reinforcement_count: row.get::<_, i64>(11)? as u32,
        source,
        account_id: row.get(13)?,
        evolution_type,
        parent_id: row.get(15)?,
        last_recalled_at: row.get(16)?,
        source_session_id: row.get(17)?,
        created_at: row.get(18)?,
        updated_at: row.get(19)?,
    })
}

/// Outcome of `content_hash_dedup`. Callers use this to decide whether to
/// proceed with `insert_learning` (for `Novel`) or treat the row as handled
/// (for `Reinforced` — the existing row's counter has already been bumped).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DedupResult {
    /// Exact-hash hit on a live row (non-deprecated). The row's
    /// `reinforcement_count` has already been incremented and `updated_at`
    /// touched. Carries the existing row's id for logging / telemetry.
    Reinforced(String),
    /// No hit — caller should proceed with `insert_learning`.
    Novel,
}

/// Write-time exact-hash deduplication guard (write-time, §2.1).
///
/// Algorithm (from memU):
///   1. Compute `sha256("{category}:{normalized_content}")[..16]`
///   2. `SELECT id, reinforcement_count FROM learnings WHERE content_hash=?
///      AND agent_scope=? AND status NOT IN ('deprecated', 'abandoned')`
///   3. On hit: `UPDATE ... reinforcement_count = reinforcement_count + 1,
///      updated_at = now` → return `Reinforced(id)`
///   4. On miss: return `Novel`
///
/// Note that `merged` rows are treated as live — if a reinforcement matches
/// a previously-merged row, that row wins the bump (the merged-into row is
/// still `active` and will be hit by a different hash).
///
/// This is the **only** dedup step on the write path. Semantic dedup
/// (cosine / LLM) lives in the consolidation engine.
///
/// References:
/// - memU `compute_content_hash()` — memU/src/memu/database/models.py L15-32
/// - memU `create_item_reinforce()` —
///   memU/src/memu/database/inmemory/repositories/memory_item_repo.py L122-167
pub fn content_hash_dedup(
    conn: &Connection,
    agent_scope: &str,
    content: &str,
    category: LearningCategory,
) -> SqliteResult<DedupResult> {
    let hash = compute_content_hash(content, category);
    // Distinguish "no row matches" (legitimate `Novel`) from a transient
    // DB error. The previous `.ok()` collapsed both into `None`, which
    // would let the caller proceed with `insert_learning` after a failed
    // dedup SELECT — opening the door to duplicate rows when sqlite was
    // transiently unhealthy (lock contention, schema mismatch). Surface
    // the DB error via `?` so the caller (consolidation engine /
    // reflection writer) can decide whether to retry or skip.
    let hit: Option<String> = conn
        .query_row(
            "SELECT id FROM learnings
             WHERE content_hash = ?1
               AND agent_scope = ?2
               AND status NOT IN ('deprecated', 'abandoned')
             LIMIT 1",
            params![hash, agent_scope],
            |row| row.get(0),
        )
        .optional()?;

    if let Some(id) = hit {
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE learnings
             SET reinforcement_count = reinforcement_count + 1,
                 updated_at = ?1
             WHERE id = ?2",
            params![now, id],
        )?;
        info!(
            "[learnings] hash dedup hit: scope={} id={} — reinforced",
            agent_scope, id
        );
        return Ok(DedupResult::Reinforced(id));
    }
    Ok(DedupResult::Novel)
}
