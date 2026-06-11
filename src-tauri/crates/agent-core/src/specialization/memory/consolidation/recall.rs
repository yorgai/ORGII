//! Candidate recall (Mode A: embedding / Mode B: salience-ranked manifest).
//!
//! Both modes converge on the same per-row LLM decision step in
//! `super::batch::consolidate_batch`; only the candidate shortlisting
//! differs.

use rusqlite::Connection;

use crate::specialization::memory::embeddings::AutoEmbeddingProvider;
use crate::specialization::memory::learnings::{self, Learning};

/// How many candidate active learnings to show the LLM per decision. mem0
/// defaults to 10; we start at 5 to keep the prompt small.
pub(super) const CANDIDATE_POOL: usize = 5;

/// Mode B cap: when no embedding is available, how many active rows feed
/// the salience ranker before truncation to `CANDIDATE_POOL`.
const MANIFEST_SHORTLIST: usize = 30;

/// Mode A: embedding-based recall. Embeds `new_fact.content` via the agent's
/// `AutoEmbeddingProvider` and returns the top-K cosine neighbors from the
/// scope's `active` rows.
pub(super) async fn recall_mode_embedding(
    conn: &Connection,
    scope: &str,
    new_fact: &Learning,
    embed: &AutoEmbeddingProvider,
) -> Result<Vec<Learning>, String> {
    use crate::specialization::memory::embeddings::EmbeddingProvider;

    let r = embed
        .embed(&new_fact.content)
        .await
        .map_err(|e| format!("embedding probe failed during consolidation: {}", e))?;
    let hits =
        learnings::search_similar(conn, scope, &r.vector, Some(&r.model), CANDIDATE_POOL, 0.0)
            .map_err(|e| format!("search_similar failed: {}", e))?;
    Ok(hits.into_iter().map(|(l, _score)| l).collect())
}

/// Mode B: manifest fallback. Takes the top `MANIFEST_SHORTLIST` active rows
/// by the salience formula, filters to same-category to preserve
/// comparability, then truncates to `CANDIDATE_POOL`.
///
/// Loads from `load_active_candidates` (status='active' only), NOT from
/// `load_active_learnings_ranked` which the prompt-injection read path uses.
/// The read path intentionally includes `pending` rows so newly-extracted
/// insights show up in the next turn; but on the consolidation write path
/// that same inclusion becomes a self-shadowing bug — a pending row finds
/// itself (or its sibling pending rows) as "similar neighbours", the LLM
/// picks UPDATE/MERGE, and the whole pending batch collapses into `merged`
/// status without ever graduating to `active`. See
/// `Documentation/Agent/audit-fallbacks-0421.md` for the 14 rows lost this
/// way on `agent:builtin:sde` before 0421.
pub(super) fn recall_mode_manifest(
    conn: &Connection,
    scope: &str,
    new_fact: &Learning,
) -> Result<Vec<Learning>, String> {
    let mut active = learnings::load_active_candidates(conn, scope)
        .map_err(|e| format!("load_active_candidates failed: {}", e))?;
    // Salience-rank the active pool the same way the read path does, so
    // high-value learnings are considered first. `salience_score` lives in
    // `learnings_query.rs` but is `pub(crate)` so we can reach it through
    // the `learnings` module path.
    active.sort_by(|a, b| {
        let sa = learnings::salience_score(a);
        let sb = learnings::salience_score(b);
        sb.partial_cmp(&sa).unwrap_or(std::cmp::Ordering::Equal)
    });
    let pool: Vec<Learning> = active
        .into_iter()
        .take(MANIFEST_SHORTLIST)
        .filter(|l| l.category == new_fact.category)
        .take(CANDIDATE_POOL)
        .collect();
    Ok(pool)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::specialization::memory::consolidation::tests_support::{pending, setup_conn};
    use crate::specialization::memory::learnings::{
        compute_content_hash, insert_learning, load_learning_by_id, LearningCategory,
        LearningStatus,
    };

    #[test]
    fn recall_manifest_filters_by_category_and_caps_pool() {
        let conn = setup_conn();
        // Insert 8 active patterns + 4 active corrections. Manifest should
        // only return up to CANDIDATE_POOL (5) and only patterns.
        for idx in 0..8 {
            let mut l = pending("agent:t", &format!("pattern {}", idx));
            l.status = LearningStatus::Active;
            insert_learning(&conn, &l).unwrap();
        }
        for idx in 0..4 {
            let mut l = pending("agent:t", &format!("correction {}", idx));
            l.category = LearningCategory::Correction;
            l.content_hash = Some(compute_content_hash(&l.content, l.category));
            l.status = LearningStatus::Active;
            insert_learning(&conn, &l).unwrap();
        }
        let new_fact = pending("agent:t", "pattern new");
        let pool = recall_mode_manifest(&conn, "agent:t", &new_fact).unwrap();
        assert!(pool.len() <= CANDIDATE_POOL);
        for l in &pool {
            assert_eq!(l.category, LearningCategory::Pattern);
        }
    }

    /// Regression guard: `recall_mode_manifest` must NOT return pending rows
    /// in its candidate pool. If it does, sibling pending rows from the same
    /// consolidation batch will mutually-UPDATE each other and the entire
    /// batch collapses into `merged` status without ever reaching `active`.
    ///
    /// This is the bug that produced the 14 dead rows on `agent:builtin:sde`
    /// before 0421 — see `Documentation/Agent/audit-fallbacks-0421.md`.
    #[test]
    fn recall_mode_manifest_excludes_pending_candidates() {
        let conn = setup_conn();
        let scope = "agent:test";

        // Two pending rows (same category, same scope) + one active row.
        let mut p1 = pending(scope, "pending insight 1");
        let mut p2 = pending(scope, "pending insight 2");
        let mut a1 = pending(scope, "active reference insight");
        a1.status = LearningStatus::Active;

        p1.id = insert_learning(&conn, &p1).unwrap();
        p2.id = insert_learning(&conn, &p2).unwrap();
        a1.id = insert_learning(&conn, &a1).unwrap();

        let new_fact = load_learning_by_id(&conn, &p1.id).unwrap().unwrap();

        let pool = recall_mode_manifest(&conn, scope, &new_fact).unwrap();

        assert!(
            pool.iter().any(|l| l.id == a1.id),
            "active candidate must appear in pool"
        );
        assert!(
            !pool.iter().any(|l| l.id == p1.id),
            "pool must not contain the new_fact itself"
        );
        assert!(
            !pool.iter().any(|l| l.id == p2.id),
            "pool must not contain sibling pending rows"
        );
        assert!(
            pool.iter()
                .all(|l| matches!(l.status, LearningStatus::Active)),
            "every pool entry must be status=Active, got: {:?}",
            pool.iter().map(|l| (&l.id, &l.status)).collect::<Vec<_>>()
        );
    }

    /// Regression guard for the same bug via `search_similar` (Mode A, embedding
    /// recall path). Even without embeddings populated the filter should still
    /// exclude pending rows at the SQL boundary.
    #[test]
    fn search_similar_excludes_pending_rows() {
        let conn = setup_conn();
        let scope = "agent:test";

        let mut p1 = pending(scope, "pending candidate");
        let mut a1 = pending(scope, "active candidate");
        a1.status = LearningStatus::Active;
        // Give both rows a fake embedding so `search_similar` doesn't skip
        // them on the `embedding.is_empty()` filter. A single-dim vector is
        // sufficient to exercise the code path.
        p1.embedding = vec![1.0_f32];
        p1.embedding_model = Some("test".into());
        a1.embedding = vec![1.0_f32];
        a1.embedding_model = Some("test".into());

        p1.id = insert_learning(&conn, &p1).unwrap();
        a1.id = insert_learning(&conn, &a1).unwrap();

        let hits = crate::specialization::memory::learnings::search_similar(
            &conn,
            scope,
            &[1.0_f32],
            Some("test"),
            10,
            0.0,
        )
        .unwrap();

        assert!(
            hits.iter().any(|(l, _)| l.id == a1.id),
            "active row must appear in search hits"
        );
        assert!(
            !hits.iter().any(|(l, _)| l.id == p1.id),
            "pending row must NOT appear in search hits — {} was the bug before 0421",
            p1.id
        );
    }
}
