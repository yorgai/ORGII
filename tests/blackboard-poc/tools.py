"""
Tool definitions (Anthropic format) and async execution handlers.

Agent-as-Service model tools:
  - Blackboard tools: read, post_task, post_message, post_artifact, etc.
  - Memory tools: memory_recall (active), memory_annotate (supplemental)
  - File tools: write_file, read_file (scoped to agent's worktree)
  - Delegation: spawn_sub_agent (sync, limited tools)
  - Lifecycle: done, question
  - Auto-capture: write_file and post_artifact auto-record to repo memory
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from trajectory import trajectory as traj

if TYPE_CHECKING:
    from agent import Agent


# ── Tool Schemas (Anthropic format) ────────────────────────────────

TOOL_SCHEMAS = [
    {
        "name": "blackboard_read",
        "description": (
            "Read the current state of the shared blackboard. Returns compacted view by default "
            "(completed entries compressed, active entries full). All agents see all content. "
            "Use raw=true for full uncompacted content."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "section": {
                    "type": "string",
                    "enum": ["tasks", "artifacts", "messages", "decisions", "issues", "all"],
                    "description": "Which section to read. Use 'all' for complete blackboard state.",
                },
                "raw": {
                    "type": "boolean",
                    "description": "If true, returns full uncompacted content. Default: false.",
                },
            },
            "required": ["section"],
        },
    },
    {
        "name": "blackboard_post_message",
        "description": (
            "Post a message to the blackboard. Use to_agent for @mentions "
            "(e.g. 'frontend', 'backend', 'qa', 'lead', 'user'). "
            "Omit to_agent for broadcast. Use reply_to for threading."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "The message content."},
                "to_agent": {
                    "type": "string",
                    "description": "Target agent id. Use 'user' for human-in-the-loop. Omit for broadcast.",
                },
                "reply_to": {
                    "type": "string",
                    "description": "Message ID to reply to (for threading).",
                },
            },
            "required": ["content"],
        },
    },
    {
        "name": "blackboard_post_artifact",
        "description": (
            "Post a code artifact or document summary to the blackboard. "
            "Write the actual code to files using write_file first, then post "
            "a summary artifact here so other agents know what you built."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Name of the artifact (e.g. 'DarkMode.tsx')."},
                "content": {"type": "string", "description": "Summary of what the artifact does."},
                "file_path": {
                    "type": "string",
                    "description": "Relative file path in workspace (e.g. 'src/DarkMode.tsx').",
                },
                "related_task_id": {
                    "type": "string",
                    "description": "Task ID this artifact fulfills.",
                },
            },
            "required": ["title", "content"],
        },
    },
    {
        "name": "blackboard_post_task",
        "description": (
            "Create a new task and assign it to a team member. "
            "Only the Lead Architect should use this tool. "
            "Task ID is auto-generated. Use depends_on to specify task ordering — "
            "the dependent task will wait until its dependencies complete before starting."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Short task title."},
                "assigned_to": {
                    "type": "string",
                    "description": "Agent id to assign to: frontend, backend, or qa.",
                },
                "description": {"type": "string", "description": "Detailed task description."},
                "depends_on": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Task IDs that must complete before this task starts. Use to avoid file conflicts.",
                },
            },
            "required": ["title", "assigned_to", "description"],
        },
    },
    {
        "name": "blackboard_update_task",
        "description": "Update the status of a task on the blackboard.",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "The task id to update."},
                "status": {
                    "type": "string",
                    "enum": ["in_progress", "complete", "blocked", "parked"],
                    "description": "New status.",
                },
                "notes": {"type": "string", "description": "Optional notes about the update."},
            },
            "required": ["task_id", "status"],
        },
    },
    {
        "name": "blackboard_post_decision",
        "description": (
            "Record an architectural or technical decision on the blackboard. "
            "Other agents will see this and align their work accordingly."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Short title of the decision."},
                "rationale": {"type": "string", "description": "Why this decision was made."},
                "related_task_id": {"type": "string", "description": "Related task ID if applicable."},
            },
            "required": ["title", "rationale"],
        },
    },
    {
        "name": "blackboard_post_issue",
        "description": "Report a bug, edge case, or quality issue found during review.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Short issue title."},
                "description": {"type": "string", "description": "Detailed description of the issue."},
                "severity": {
                    "type": "string",
                    "enum": ["low", "medium", "high", "critical"],
                    "description": "Issue severity.",
                },
                "related_artifact_id": {
                    "type": "string",
                    "description": "ID of the artifact this issue relates to.",
                },
            },
            "required": ["title", "description", "severity"],
        },
    },
    {
        "name": "memory_recall",
        "description": (
            "Search the shared repo memory for past code actions and lessons. "
            "Passive recall (top-15 relevant entries) is already injected at session start — "
            "use this tool for deeper or more specific searches mid-session."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "What to search for (e.g. 'dark mode implementation').",
                },
                "files": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Filter by file path prefix (e.g. ['src/middleware/']).",
                },
                "limit": {"type": "number", "description": "Max entries to return. Default: 20."},
            },
            "required": ["query"],
        },
    },
    {
        "name": "memory_annotate",
        "description": (
            "Add supplemental context to repo memory. Code actions are auto-captured — "
            "use this to explain WHY you did something, record lessons, or add insights "
            "that auto-capture cannot infer."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "What was done and why."},
                "rationale": {"type": "string", "description": "Reasoning behind the action."},
                "citations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "file_path": {"type": "string"},
                            "symbol": {"type": "string", "description": "Function/class name."},
                        },
                        "required": ["file_path"],
                    },
                    "description": "Code locations this annotation refers to.",
                },
            },
            "required": ["summary", "citations"],
        },
    },
    {
        "name": "spawn_sub_agent",
        "description": (
            "Spawn an ephemeral sub-agent for bounded research or analysis. "
            "Blocks until the sub-agent completes and returns a summary. "
            "The sub-agent works in your same directory but has limited tools "
            "(no blackboard, no memory, no spawn)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Name for the sub-agent (e.g. 'researcher')."},
                "prompt": {"type": "string", "description": "Task description for the sub-agent."},
            },
            "required": ["name", "prompt"],
        },
    },
    {
        "name": "write_file",
        "description": "Write a file to your worktree. Auto-captured to repo memory.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative path (e.g. 'src/DarkMode.tsx')."},
                "content": {"type": "string", "description": "File content to write."},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "read_file",
        "description": "Read a file from your worktree.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative path in worktree."},
            },
            "required": ["path"],
        },
    },
    {
        "name": "question",
        "description": (
            "Ask the user a question. Posts a message to the blackboard with to_agent='user'. "
            "The user will see it and can reply."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "Your question for the user."},
            },
            "required": ["content"],
        },
    },
    {
        "name": "configure_team",
        "description": (
            "Declare which agents are needed for this work item. "
            "Agents not listed will be skipped — they receive no events, make no LLM calls, cost nothing. "
            "Lead is always active. Must be called BEFORE posting tasks. "
            "For low-complexity frontend-only features, skip backend and qa. "
            "For security-sensitive features, always include qa."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "agents_needed": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["frontend", "backend", "qa"]},
                    "description": "Which agents to activate. Lead is always active.",
                },
                "complexity": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],
                    "description": "low=1-2 files, medium=3-5 files, high=6+ files or security-sensitive.",
                },
                "rationale": {
                    "type": "string",
                    "description": "Why these agents were chosen and why others were skipped.",
                },
            },
            "required": ["agents_needed", "complexity", "rationale"],
        },
    },
    {
        "name": "done",
        "description": (
            "Signal that you have completed all your work for this work item. "
            "Provide a brief summary of what you accomplished."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "description": "Brief summary of your contributions."},
            },
            "required": ["summary"],
        },
    },
]

# Sub-agent tools: restricted set (no blackboard, no memory, no spawn, no done)
SUB_AGENT_TOOL_SCHEMAS = [
    schema for schema in TOOL_SCHEMAS
    if schema["name"] in ("write_file", "read_file")
]


# ── Tool Handlers ──────────────────────────────────────────────────

async def handle_blackboard_read(agent: Agent, section: str = "all", raw: bool = False) -> str:
    bb = agent.blackboard
    if section == "all":
        data = bb.read_all() if raw else bb.read_compacted()
    else:
        data = bb.read_section(section)
    return json.dumps(data, indent=2, default=str)


async def handle_blackboard_post_message(
    agent: Agent,
    content: str,
    to_agent: str | None = None,
    reply_to: str | None = None,
) -> str:
    agent.blackboard.post_message(agent.agent_id, content, to_agent, reply_to)

    # Track that we're expecting a reply from this agent
    if to_agent and to_agent not in ("user", agent.agent_id):
        agent._awaiting_reply_from.add(to_agent)

    target = f"@{to_agent}" if to_agent else "broadcast"
    return f"Message posted ({target}): {content[:80]}..."


async def handle_blackboard_post_artifact(
    agent: Agent,
    title: str,
    content: str,
    file_path: str | None = None,
    related_task_id: str | None = None,
) -> str:
    result = agent.blackboard.post_artifact(
        agent.agent_id, title, content, file_path, related_task_id
    )

    if file_path:
        thinking = getattr(agent, "_current_thinking", "")
        if thinking:
            summary = f"Artifact '{title}' ({file_path}): {thinking[:200]}"
        else:
            summary = f"Artifact '{title}': {content[:150]}"

        agent.repo_memory.auto_capture(
            summary=summary,
            file_path=file_path,
            source_agent=agent.agent_id,
            action_type="auto_capture",
            importance=6.0,
        )

    return f"Artifact posted: '{title}' (id: {result['id']})"


async def handle_blackboard_post_task(
    agent: Agent,
    title: str,
    assigned_to: str,
    description: str,
    depends_on: list[str] | None = None,
) -> str:
    result = agent.blackboard.post_task(
        agent.agent_id, title, assigned_to, description, depends_on
    )
    dep_info = f" (depends_on: {depends_on})" if depends_on else ""
    return f"Task created: {result['id']} '{title}' -> @{assigned_to}{dep_info}"


async def handle_blackboard_update_task(
    agent: Agent, task_id: str, status: str, notes: str | None = None
) -> str:
    result = agent.blackboard.update_task(agent.agent_id, task_id, status, notes)
    if result is None:
        return f"Error: task '{task_id}' not found"

    # On task complete: immediately commit + merge so dependents can start
    if status == "complete":
        merge_result = await agent.commit_and_merge()
        if merge_result.success and merge_result.message != "no changes to commit":
            traj.log(agent.agent_id, "merge", f"task {task_id} complete → {merge_result.message}")
            return f"Task {task_id} complete. Code committed and merged to main."
        elif not merge_result.success and merge_result.conflict:
            traj.log(agent.agent_id, "conflict",
                     f"task {task_id} merge conflict: {merge_result.conflict.conflicted_files}")
            resolved = await agent._handle_conflict_resolution(merge_result)
            if resolved:
                return f"Task {task_id} complete. Merge conflict resolved and merged to main."
            return f"Task {task_id} complete. Warning: merge conflict unresolved — code on agent branch only."

    return f"Task {task_id} updated to '{status}'"


async def handle_blackboard_post_decision(
    agent: Agent, title: str, rationale: str, related_task_id: str | None = None
) -> str:
    result = agent.blackboard.post_decision(agent.agent_id, title, rationale, related_task_id)

    # Auto-capture decisions to repo memory
    agent.repo_memory.auto_capture(
        summary=f"Decision: {title} — {rationale[:100]}",
        file_path="(decision)",
        source_agent=agent.agent_id,
        action_type="decision",
        importance=8.0,
    )

    return f"Decision recorded: '{title}' (id: {result['id']})"


async def handle_blackboard_post_issue(
    agent: Agent,
    title: str,
    description: str,
    severity: str,
    related_artifact_id: str | None = None,
) -> str:
    agent.blackboard.post_issue(
        agent.agent_id, title, description, severity, related_artifact_id
    )
    return f"Issue posted [{severity}]: '{title}'"


async def handle_memory_recall(
    agent: Agent,
    query: str,
    files: list[str] | None = None,
    limit: int = 20,
) -> str:
    results = agent.repo_memory.active_recall(query, files, limit)
    if not results:
        return "No relevant memories found."
    lines = [f"  - [{e.action_type}:{e.source_agent}] {e.summary}" for e in results]
    return f"Recalled {len(results)} entries:\n" + "\n".join(lines)


async def handle_memory_annotate(
    agent: Agent,
    summary: str,
    citations: list[dict],
    rationale: str | None = None,
) -> str:
    entry = agent.repo_memory.annotate(summary, rationale, citations, agent.agent_id)
    return f"Memory annotated: {entry.entry_id} — {summary[:80]}"


async def handle_spawn_sub_agent(agent: Agent, name: str, prompt: str) -> str:
    result = await agent.spawn_sub_agent(name, prompt)
    return f"Sub-agent '{name}' result: {result}"


async def handle_write_file(agent: Agent, path: str, content: str) -> str:
    target_path = agent.worktree_path / path
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(content)

    lines = content.count("\n") + 1
    thinking = getattr(agent, "_current_thinking", "")
    if thinking:
        summary = f"{path}: {thinking[:200]}"
    else:
        summary = f"Wrote {path} ({lines} lines)"

    agent.repo_memory.auto_capture(
        summary=summary,
        file_path=path,
        source_agent=agent.agent_id,
        action_type="auto_capture",
        importance=5.0,
    )

    return f"File written: {path} ({lines} lines)"


async def handle_read_file(agent: Agent, path: str) -> str:
    target_path = agent.worktree_path / path
    if not target_path.exists():
        # Re-rebase to pick up recently merged code from other agents
        await agent.rebase_worktree()
        target_path = agent.worktree_path / path
        if not target_path.exists():
            return f"Error: file '{path}' not found in worktree (even after rebase)"
    return target_path.read_text()


async def handle_question(agent: Agent, content: str) -> str:
    agent.blackboard.post_message(agent.agent_id, f"[QUESTION] {content}", to_agent="user")
    return f"Question posted to user: {content[:80]}..."


async def handle_configure_team(
    agent: Agent, agents_needed: list[str], complexity: str, rationale: str
) -> str:
    skipped = agent.blackboard.configure_active_agents(agents_needed, complexity, rationale)
    active = ["lead"] + agents_needed
    traj.log(agent.agent_id, "team_config",
             f"active={active}, skipped={skipped}, complexity={complexity}")
    if skipped:
        return f"Team configured: active={active}, skipped={skipped}. Skipped agents will not receive events."
    return f"Team configured: active={active} (full team, no agents skipped)."


async def handle_done(agent: Agent, summary: str) -> str:
    incomplete = [
        t for t in agent.blackboard.tasks
        if t["assigned_to"] == agent.agent_id and t["status"] in ("pending", "in_progress")
    ]
    if incomplete:
        task_list = ", ".join(f"{t['id']} ({t['title']})" for t in incomplete)
        traj.log(agent.agent_id, "tool_call", f"done REJECTED: {len(incomplete)} incomplete tasks")
        return (
            f"Cannot mark as done — you have {len(incomplete)} incomplete task(s): {task_list}. "
            "Please complete or update these tasks first, then call done again."
        )

    agent.blackboard.mark_agent_done(agent.agent_id, summary)
    agent.state = agent.state.__class__("done")
    traj.log(agent.agent_id, "done", summary[:120])
    return f"Marked as done: {summary}"


TOOL_HANDLERS = {
    "blackboard_read": handle_blackboard_read,
    "blackboard_post_message": handle_blackboard_post_message,
    "blackboard_post_artifact": handle_blackboard_post_artifact,
    "blackboard_post_task": handle_blackboard_post_task,
    "blackboard_update_task": handle_blackboard_update_task,
    "blackboard_post_decision": handle_blackboard_post_decision,
    "blackboard_post_issue": handle_blackboard_post_issue,
    "memory_recall": handle_memory_recall,
    "memory_annotate": handle_memory_annotate,
    "spawn_sub_agent": handle_spawn_sub_agent,
    "write_file": handle_write_file,
    "read_file": handle_read_file,
    "question": handle_question,
    "configure_team": handle_configure_team,
    "done": handle_done,
}
