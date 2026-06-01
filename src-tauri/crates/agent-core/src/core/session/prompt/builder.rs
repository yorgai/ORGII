//! Unified system prompt builder — registry-driven.
//!
//! [`build_unified_system_prompt`] is now a thin shim around the
//! declarative registry in [`super::registry`]. The 18 hard-coded
//! `if let Some(...)` / positional-push branches that used to live
//! here are now individual [`super::registry::PromptSection`] impls in
//! [`super::sections`]. This file only handles:
//!
//! 1. Wrapping `(session_id, tool_summaries, config)` into a
//!    [`super::registry::PromptCtx`].
//! 2. Calling `registry::assemble(&ctx)`.
//! 3. Logging the prompt length and (for sovereign sessions) the
//!    legacy info-line so existing log scrapers keep working.
//!
//! Sovereign sessions are NOT a separate fast-path anymore: the
//! sovereign filter is enforced inside `assemble()` via
//! [`PromptSection::sovereign_safe`]. A sovereign session with
//! `agent_skills_config = None` and no `agent_org_context` therefore
//! gets exactly the same five sections the legacy
//! `build_sovereign_prompt` produced (identity, system_meta,
//! available_tools, rules, learnings) in the same order.

use crate::session::types::{SystemPromptConfig, ToolSummary};

use super::cache::{LearningsPromptCache, SessionPromptCache};
use super::registry::{assemble, assemble_with_cache, PromptCtx};

/// Build the system prompt for a session.
///
/// Single source of truth for system-prompt assembly. Walks the
/// registry once, joins matched sections by `"\n\n"`, returns the
/// resulting string. The trace is dropped — `prompt_dump` calls
/// `assemble()` directly when it needs the per-section breakdown.
pub fn build_unified_system_prompt(
    session_id: &str,
    tool_summaries: &[ToolSummary],
    config: &SystemPromptConfig,
) -> String {
    build_unified_system_prompt_with_cache(session_id, tool_summaries, config, None, None)
}

/// Build the system prompt for a session using the provided section cache.
pub fn build_unified_system_prompt_with_cache(
    session_id: &str,
    tool_summaries: &[ToolSummary],
    config: &SystemPromptConfig,
    cache: Option<&mut SessionPromptCache>,
    learnings_cache: Option<&mut LearningsPromptCache>,
) -> String {
    let ctx = PromptCtx::new(session_id, config, tool_summaries);
    let (prompt, _traces) = match (cache, learnings_cache) {
        (Some(cache_ref), Some(learnings_cache_ref)) => {
            assemble_with_cache(&ctx, Some(cache_ref), Some(learnings_cache_ref))
        }
        (Some(cache_ref), None) => assemble_with_cache(&ctx, Some(cache_ref), None),
        (None, Some(learnings_cache_ref)) => {
            assemble_with_cache(&ctx, None, Some(learnings_cache_ref))
        }
        (None, None) => assemble(&ctx),
    };

    if config.sovereign_prompt {
        tracing::info!(
            "[prompt-builder] sovereign session={} agent={} prompt_len={}",
            session_id,
            config.agent_id,
            prompt.len()
        );
    }

    prompt
}
