//! Post-session L3 write paths.
//!
//! Three sibling modules cover the post-session reflection pipeline:
//!
//! - **This file (`reflection`)** — LLM-extracted behavioral insights.
//!   Loads the session transcript, asks an LLM to extract behavioral
//!   insights gated on novelty, hash-dedups (reinforce existing row on
//!   exact-content hit), then appends raw insights with `status = 'pending'`.
//!
//! - **`active_learning`** — pattern-mined insights. Scans the tool
//!   history for `(tool_error → user intervention)` patterns; if 2+ occur
//!   in a single session, fires an extraction LLM call to surface the
//!   blind spot as an `active_observation` pending row.
//!
//! - **`blacklist`** — persistent `(account, model)` blacklist.
//!   When reflection or active-learning fails for an account/model pair
//!   (provider error, quota, missing model), the pair is recorded here and
//!   future attempts are skipped indefinitely until the user clears the
//!   row. Shared by the two write paths above.
//!
//! **Write-path contract:** append-only. No embedding call, no cosine search,
//! no LLM evolve decision here. Semantic dedup and `pending → active`
//! promotion live in `super::consolidation`.
//!
//! Both reflection and active-learning run as fire-and-forget
//! `tokio::spawn` from `AgentSessionManager`.
//!
//! ## Internal layout
//!
//! - [`transcript`] — load `user`/`assistant` rows, render tail-biased text.
//! - [`provider`]   — pick `(LLMProvider, model_id)` reusing the session's
//!   model + account, with blacklist gating.
//! - [`extract`]    — call the LLM, parse the JSON array, run the post-hoc
//!   rejection guard.
//!
//! The orchestrator [`maybe_reflect_on_session`] glues these together and
//! owns the only DB write site (hash-dedup + insert as `pending`).

pub mod active_learning;
pub mod blacklist;
mod extract;
mod provider;
mod transcript;

use tracing::{debug, info, warn};

use crate::core::definitions::resolve_learnings_for;
use crate::foundation::db_bridge::get_connection;
use crate::memory::learnings::{
    self, compute_content_hash, EvolutionType, Learning, LearningCategory, LearningSource,
    LearningStatus,
};

use blacklist as reflection_blacklist;
use extract::{extract_insights, rejection_reason, MAX_INSIGHTS_PER_SESSION};
use provider::get_reflection_provider;
pub use transcript::build_transcript;
use transcript::MIN_TRANSCRIPT_LEN;

/// Attempt post-session reflection for the given session.
///
/// Returns Ok(count) with the number of learnings stored, or Err if skipped.
pub async fn maybe_reflect_on_session(session_id: &str) -> Result<usize, String> {
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

    // Strict scoping: learnings are only stored when agent_definition_id is known.
    let agent_scope = match agent_def_id {
        Some(ref id) if !id.is_empty() => learnings::scope_for_agent(id),
        _ => {
            return Err("No agent_definition_id on session — skipping reflection".to_string());
        }
    };

    // Per-agent opt-out: `learnings.enabled` (default true).
    // The read path (prompt injection of existing learnings) is intentionally
    // NOT gated.
    //
    // Background subsystem: use `resolve_learnings_for(agent_id)` instead of
    // `ResolvedAgent::resolve()`. Reflection reuses the session's recorded
    // model + account (loaded above), so it has no need for the
    // `selected_model_id` strictness check that `ResolvedAgent::resolve`
    // enforces.
    let workspace_ref = workspace_path
        .as_ref()
        .filter(|p| !p.is_empty())
        .map(std::path::PathBuf::from);
    let def_id = agent_def_id.as_deref().unwrap_or("");
    let learnings_cfg = resolve_learnings_for(def_id);
    if !learnings_cfg.enabled {
        return Err(format!(
            "Learnings disabled for agent ({}, workspace={:?})",
            agent_scope, workspace_ref
        ));
    }

    let transcript = build_transcript(&conn, session_id)?;
    if transcript.len() < MIN_TRANSCRIPT_LEN {
        return Err(format!(
            "Transcript too short ({} chars < {})",
            transcript.len(),
            MIN_TRANSCRIPT_LEN
        ));
    }

    // Reuse the session's model + account for reflection. Returns Ok(None)
    // to signal "skip silently" (no model, or blacklisted pair).
    let Some((provider, model_id)) =
        get_reflection_provider(&conn, session_model.as_deref(), session_account.as_deref())?
    else {
        return Ok(0);
    };

    // Extract insights via LLM. On failure, blacklist this (account, model)
    // pair so we don't retry at every session end until the user clears it.
    let insights = match extract_insights(&*provider, &model_id, &transcript).await {
        Ok(v) => v,
        Err(e) => {
            warn!(
                "[reflection] LLM extract failed (account={:?}, model={}): {} — blacklisting",
                session_account, model_id, e
            );
            if let Err(insert_err) =
                reflection_blacklist::record(&conn, session_account.as_deref(), &model_id, &e)
            {
                warn!(
                    "[reflection] Failed to record blacklist entry: {}",
                    insert_err
                );
            }
            return Err(e);
        }
    };
    if insights.is_empty() {
        debug!(
            "[reflection] No insights extracted for session {}",
            session_id
        );
        return Ok(0);
    }

    // Write path: hash-dedup only. Semantic dedup / evolve is deferred to the
    // offline consolidation engine. We intentionally do NOT run an embedding
    // call here — the write path is synchronous and cheap.
    let mut stored = 0usize;
    let mut reinforced = 0usize;
    let mut rejected = 0usize;

    for insight in insights.iter().take(MAX_INSIGHTS_PER_SESSION) {
        // Reject guard: even with the tightened prompt and the tool-turns-
        // excluded transcript, a handful of polluted insights can still slip
        // through (e.g. the model paraphrases a hardcoded path from a user
        // message). This is a pure-function second line of defence.
        if let Some(reason) = rejection_reason(insight) {
            rejected += 1;
            debug!(
                "[reflection] Rejected insight ({}): {}",
                reason,
                crate::utils::safe_truncate_chars_to_string(&insight.content, 80)
            );
            continue;
        }

        // LLM-output parser: hallucinated category strings are still
        // recoverable (default to `Pattern`), but warn so a future
        // prompt regression that flips the LLM toward unknown
        // categories surfaces in logs instead of silently bucketing
        // every reflection into `Pattern`.
        let category = LearningCategory::parse(&insight.category).unwrap_or_else(|| {
            tracing::warn!(
                raw = %insight.category,
                content_prefix = %crate::utils::safe_truncate_chars_to_string(&insight.content, 60),
                "[reflection] unknown LearningCategory from LLM; defaulting to Pattern"
            );
            LearningCategory::Pattern
        });

        // Hash dedup first — if we've already stored this exact content for
        // this agent, bump its `reinforcement_count` and skip the insert.
        match learnings::content_hash_dedup(&conn, &agent_scope, &insight.content, category) {
            Ok(learnings::DedupResult::Reinforced(id)) => {
                reinforced += 1;
                debug!(
                    "[reflection] Hash hit on '{}' — reinforced (no new insert)",
                    id
                );
                continue;
            }
            Ok(learnings::DedupResult::Novel) => {}
            Err(e) => {
                warn!("[reflection] Hash dedup query failed: {}", e);
            }
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
            // No write-time embedding. Consolidation computes embeddings
            // on-demand if an embedding provider is configured.
            embedding: Vec::new(),
            embedding_model: None,
            // Append-only: reflection writes land as `pending`. Promotion to
            // `active` is the consolidator's job.
            status: LearningStatus::Pending,
            content_hash: Some(compute_content_hash(&insight.content, category)),
            reinforcement_count: 1,
            source: LearningSource::Reflection,
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
                stored += 1;
                debug!(
                    "[reflection] Stored pending insight '{}': {}",
                    id,
                    crate::utils::safe_truncate_chars_to_string(&insight.content, 60)
                );
            }
            Err(e) => warn!("[reflection] Failed to store insight: {}", e),
        }
    }

    // `reinforced` and `rejected` are tracked for telemetry but intentionally
    // NOT counted in the returned `stored` count — caller contract is "rows
    // newly written", and reinforcement/rejection are not new rows.
    if stored > 0 || reinforced > 0 || rejected > 0 {
        info!(
            "[reflection] Session {} → {} pending, {} reinforced, {} rejected (scope={})",
            session_id, stored, reinforced, rejected, agent_scope
        );
    }

    Ok(stored)
}
