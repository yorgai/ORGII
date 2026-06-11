//! Forked-agent runner for memory extraction.
//!
//! Spawns the `builtin:memory-extractor` agent against the parent's
//! prompt-cache-shared message history, with a restricted tool policy
//! that allows reads everywhere but writes only inside the workspace's
//! workspace-memory directory. Mutates the cursor + overlap-guard fields on
//! `ExtractMemoriesState` once the fork returns.

use std::sync::Arc;
use tracing::{info, warn};

use crate::definitions::builtin::MEMORY_EXTRACTOR_ID;
use crate::definitions::resolve_definition_by_id;
use crate::tools::names as tool_names;
use crate::tools::registry::ToolRegistry;
use crate::turn_executor::{self, TurnConfig};

use super::gating::count_new_messages;
use super::state::ExtractMemoriesState;

/// Max iterations for the extraction forked agent.
const MAX_EXTRACTION_TURNS: u32 = 5;

/// Run extraction as a fire-and-forget background task.
///
/// This spawns a forked agent that:
/// 1. Inherits the parent conversation as message prefix (prompt cache sharing)
/// 2. Gets the extraction prompt as its user message
/// 3. Has a restricted tool set (read-only + edit within memory dir)
/// 4. Runs for at most MAX_EXTRACTION_TURNS iterations
pub async fn run_extraction(
    state: &mut ExtractMemoriesState,
    params: super::super::super::MemoryAgentParams<'_>,
) -> Result<(), String> {
    state.in_progress = true;
    state.turns_since_extraction = 0;

    let workspace = params.workspace;
    let mem_dir = super::super::memory_dir(workspace);

    if let Err(err) = std::fs::create_dir_all(&mem_dir) {
        state.in_progress = false;
        return Err(format!("Failed to create memory dir: {}", err));
    }

    let agent_def =
        resolve_definition_by_id(MEMORY_EXTRACTOR_ID, params.definitions_store.as_deref())
            .map_err(|err| {
                format!(
                    "Agent definition not found: {}: {}",
                    MEMORY_EXTRACTOR_ID, err
                )
            })?;

    let messages = params.messages;
    let new_count = count_new_messages(messages, state.last_processed_idx);
    let existing_memories =
        super::super::format_memory_manifest(&super::super::scan_memory_files(&mem_dir));
    let user_prompt = build_extraction_prompt(new_count, &existing_memories, &mem_dir);

    // Shadow mode: the fork sees the *same* tool list as the parent —
    // tools are part of the prompt cache key, so sharing them preserves
    // cache hits. What the fork is *allowed* to invoke is gated at
    // runtime by `memory_policy`, not by pruning the registry.
    let effective_registry: Arc<ToolRegistry> = params.parent_tools.clone();
    let effective_policy = super::super::build_memory_policy();

    let system_prompt = messages
        .first()
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();

    let mut fork_messages = Vec::with_capacity(messages.len() + 1);
    fork_messages.push(serde_json::json!({
        "role": "system",
        "content": system_prompt,
    }));
    for msg in messages.iter() {
        let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");
        if role != "system" {
            fork_messages.push(msg.clone());
        }
    }
    fork_messages.push(serde_json::json!({
        "role": "user",
        "content": user_prompt,
    }));

    let turn_config = TurnConfig {
        model: params.model.to_string(),
        max_iterations: Some(MAX_EXTRACTION_TURNS),
        max_tokens: agent_def.max_tokens.unwrap_or(4096) as u32,
        temperature: agent_def.temperature.unwrap_or(0.0) as f32,
        max_tool_use_concurrency: agent_def
            .max_tool_use_concurrency
            .unwrap_or(crate::core::definitions::schema::DEFAULT_MAX_TOOL_USE_CONCURRENCY)
            as usize,
        screenshot_store: None,
        iteration_hook: None,
        persist_cancel_marker: false,
    };

    let session_id = params.session_id;
    let subagent_session_id = format!("extract-mem-{}-{}", session_id, uuid::Uuid::new_v4());

    let handler = super::NoopEventHandler;

    info!(
        "[extract_memories] Starting extraction: session={}, new_messages={}, memory_dir={}",
        session_id,
        new_count,
        mem_dir.display()
    );

    let result = turn_executor::execute_turn(
        &mut fork_messages,
        params.provider.as_ref(),
        effective_registry.as_ref(),
        &effective_policy,
        &turn_config,
        &subagent_session_id,
        &handler,
        None,
        None,
        Some(workspace),
        None,
    )
    .await;

    state.in_progress = false;

    match result {
        Ok(turn_result) => {
            state.last_processed_idx = Some(messages.len().saturating_sub(1));

            info!(
                "[extract_memories] Completed: session={}, tokens={}",
                session_id, turn_result.total_tokens
            );
            Ok(())
        }
        Err(err) => {
            warn!(
                "[extract_memories] Error: session={}, err={}",
                session_id, err
            );
            Err(format!("Extraction failed: {}", err))
        }
    }
}

/// Build the extraction user prompt.
fn build_extraction_prompt(
    new_message_count: usize,
    existing_memories: &str,
    mem_dir: &std::path::Path,
) -> String {
    let manifest = if existing_memories.is_empty() {
        String::new()
    } else {
        format!(
            "\n\n## Existing memory files\n\n{}\n\nCheck this list before writing — update an existing file rather than creating a duplicate.",
            existing_memories
        )
    };

    let mem_dir_str = mem_dir.display();

    format!(
        r#"You are now acting as the memory extraction subagent. Analyze the most recent ~{count} messages above and use them to update your persistent memory systems.

Available tools: {read}, {search}, {list_dir}, read-only {shell} (ls/find/cat/stat/wc/head/tail and similar), and {edit} for paths inside {dir} only. All other tools will be denied.

You have a limited turn budget. {edit} requires a prior {read} of the same file, so the efficient strategy is: turn 1 — issue all {read} calls in parallel for every file you might update; turn 2 — issue all {edit} calls in parallel. Do not interleave reads and writes across multiple turns.

You MUST only use content from the last ~{count} messages to update your persistent memories. Do not waste any turns attempting to research or verify that content further — no grepping source files, no reading code to confirm a pattern exists, no git commands.{manifest}

If the user explicitly asks you to remember something, save it immediately as whichever type fits best. If they ask you to forget something, find and remove the relevant entry.

{types}
{not_to_save}

## How to save memories

Saving a memory is a two-step process:

**Step 1** — write the memory to its own file (e.g., `user_role.md`, `feedback_testing.md`) using this frontmatter format:

{frontmatter}

**Step 2** — add a pointer to that file in `MEMORY.md`. `MEMORY.md` is an index, not a memory — each entry should be one line, under ~150 characters: `- [Title](file.md) — one-line hook`. It has no frontmatter. Never write memory content directly into `MEMORY.md`.

- `MEMORY.md` is always loaded into your system prompt — lines after 200 will be truncated, so keep the index concise
- Organize memory semantically by topic, not chronologically
- Update or remove memories that turn out to be wrong or outdated
- Do not write duplicate memories. First check if there is an existing memory you can update before writing a new one."#,
        count = new_message_count,
        read = tool_names::READ_FILE,
        search = tool_names::CODE_SEARCH,
        list_dir = tool_names::LIST_DIR,
        shell = tool_names::RUN_SHELL,
        edit = tool_names::EDIT_FILE,
        dir = mem_dir_str,
        manifest = manifest,
        types = super::super::prompt_sections::TYPES_SECTION,
        not_to_save = super::super::prompt_sections::WHAT_NOT_TO_SAVE,
        frontmatter = super::super::prompt_sections::MEMORY_FRONTMATTER_EXAMPLE,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_build_extraction_prompt_content() {
        let prompt = build_extraction_prompt(
            10,
            "- [user] prefs.md (2024-04-07): User preferences",
            Path::new("/tmp/memory"),
        );

        assert!(prompt.contains("memory extraction subagent"));
        assert!(prompt.contains("~10 messages"));
        assert!(prompt.contains("prefs.md"));
        assert!(prompt.contains("Existing memory files"));
        assert!(prompt.contains("## Types of memory"));
        assert!(prompt.contains("## What NOT to save"));
        assert!(prompt.contains("MEMORY.md"));
    }

    #[test]
    fn test_build_extraction_prompt_no_existing() {
        let prompt = build_extraction_prompt(5, "", Path::new("/tmp/memory"));

        assert!(prompt.contains("~5 messages"));
        assert!(!prompt.contains("Existing memory files"));
    }
}
