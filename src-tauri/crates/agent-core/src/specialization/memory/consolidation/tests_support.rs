//! Shared in-memory `Connection` + `Learning` fixture builder used by the
//! per-submodule unit tests.

use rusqlite::Connection;

use crate::specialization::memory::learnings::{
    compute_content_hash, init_learnings_table, EvolutionType, Learning, LearningCategory,
    LearningSource, LearningStatus,
};

pub(crate) fn setup_conn() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    // Minimal agent_sessions stub — only the columns consolidation touches.
    conn.execute_batch(
        "CREATE TABLE agent_sessions (
            session_id   TEXT PRIMARY KEY,
            model        TEXT,
            workspace_path TEXT,
            updated_at   TEXT
        );",
    )
    .unwrap();
    init_learnings_table(&conn).unwrap();
    conn
}

pub(crate) fn pending(scope: &str, content: &str) -> Learning {
    let category = LearningCategory::Pattern;
    Learning {
        id: String::new(),
        agent_scope: scope.into(),
        content: content.into(),
        takeaway: None,
        category,
        importance: 0.6,
        confidence: 0.5,
        embedding: Vec::new(),
        embedding_model: None,
        status: LearningStatus::Pending,
        content_hash: Some(compute_content_hash(content, category)),
        reinforcement_count: 1,
        source: LearningSource::Reflection,
        account_id: None,
        evolution_type: EvolutionType::Original,
        parent_id: None,
        last_recalled_at: None,
        source_session_id: None,
        created_at: String::new(),
        updated_at: String::new(),
    }
}
