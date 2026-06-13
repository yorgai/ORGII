//! Relevance Prefetch — select relevant workspace memories via a side-query
//! and inject them into the system prompt.
//!
//! # Flow
//!
//! 1. At session start / first turn, scan the memory directory for headers
//! 2. Ask the LLM (Sonnet-class) to select the most relevant memories (up to 5)
//! 3. Read the selected memory files and inject their content into the system prompt
//! 4. Include freshness caveats for stale memories
//!
//! This is a non-blocking side-query — if it fails or times out, the session
//! proceeds without workspace memories.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use tracing::{info, warn};

use serde_json::Value;

use super::prompt_sections::{MEMORY_DRIFT_CAVEAT, TRUSTING_RECALL, WHEN_TO_ACCESS};
use super::{MemoryHeader, ENTRYPOINT_NAME};
use crate::core::side_query::{self, SideQueryConfig};
use crate::providers::traits::LLMProvider;

// ============================================
// Selection System Prompt
// ============================================

/// System prompt for the memory selection side-query.
pub const SELECT_MEMORIES_SYSTEM_PROMPT: &str = "\
You are selecting memories that will be useful to the agent as it processes a user's query. \
You will be given the user's query and a list of available memory files with their filenames and descriptions.

Return a list of filenames for the memories that will clearly be useful as the agent processes the user's query (up to 5). \
Only include memories that you are certain will be helpful based on their name and description.
- If you are unsure if a memory will be useful in processing the user's query, then do not include it in your list. Be selective and discerning.
- If there are no memories in the list that would clearly be useful, feel free to return an empty list.
- If a list of recently-used tools is provided, do not select memories that are usage reference or API documentation for those tools (the agent is already exercising them). \
DO still select memories containing warnings, gotchas, or known issues about those tools — active use is exactly when those matter.";

/// Maximum memories to inject per turn.
const MAX_SELECTED_MEMORIES: usize = 5;

/// Maximum bytes of memory content to inject into the system prompt.
const MAX_MEMORY_INJECTION_BYTES: usize = 50_000;

/// Maximum tokens for the memory-selection side-query response.
const SELECTION_MAX_TOKENS: u32 = 256;

/// Maximum recent tool names included in the selector context.
const MAX_RECENT_TOOLS: usize = 10;

const ROLE_ASSISTANT: &str = "assistant";
const ROLE_TOOL: &str = "tool";

// ============================================
// Types
// ============================================

/// A memory selected for injection.
#[derive(Debug, Clone)]
pub struct RelevantMemory {
    /// Absolute path to the memory file.
    pub path: String,
    /// Modification timestamp in ms since epoch.
    pub mtime_ms: u64,
    /// Content of the memory file.
    pub content: String,
    /// Freshness caveat (empty if fresh).
    pub freshness: String,
}

// ============================================
// Memory Selection
// ============================================

/// Select memories via a relevance side-query.
///
/// The selector sees the user's current query plus the memory manifest and
/// returns filenames to inject. If the side-query fails, we fall back to the
/// offline newest-first selector so workspace memory remains best-effort instead
/// of disappearing. A successful empty selection is respected as "no relevant
/// memory" instead of forcing unrelated memories into the prompt.
pub async fn select_memories(
    provider: &dyn LLMProvider,
    workspace: &Path,
    user_query: &str,
    model: &str,
    recent_tools: &[String],
    already_surfaced: &HashSet<String>,
) -> Vec<RelevantMemory> {
    let mem_dir = super::memory_dir(workspace);
    if !mem_dir.exists() {
        return Vec::new();
    }

    let headers: Vec<MemoryHeader> = super::scan_memory_files(&mem_dir)
        .into_iter()
        .filter(|header| {
            !already_surfaced.contains(&header.file_path.to_string_lossy().to_string())
        })
        .collect();
    if headers.is_empty() {
        return Vec::new();
    }

    match select_relevant_headers(provider, user_query, &headers, model, recent_tools).await {
        Ok(selected) => load_selected_memories(&selected, MAX_SELECTED_MEMORIES),
        Err(err) => {
            warn!(
                "[relevance_prefetch] Selector failed: {}; falling back to newest-first",
                err
            );
            load_selected_memories(&headers, MAX_SELECTED_MEMORIES)
        }
    }
}

/// Select all memories from the directory (offline, no LLM side-query).
pub fn select_memories_offline(workspace: &Path, _user_query: &str) -> Vec<RelevantMemory> {
    let mem_dir = super::memory_dir(workspace);
    if !mem_dir.exists() {
        return Vec::new();
    }

    let headers = super::scan_memory_files(&mem_dir);
    if headers.is_empty() {
        return Vec::new();
    }

    load_selected_memories(&headers, MAX_SELECTED_MEMORIES)
}

async fn select_relevant_headers(
    provider: &dyn LLMProvider,
    user_query: &str,
    headers: &[MemoryHeader],
    model: &str,
    recent_tools: &[String],
) -> Result<Vec<MemoryHeader>, String> {
    let manifest = super::format_memory_manifest(headers);
    let tools_section = if recent_tools.is_empty() {
        String::new()
    } else {
        format!("\n\nRecently used tools: {}", recent_tools.join(", "))
    };

    let user_msg = serde_json::json!({
        "role": "user",
        "content": format!(
            "Query: {}\n\nAvailable memories:\n{}{}\n\nReturn JSON only: {{\"selected_memories\":[\"filename.md\"]}}",
            user_query,
            manifest,
            tools_section,
        ),
    });
    let config = SideQueryConfig {
        model: Some(model.to_string()),
        max_tokens: SELECTION_MAX_TOKENS,
        temperature: 0.0,
        system_prompt: Some(SELECT_MEMORIES_SYSTEM_PROMPT.to_string()),
        ..Default::default()
    };

    let result = side_query::side_query(provider, &[user_msg], &config, model).await?;
    let selected_filenames = parse_selected_filenames(&result.content);
    if selected_filenames.is_empty() {
        return Ok(Vec::new());
    }

    let by_filename: HashMap<&str, &MemoryHeader> = headers
        .iter()
        .map(|header| (header.filename.as_str(), header))
        .collect();
    let mut selected = Vec::new();
    let mut seen = HashSet::new();
    for filename in selected_filenames.into_iter().take(MAX_SELECTED_MEMORIES) {
        if !seen.insert(filename.clone()) {
            continue;
        }
        if let Some(header) = by_filename.get(filename.as_str()) {
            selected.push((*header).clone());
        } else {
            warn!(
                "[relevance_prefetch] Selector returned unknown memory '{}', skipping",
                filename
            );
        }
    }

    Ok(selected)
}

pub fn extract_recent_tools_from_history(history: &[Value]) -> Vec<String> {
    let mut tools = Vec::new();
    let mut seen = HashSet::new();

    for message in history.iter().rev() {
        match message.get("role").and_then(|value| value.as_str()) {
            Some(ROLE_TOOL) => {
                if let Some(name) = message.get("name").and_then(|value| value.as_str()) {
                    push_recent_tool(name, &mut tools, &mut seen);
                }
            }
            Some(ROLE_ASSISTANT) => {
                if let Some(tool_calls) =
                    message.get("tool_calls").and_then(|value| value.as_array())
                {
                    for tool_call in tool_calls.iter().rev() {
                        if tools.len() >= MAX_RECENT_TOOLS {
                            break;
                        }
                        if let Some(name) = tool_call
                            .get("function")
                            .and_then(|function| function.get("name"))
                            .and_then(|value| value.as_str())
                        {
                            push_recent_tool(name, &mut tools, &mut seen);
                        }
                    }
                }
            }
            _ => {}
        }

        if tools.len() >= MAX_RECENT_TOOLS {
            break;
        }
    }

    tools
}

fn push_recent_tool(name: &str, tools: &mut Vec<String>, seen: &mut HashSet<String>) {
    let trimmed = name.trim();
    if trimmed.is_empty() || !seen.insert(trimmed.to_string()) {
        return;
    }
    tools.push(trimmed.to_string());
}

fn parse_selected_filenames(text: &str) -> Vec<String> {
    let trimmed = text.trim();
    let json_slice = if trimmed.starts_with('{') {
        trimmed
    } else if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        &trimmed[start..=end]
    } else {
        trimmed
    };

    if let Ok(value) = serde_json::from_str::<Value>(json_slice) {
        return value
            .get("selected_memories")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(str::trim))
                    .filter(|item| !item.is_empty())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
    }

    trimmed
        .lines()
        .map(|line| line.trim().trim_start_matches("- ").trim())
        .filter(|line| line.ends_with(".md"))
        .map(str::to_string)
        .collect()
}

/// Load memory file contents for the selected headers.
fn load_selected_memories(headers: &[MemoryHeader], max_count: usize) -> Vec<RelevantMemory> {
    let mut memories = Vec::new();
    let mut total_bytes = 0;

    for header in headers.iter().take(max_count) {
        let content = match fs::read_to_string(&header.file_path) {
            Ok(content) => content,
            Err(err) => {
                warn!(
                    "[relevance_prefetch] Failed to read {}: {}",
                    header.filename, err
                );
                continue;
            }
        };

        if total_bytes + content.len() > MAX_MEMORY_INJECTION_BYTES {
            info!(
                "[relevance_prefetch] Byte limit reached after {} memories",
                memories.len()
            );
            break;
        }

        let freshness = super::memory_freshness_text(header.mtime_ms);
        total_bytes += content.len();

        memories.push(RelevantMemory {
            path: header.file_path.to_string_lossy().to_string(),
            mtime_ms: header.mtime_ms,
            content,
            freshness,
        });
    }

    memories
}

// ============================================
// Prompt Injection
// ============================================

/// Build the workspace memory section for the system prompt.
///
/// Includes:
/// - The MEMORY.md index (if present)
/// - Selected memory file contents
/// - Freshness caveats for stale memories
/// - WHEN_TO_ACCESS and TRUSTING_RECALL guidance sections
///
/// Returns `None` if there are no memories and no MEMORY.md.
pub fn build_memory_prompt_section(
    workspace: &Path,
    memories: &[RelevantMemory],
) -> Option<String> {
    let mem_dir = super::memory_dir(workspace);
    let index = super::load_memory_index(&mem_dir);

    if index.is_empty() && memories.is_empty() {
        return None;
    }

    let mut sections = Vec::new();

    sections.push("# Workspace Memory".to_string());
    sections.push(String::new());
    sections.push(MEMORY_DRIFT_CAVEAT.to_string());

    // MEMORY.md index
    if !index.is_empty() {
        sections.push(String::new());
        sections.push(format!(
            "## Memory Index ({}/{})",
            ENTRYPOINT_NAME,
            mem_dir.display()
        ));
        sections.push(String::new());
        sections.push(index);
    }

    // Selected memory contents
    if !memories.is_empty() {
        sections.push(String::new());
        sections.push(format!("## Loaded Memories ({} files)", memories.len()));

        for mem in memories {
            sections.push(String::new());
            sections.push(format!("### `{}`", mem.path));
            if !mem.freshness.is_empty() {
                sections.push(String::new());
                sections.push(format!("> {}", mem.freshness));
            }
            sections.push(String::new());
            sections.push(mem.content.clone());
        }
    }

    // Access guidance
    sections.push(String::new());
    sections.push(WHEN_TO_ACCESS.to_string());
    sections.push(String::new());
    sections.push(TRUSTING_RECALL.to_string());

    Some(sections.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_select_memories_offline_no_dir() {
        let tmp = TempDir::new().unwrap();
        let result = select_memories_offline(tmp.path(), "test query");
        assert!(result.is_empty());
    }

    #[test]
    fn test_select_memories_offline_with_files() {
        let tmp = TempDir::new().unwrap();
        let mem_dir = tmp.path().join(".orgii").join("workspace-memory");
        std::fs::create_dir_all(&mem_dir).unwrap();

        std::fs::write(
            mem_dir.join("user_prefs.md"),
            "---\nname: User Prefs\ndescription: Preferences\ntype: user\n---\nI prefer tabs.",
        )
        .unwrap();
        std::fs::write(
            mem_dir.join("workspace_arch.md"),
            "---\nname: Arch\ndescription: Architecture\ntype: workspace\n---\nMonorepo layout.",
        )
        .unwrap();

        let result = select_memories_offline(tmp.path(), "how is the workspace structured?");
        assert_eq!(result.len(), 2);
        assert!(result.iter().any(|m| m.content.contains("tabs")));
        assert!(result.iter().any(|m| m.content.contains("Monorepo")));
    }

    #[test]
    fn test_build_memory_prompt_section_empty() {
        let tmp = TempDir::new().unwrap();
        let result = build_memory_prompt_section(tmp.path(), &[]);
        assert!(result.is_none());
    }

    #[test]
    fn test_build_memory_prompt_section_with_memories() {
        let tmp = TempDir::new().unwrap();
        let mem_dir = tmp.path().join(".orgii").join("workspace-memory");
        std::fs::create_dir_all(&mem_dir).unwrap();
        std::fs::write(
            mem_dir.join("MEMORY.md"),
            "- [Prefs](prefs.md) — User preferences",
        )
        .unwrap();

        let memories = vec![RelevantMemory {
            path: "/tmp/prefs.md".to_string(),
            mtime_ms: 1712448000000,
            content: "I prefer tabs.".to_string(),
            freshness: String::new(),
        }];

        let result = build_memory_prompt_section(tmp.path(), &memories);
        assert!(result.is_some());
        let section = result.unwrap();
        assert!(section.contains("# Workspace Memory"));
        assert!(section.contains("Memory Index"));
        assert!(section.contains("Loaded Memories"));
        assert!(section.contains("prefer tabs"));
        assert!(section.contains("When to access memories"));
        assert!(section.contains("Before recommending from memory"));
    }

    #[test]
    fn test_build_memory_prompt_section_index_only() {
        let tmp = TempDir::new().unwrap();
        let mem_dir = tmp.path().join(".orgii").join("workspace-memory");
        std::fs::create_dir_all(&mem_dir).unwrap();
        std::fs::write(mem_dir.join("MEMORY.md"), "- [Prefs](prefs.md)").unwrap();

        let result = build_memory_prompt_section(tmp.path(), &[]);
        assert!(result.is_some());
        let section = result.unwrap();
        assert!(section.contains("# Workspace Memory"));
        assert!(section.contains("Memory Index"));
        assert!(!section.contains("Loaded Memories"));
    }

    #[test]
    fn test_select_memories_system_prompt() {
        assert!(SELECT_MEMORIES_SYSTEM_PROMPT.contains("selecting memories"));
        assert!(SELECT_MEMORIES_SYSTEM_PROMPT.contains("up to 5"));
        assert!(SELECT_MEMORIES_SYSTEM_PROMPT.contains("recently-used tools"));
    }

    #[test]
    fn test_extract_recent_tools_from_history() {
        let history = vec![
            serde_json::json!({"role":"assistant","content":"done"}),
            serde_json::json!({
                "role":"assistant",
                "content":"",
                "tool_calls":[
                    {"id":"1","function":{"name":"read_file","arguments":"{}"}},
                    {"id":"2","function":{"name":"apply_patch","arguments":"{}"}}
                ]
            }),
            serde_json::json!({"role":"tool","name":"read_file","content":"ok"}),
            serde_json::json!({"role":"tool","name":"shell","content":"ok"}),
        ];

        let tools = extract_recent_tools_from_history(&history);
        assert_eq!(
            tools,
            vec![
                "shell".to_string(),
                "read_file".to_string(),
                "apply_patch".to_string()
            ]
        );
    }

    #[test]
    fn test_extract_recent_tools_caps_and_deduplicates() {
        let mut history = Vec::new();
        for index in 0..20 {
            history.push(serde_json::json!({
                "role":"tool",
                "name": format!("tool_{index}"),
                "content":"ok"
            }));
        }
        history.push(serde_json::json!({"role":"tool","name":"tool_19","content":"ok"}));

        let tools = extract_recent_tools_from_history(&history);
        assert_eq!(tools.len(), MAX_RECENT_TOOLS);
        assert_eq!(tools.first().map(String::as_str), Some("tool_19"));
        assert_eq!(tools.last().map(String::as_str), Some("tool_10"));
    }

    #[test]
    fn test_parse_selected_filenames_json() {
        let result = parse_selected_filenames(
            r#"{"selected_memories":["workspace_arch.md","gotchas.md",""]}"#,
        );
        assert_eq!(
            result,
            vec!["workspace_arch.md".to_string(), "gotchas.md".to_string()]
        );
    }

    #[test]
    fn test_parse_selected_filenames_json_with_wrapping_text() {
        let result = parse_selected_filenames(
            "Here is the selection:\n{\"selected_memories\":[\"prefs.md\"]}\nDone.",
        );
        assert_eq!(result, vec!["prefs.md".to_string()]);
    }

    #[test]
    fn test_parse_selected_filenames_line_fallback() {
        let result = parse_selected_filenames("- api.md\n- notes.txt\nworkspace.md");
        assert_eq!(
            result,
            vec!["api.md".to_string(), "workspace.md".to_string()]
        );
    }

    #[test]
    fn test_freshness_included_in_memories() {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let mem = RelevantMemory {
            path: "/tmp/old.md".to_string(),
            mtime_ms: now_ms - 10 * 86_400_000, // 10 days ago
            content: "Old content".to_string(),
            freshness: super::super::memory_freshness_text(now_ms - 10 * 86_400_000),
        };

        assert!(mem.freshness.contains("10 days old"));
    }
}
