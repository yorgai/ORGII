//! Active-observation L3 write path (tool-failure + user-correction pattern).
//!
//! Runs post-session, sibling of [`super`] (passive narrative reflection).
//! Whereas reflection asks an LLM to extract narrative insights from the
//! user/assistant turns, this miner looks for a specific structural pattern
//! in the tool history — a `tool_result` indicating an error followed by a
//! user turn indicating the user had to intervene. Two or more such pairs
//! in a single session is a fairly strong signal that the agent has a
//! durable blind spot; we surface it as a `LearningSource::ActiveObservation`
//! pending row and let the consolidation engine decide whether it is
//! genuinely novel.
//!
//! Submodules (one concern each):
//! - [`patterns`] — pattern detection (`scan_patterns`, `detect_patterns`,
//!   `looks_like_error`, `truncate_snippet`)
//! - [`provider`] — provider selection mirror of `reflection::provider`
//! - [`extract`] — LLM extraction prompt and response parsing
//!
//! Ref: §2.3 of `Documentation/Agent/l3-memory-rebuild--0421.md`.

mod extract;
mod patterns;
mod provider;

use tracing::{debug, info, warn};

use crate::core::definitions::resolve_learnings_for;
use crate::foundation::db_bridge::get_connection;
use crate::memory::learnings::{
    self, compute_content_hash, EvolutionType, Learning, LearningCategory, LearningSource,
    LearningStatus,
};
use crate::memory::reflection::blacklist as reflection_blacklist;

use extract::extract_insight;
use patterns::{scan_patterns, MIN_PATTERN_COUNT};
use provider::get_observation_provider;

/// Attempt to extract active-observation learnings for the given session.
///
/// Mirrors the gating semantics of `reflection::maybe_reflect_on_session`
/// (strict agent scope, per-agent opt-out, shared `reflection_blacklist`).
/// Returns `Ok(n)` with the number of pending rows written, or `Err` when
/// the caller should log and move on. A skipped session (no agent scope,
/// too few patterns, disabled, no model, blacklisted) is NOT an error —
/// callers treat `Ok(0)` as the normal "nothing to observe" outcome.
pub async fn maybe_observe_tool_failures(session_id: &str) -> Result<usize, String> {
    let conn = get_connection().map_err(|e| format!("DB: {}", e))?;

    let (agent_def_id, workspace_path, session_model, session_account): (
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT agent_definition_id, workspace_path, model, account_id FROM agent_sessions WHERE session_id = ?1",
            rusqlite::params![session_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| format!("Session not found: {}", e))?;

    let agent_scope = match agent_def_id {
        Some(ref id) if !id.is_empty() => learnings::scope_for_agent(id),
        _ => {
            return Err(
                "No agent_definition_id on session — skipping active observation".to_string(),
            );
        }
    };

    let workspace_ref = workspace_path
        .as_ref()
        .filter(|p| !p.is_empty())
        .map(std::path::PathBuf::from);

    // Background subsystem: use `resolve_learnings_for(agent_id)` instead
    // of `ResolvedAgent::resolve()`. Active learning reuses the session's
    // recorded model + account (loaded above), so it has no need for the
    // `selected_model_id` strictness check that `ResolvedAgent::resolve`
    // enforces.
    let def_id = agent_def_id.as_deref().unwrap_or("");
    let learnings_cfg = resolve_learnings_for(def_id);
    if !learnings_cfg.enabled {
        return Err(format!(
            "Learnings disabled for agent ({}, workspace={:?})",
            agent_scope, workspace_ref
        ));
    }

    let patterns = scan_patterns(&conn, session_id)?;
    if patterns.len() < MIN_PATTERN_COUNT {
        debug!(
            "[active-observation] session {} has only {} pattern(s); need {} — skipping",
            session_id,
            patterns.len(),
            MIN_PATTERN_COUNT
        );
        return Ok(0);
    }

    let Some((provider, model_id)) =
        get_observation_provider(&conn, session_model.as_deref(), session_account.as_deref())?
    else {
        return Ok(0);
    };

    let insight = match extract_insight(&*provider, &model_id, &patterns).await {
        Ok(Some(v)) => v,
        Ok(None) => {
            debug!(
                "[active-observation] LLM returned no insight for session {}",
                session_id
            );
            return Ok(0);
        }
        Err(e) => {
            warn!(
                "[active-observation] LLM extract failed (account={:?}, model={}): {} — blacklisting",
                session_account, model_id, e
            );
            if let Err(insert_err) =
                reflection_blacklist::record(&conn, session_account.as_deref(), &model_id, &e)
            {
                warn!(
                    "[active-observation] Failed to record blacklist entry: {}",
                    insert_err
                );
            }
            return Err(e);
        }
    };

    // LLM-output parser: same fall-back-with-warn pattern as
    // `reflection/mod.rs` so a future LLM regression that hallucinates
    // unknown category strings surfaces in logs instead of silently
    // bucketing every active observation into `Pattern`.
    let category = LearningCategory::parse(&insight.category).unwrap_or_else(|| {
        tracing::warn!(
            raw = %insight.category,
            content_prefix = %crate::utils::safe_truncate_chars_to_string(&insight.content, 60),
            "[active-observation] unknown LearningCategory from LLM; defaulting to Pattern"
        );
        LearningCategory::Pattern
    });
    match learnings::content_hash_dedup(&conn, &agent_scope, &insight.content, category) {
        Ok(learnings::DedupResult::Reinforced(id)) => {
            debug!(
                "[active-observation] Hash hit on '{}' — reinforced (no new insert)",
                id
            );
            return Ok(0);
        }
        Ok(learnings::DedupResult::Novel) => {}
        Err(e) => warn!("[active-observation] Hash dedup query failed: {}", e),
    }

    let takeaway = insight
        .takeaway
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let learning = Learning {
        id: String::new(),
        agent_scope: agent_scope.clone(),
        content: insight.content.clone(),
        takeaway,
        category,
        importance: insight.importance,
        confidence: 0.5,
        embedding: Vec::new(),
        embedding_model: None,
        status: LearningStatus::Pending,
        content_hash: Some(compute_content_hash(&insight.content, category)),
        reinforcement_count: 1,
        source: LearningSource::ActiveObservation,
        account_id: session_account.clone(),
        evolution_type: EvolutionType::Original,
        parent_id: None,
        last_recalled_at: None,
        source_session_id: Some(session_id.to_string()),
        created_at: String::new(),
        updated_at: String::new(),
    };

    match learnings::insert_learning(&conn, &learning) {
        Ok(id) => {
            info!(
                "[active-observation] Stored pending insight '{}' from {} pattern(s) (scope={})",
                id,
                patterns.len(),
                agent_scope
            );
            Ok(1)
        }
        Err(e) => {
            warn!("[active-observation] Failed to store insight: {}", e);
            Err(format!("insert_learning: {}", e))
        }
    }
}
