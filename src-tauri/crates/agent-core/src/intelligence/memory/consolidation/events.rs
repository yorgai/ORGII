//! Event application: dispatch ADD / UPDATE / DELETE / NONE state
//! transitions for a single mem0 decision.
//!
//! `apply_event` is pure in the sense that it makes no LLM/network calls;
//! all side effects are on `conn` and are idempotent on repeat invocation
//! thanks to the `status` precondition on each `UPDATE` statement.

use rusqlite::Connection;

use super::decision::{DecisionEvent, ResolvedDecision};
use crate::intelligence::memory::learnings::{
    self, compute_content_hash, EvolutionType, Learning, LearningStatus,
};

/// Counters returned from `apply_event` so the batch loop can aggregate
/// per-event tallies into the `consolidation_runs` row.
#[derive(Debug, Default, Clone, Copy)]
pub struct EventCounts {
    pub added: u32,
    pub updated: u32,
    pub deleted: u32,
    pub none: u32,
    pub abandoned: u32,
}

/// Dispatch the state transitions for a single mem0 decision.
///
/// | Event  | Status machine                                                                       |
/// |--------|--------------------------------------------------------------------------------------|
/// | ADD    | pending row → `status = 'active'`                                                    |
/// | UPDATE | insert merged `active` child with `parent_id = target`; pending → `merged`;          |
/// |        | target → `merged`                                                                    |
/// | DELETE | target → `deprecated`; pending → `active` (the new truth)                            |
/// | NONE   | pending → `merged`                                                                   |
pub(super) fn apply_event(
    conn: &Connection,
    pending: &Learning,
    decision: &ResolvedDecision,
) -> Result<EventCounts, String> {
    let mut counts = EventCounts::default();
    match decision.event {
        DecisionEvent::Add => {
            learnings::promote_pending_to_active(conn, &pending.id)
                .map_err(|e| format!("promote failed: {}", e))?;
            counts.added = 1;
        }
        DecisionEvent::Update => {
            let Some(target_id) = decision.target_id.as_deref() else {
                return Err("UPDATE without target_id after parse".into());
            };
            let merged_text = if decision.text.is_empty() {
                pending.content.clone()
            } else {
                decision.text.clone()
            };
            let merged_takeaway = decision
                .takeaway
                .clone()
                .or_else(|| pending.takeaway.clone());

            let child = Learning {
                id: String::new(),
                agent_scope: pending.agent_scope.clone(),
                content: merged_text.clone(),
                takeaway: merged_takeaway,
                category: pending.category,
                importance: pending.importance,
                confidence: (pending.confidence + 0.1).min(1.0),
                embedding: Vec::new(),
                embedding_model: None,
                status: LearningStatus::Active,
                content_hash: Some(compute_content_hash(&merged_text, pending.category)),
                reinforcement_count: pending.reinforcement_count,
                source: pending.source,
                account_id: pending.account_id.clone(),
                evolution_type: EvolutionType::Refined,
                parent_id: Some(target_id.to_string()),
                last_recalled_at: None,
                source_session_id: pending.source_session_id.clone(),
                created_at: String::new(),
                updated_at: String::new(),
            };
            learnings::insert_learning(conn, &child)
                .map_err(|e| format!("insert merged child failed: {}", e))?;
            learnings::mark_merged(conn, target_id)
                .map_err(|e| format!("mark_merged(target) failed: {}", e))?;
            learnings::mark_merged(conn, &pending.id)
                .map_err(|e| format!("mark_merged(pending) failed: {}", e))?;
            counts.updated = 1;
        }
        DecisionEvent::Delete => {
            let Some(target_id) = decision.target_id.as_deref() else {
                return Err("DELETE without target_id after parse".into());
            };
            learnings::deprecate_learning(conn, target_id)
                .map_err(|e| format!("deprecate(target) failed: {}", e))?;
            learnings::promote_pending_to_active(conn, &pending.id)
                .map_err(|e| format!("promote(pending) failed: {}", e))?;
            counts.deleted = 1;
        }
        DecisionEvent::None => {
            learnings::mark_merged(conn, &pending.id)
                .map_err(|e| format!("mark_merged(pending) failed: {}", e))?;
            counts.none = 1;
        }
    }
    Ok(counts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::intelligence::memory::consolidation::tests_support::{pending, setup_conn};
    use crate::intelligence::memory::learnings::{insert_learning, load_learning_by_id};

    #[test]
    fn apply_event_add_promotes_pending() {
        let conn = setup_conn();
        let mut p = pending("agent:t", "fact one");
        p.id = insert_learning(&conn, &p).unwrap();

        let decision = ResolvedDecision {
            target_id: None,
            event: DecisionEvent::Add,
            text: String::new(),
            takeaway: None,
        };
        let counts = apply_event(&conn, &p, &decision).unwrap();
        assert_eq!(counts.added, 1);
        let reloaded = load_learning_by_id(&conn, &p.id).unwrap().unwrap();
        assert_eq!(reloaded.status, LearningStatus::Active);
    }

    #[test]
    fn apply_event_update_inserts_child_and_merges_both() {
        let conn = setup_conn();
        let mut active = pending("agent:t", "original");
        active.status = LearningStatus::Active;
        active.id = insert_learning(&conn, &active).unwrap();

        let mut p = pending("agent:t", "refined");
        p.id = insert_learning(&conn, &p).unwrap();

        let decision = ResolvedDecision {
            target_id: Some(active.id.clone()),
            event: DecisionEvent::Update,
            text: "merged text".into(),
            takeaway: Some("updated rule".into()),
        };
        let counts = apply_event(&conn, &p, &decision).unwrap();
        assert_eq!(counts.updated, 1);
        assert_eq!(
            load_learning_by_id(&conn, &p.id).unwrap().unwrap().status,
            LearningStatus::Merged
        );
        assert_eq!(
            load_learning_by_id(&conn, &active.id)
                .unwrap()
                .unwrap()
                .status,
            LearningStatus::Merged
        );

        let rows: Vec<String> = conn
            .prepare("SELECT content FROM learnings WHERE parent_id = ?1 AND status = 'active'")
            .unwrap()
            .query_map(rusqlite::params![active.id], |r| r.get::<_, String>(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(rows, vec!["merged text"]);
    }

    #[test]
    fn apply_event_delete_deprecates_target_and_promotes_pending() {
        let conn = setup_conn();
        let mut active = pending("agent:t", "stale");
        active.status = LearningStatus::Active;
        active.id = insert_learning(&conn, &active).unwrap();

        let mut p = pending("agent:t", "contradicts stale");
        p.id = insert_learning(&conn, &p).unwrap();

        let decision = ResolvedDecision {
            target_id: Some(active.id.clone()),
            event: DecisionEvent::Delete,
            text: "contradicts stale".into(),
            takeaway: None,
        };
        let counts = apply_event(&conn, &p, &decision).unwrap();
        assert_eq!(counts.deleted, 1);
        assert_eq!(
            load_learning_by_id(&conn, &active.id)
                .unwrap()
                .unwrap()
                .status,
            LearningStatus::Deprecated
        );
        assert_eq!(
            load_learning_by_id(&conn, &p.id).unwrap().unwrap().status,
            LearningStatus::Active
        );
    }

    #[test]
    fn apply_event_none_marks_pending_merged() {
        let conn = setup_conn();
        let mut p = pending("agent:t", "dup");
        p.id = insert_learning(&conn, &p).unwrap();

        let decision = ResolvedDecision {
            target_id: Some("ignored".into()),
            event: DecisionEvent::None,
            text: String::new(),
            takeaway: None,
        };
        let counts = apply_event(&conn, &p, &decision).unwrap();
        assert_eq!(counts.none, 1);
        assert_eq!(
            load_learning_by_id(&conn, &p.id).unwrap().unwrap().status,
            LearningStatus::Merged
        );
    }
}
