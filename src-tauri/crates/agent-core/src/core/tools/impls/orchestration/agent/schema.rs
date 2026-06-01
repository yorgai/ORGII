//! Static `description` / dynamic `llm_description` / JSON `parameters`
//! schema for the `agent` tool.
//!
//! Extracted from `mod.rs` to keep the dispatcher (`execute_text`) and the
//! tool surface (description + schema) physically separate. This file is
//! pure data-as-code — no runtime side effects beyond reading the
//! `AgentDefinitionsStore` snapshot for the dynamic agent list.

use serde_json::{json, Value};

use crate::definitions::builtin::{get_builtin_agents, EXPLORE_AGENT_ID, GENERAL_AGENT_ID};
use crate::definitions::{AgentDefinitionsStore, AgentTier};

/// Static description shown to humans (e.g. tool inspector).
pub(super) const DESCRIPTION: &str =
    "Launch or kill a Delegate or Shadow worker.\n\n\
     Two launch modes:\n\
     - `delegate` (default) — invoke a different Agent by `agent_id` (builtin or custom).\n\
     - `shadow` — clone the current Agent's setup (tools, policy, model) for a parallel self-copy task.\n\n\
     Set `background: true` to run the worker in the background and get a handle back \
     immediately. Use `await_output(handle=...)` to check on it later.\n\n\
     Kill mode: set `command: \"kill\"` with `handle` to abort a background worker.\n\n\
     Built-in Agent targets (for delegate mode):\n\
     - `builtin:explore` — Fast, read-only codebase search.\n\
     - `builtin:general` — Full tool access for complex multi-step tasks.\n\n\
     The worker runs in its own context and returns a single text response.";

/// Walk the same builtin + custom agent registry that `llm_description`
/// surfaces and return just the list of `agent_id`s the LLM would see
/// for this allowlist. Used by `debug_session_subagent_snapshot` to
/// assert L4→L5 fidelity without parsing the human-readable description.
///
/// Tier semantics:
///   - Runtime primitives (`builtin:explore`, `builtin:general`)
///     surface for every parent regardless of `allowed_subagents`. The
///     frontend intentionally filters them out of user pickers, so their
///     availability cannot depend on UI-managed lists.
///   - Primary builtins (`builtin:os`, `builtin:sde`, `builtin:wingman`)
///     are session-root personas; they do NOT surface by default to
///     avoid every agent advertising "delegate to OS" out of the box.
///     They surface ONLY when the parent's `sub_agents` list explicitly
///     contains the id — which is exactly how `builtin:os` ships with
///     `builtin:sde` in its allowlist (see `builtin/os.rs`). This makes
///     Primary-as-sub-agent an opt-in, allowlist-gated configuration
///     instead of a blanket exclusion. The `delegationConfig.delegatable`
///     flag is still honored for both tiers.
pub fn llm_visible_agent_ids(allowed_subagents: Option<&Vec<String>>) -> Vec<String> {
    let mut ids = Vec::new();

    for agent in get_builtin_agents() {
        let delegatable = agent
            .delegation_config
            .as_ref()
            .map(|dc| dc.delegatable)
            .unwrap_or(true);
        if !delegatable {
            continue;
        }
        let is_runtime_primitive = agent.id == EXPLORE_AGENT_ID || agent.id == GENERAL_AGENT_ID;
        if is_runtime_primitive {
            ids.push(agent.id.clone());
            continue;
        }
        if agent.tier == AgentTier::Primary {
            // Primary builtins must be explicitly allowlisted.
            match allowed_subagents {
                Some(list) if list.iter().any(|id| id == &agent.id) => {}
                _ => continue,
            }
        } else if let Some(list) = allowed_subagents {
            if !list.iter().any(|id| id == &agent.id) {
                continue;
            }
        }
        ids.push(agent.id.clone());
    }

    let store = AgentDefinitionsStore::new();
    if let Ok(custom_agents) = store.agents.lock() {
        for agent in custom_agents.iter() {
            let delegatable = agent
                .delegation_config
                .as_ref()
                .map(|dc| dc.delegatable)
                .unwrap_or(true);
            if !delegatable {
                continue;
            }
            if let Some(list) = allowed_subagents {
                if !list.iter().any(|id| id == &agent.id) {
                    continue;
                }
            }
            ids.push(agent.id.clone());
        }
    }

    ids
}

/// Build the dynamic LLM-facing description, gated on the parent's
/// allowlist (the `sub_agents` field of the parent `AgentDefinition`).
///
/// Returns `None` when no agent is delegatable for this caller (e.g. the
/// allowlist is empty), which signals the trait layer to fall back to
/// `description()`.
pub(super) fn llm_description(allowed_subagents: Option<&Vec<String>>) -> Option<String> {
    let mut agent_lines = Vec::new();

    // Builtin delegatable agents. Runtime primitives (`explore` / `general`)
    // always surface; Primary builtins (`os` / `sde` / `wingman`) only surface
    // when the parent's allowlist explicitly names them.
    for agent in get_builtin_agents() {
        let delegatable = agent
            .delegation_config
            .as_ref()
            .map(|dc| dc.delegatable)
            .unwrap_or(true);
        if !delegatable {
            continue;
        }
        let is_runtime_primitive = agent.id == EXPLORE_AGENT_ID || agent.id == GENERAL_AGENT_ID;
        if !is_runtime_primitive {
            if agent.tier == AgentTier::Primary {
                match allowed_subagents {
                    Some(list) if list.iter().any(|id| id == &agent.id) => {}
                    _ => continue,
                }
            } else if let Some(list) = allowed_subagents {
                if !list.iter().any(|id| id == &agent.id) {
                    continue;
                }
            }
        }
        let desc = agent.description.as_deref().unwrap_or(&agent.name);
        agent_lines.push(format!("- `{}` — {}", agent.id, desc));
    }

    // Custom agents from the store (snapshot under lock).
    let store = AgentDefinitionsStore::new();
    if let Ok(custom_agents) = store.agents.lock() {
        for agent in custom_agents.iter() {
            let delegatable = agent
                .delegation_config
                .as_ref()
                .map(|dc| dc.delegatable)
                .unwrap_or(true);
            if !delegatable {
                continue;
            }
            if let Some(list) = allowed_subagents {
                if !list.iter().any(|id| id == &agent.id) {
                    continue;
                }
            }
            let desc = agent.description.as_deref().unwrap_or(&agent.name);
            agent_lines.push(format!("- `{}` — {}", agent.id, desc));
        }
    }

    if agent_lines.is_empty() {
        return None;
    }

    let agent_list = agent_lines.join("\n");
    Some(format!(
        "Launch or kill a Delegate or Shadow worker.\n\n\
         Launch modes (command='launch' or omit):\n\
         - `delegate` (default) — invoke a named agent. Pass `agent_id` to pick the specialist; \
           when omitted, defaults to `builtin:general`.\n\
         - `shadow` — clone current agent's setup for a parallel subtask. No `agent_id` needed.\n\n\
         For large, parallelizable work, research first, then decompose into independent units. \
         Prefer 5-30 units when the change is genuinely broad; keep smaller tasks to fewer agents. \
         Each unit should be self-contained, mergeable without sibling results, and roughly uniform in size. \
         Launch background Delegate/Shadow workers in the same assistant message when possible so independent work starts together. \
         The parent agent's max tool-use concurrency setting is the hard runtime cap, so excess parallel calls are queued.\n\n\
         Each worker prompt must be fully self-contained: include the overall goal, that unit's exact scope, \
         relevant codebase conventions, expected verification steps, and the required final summary format. \
         Ask the user for an end-to-end verification path before spawning workers if the correct path is unclear.\n\n\
         Set `background: true` to run in background and return a handle immediately.\n\
         Use `await_output(handle=...)` to monitor progress.\n\
         To resume a previous background worker, pass the handle you got back as \
         `resume_session_id` — never invent one.\n\n\
         Set `isolation: \"worktree\"` to run the worker in a temporary git worktree, \
         giving it an isolated copy of the repository.\n\n\
         Kill mode: agent(command=\"kill\", handle=\"<session_id>\") to abort a background worker.\n\n\
         Available agent types (delegate mode):\n\
         {agent_list}\n\n\
         Set fork: true to share parent conversation context (for summarization, memory extraction)."
    ))
}

/// JSON Schema for the tool's `parameters` field.
pub(super) fn parameters() -> Value {
    json!({
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "enum": ["launch", "kill"],
                "description": "Action to perform. 'launch' (default): create and run a Delegate or Shadow worker. \
                'kill': abort a running background worker by its handle."
            },
            "handle": {
                "type": "string",
                "description": "Session ID of the background Delegate or Shadow worker to kill (required when command='kill')."
            },
            "mode": {
                "type": "string",
                "enum": ["delegate", "shadow"],
                "description": "Dispatch mode. 'delegate': invoke a named agent (requires agent_id). \
                'shadow': clone current agent's setup for parallel subtask. Default: 'delegate'."
            },
            "agent_id": {
                "type": "string",
                "description": "Agent to invoke (delegate mode). Built-in: 'builtin:explore' \
                (fast read-only search), 'builtin:general' (full tool access, default). \
                Or any custom agent ID. Default when omitted: 'builtin:general'. Prefer \
                supplying an explicit agent_id so the right specialist is picked (e.g. \
                'builtin:explore' for codebase searches)."
            },
            "prompt": {
                "type": "string",
                "description": "Detailed task description with all context the Delegate or Shadow worker needs"
            },
            "description": {
                "type": "string",
                "description": "Short (3-5 word) label for this Delegate or Shadow invocation"
            },
            "model": {
                "type": "string",
                "description": "Optional model override: 'fast' for cheaper/faster model. Defaults to parent model."
            },
            "background": {
                "type": "boolean",
                "description": "When true, run the worker in background and return a handle immediately. \
                Use await_output(handle=...) to monitor progress. Default: false."
            },
            "isolation": {
                "type": "string",
                "enum": ["worktree"],
                "description": "Optional isolation mode. Set to 'worktree' to run the worker in a temporary git worktree with an isolated copy of the repository."
            },
            "fork": {
                "type": "boolean",
                "description": "When true, the worker inherits the parent conversation as context prefix. \
                Enables prompt cache sharing. Use for tasks that need full parent context \
                (e.g., memory extraction, summarization). Default: false."
            },
            "resume_session_id": {
                "type": "string",
                "description": "Resume a previous Delegate or Shadow worker session by its handle. \
                ONLY pass a value that was returned by an earlier `agent(..., background: true)` \
                call — do NOT fabricate or infer this id. The shape is \
                '<prefix>-<agent_id>-<uuid>' (e.g. 'agent-builtin:general-<uuid>'); \
                invalid shapes are rejected. Omit this field entirely to start a fresh worker. \
                When provided, the worker loads its persisted history and the `prompt` becomes \
                an additional follow-up message."
            }
        },
        "required": ["prompt"]
    })
}
