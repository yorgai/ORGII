"""
Agent Service: persistent async actor with ephemeral sessions.

Agent-as-Service model:
  - Agent is a persistent service (identity + memory + mailbox + state)
  - Each reaction to a blackboard event creates a FRESH LLM session
  - Shared repo memory + compacted blackboard replace conversation history
  - No token accumulation across reactions
  - "Continue" session only for direct replies/follow-ups within timeout
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional

from anthropic import AsyncAnthropic

from blackboard import Blackboard, BlackboardEvent, EventType
from memory import RepoMemory
from worktree import WorktreeManager, MergeResult
from tools import TOOL_SCHEMAS, TOOL_HANDLERS, SUB_AGENT_TOOL_SCHEMAS
from trajectory import trajectory as traj
from config import (
    ANTHROPIC_API_KEY,
    ANTHROPIC_BASE_URL,
    MODEL,
    MAX_TOKENS,
    MAX_LLM_ITERATIONS_PER_REACTION,
    PASSIVE_RECALL_LIMIT,
    RELEVANCE_CHECK_TIMEOUT,
    SESSION_CONTINUE_TIMEOUT,
    MESSAGE_COOLDOWN,
    CONTEXT_WINDOW_LIMIT,
    MAX_CONFLICT_RETRIES,
)


class AgentState(str, Enum):
    IDLE = "idle"
    WORKING = "working"
    DONE = "done"


@dataclass
class ReactionMetrics:
    agent_id: str
    reaction_index: int
    event_types: list[str]
    session_type: str  # "fresh" | "continue" | "reflection" | "conflict_resolution"
    start_time: float
    end_time: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    llm_calls: int = 0
    tools_called: list[str] = field(default_factory=list)
    files_written: list[str] = field(default_factory=list)
    conflict_encountered: bool = False
    conflict_resolved: bool = False
    passive_recall_count: int = 0

    def to_dict(self) -> dict:
        return {
            "agent_id": self.agent_id,
            "reaction_index": self.reaction_index,
            "event_types": self.event_types,
            "session_type": self.session_type,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "duration_seconds": round(self.end_time - self.start_time, 2) if self.end_time else 0,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.input_tokens + self.output_tokens,
            "llm_calls": self.llm_calls,
            "tools_called": self.tools_called,
            "files_written": self.files_written,
            "conflict_encountered": self.conflict_encountered,
            "conflict_resolved": self.conflict_resolved,
            "passive_recall_count": self.passive_recall_count,
        }


def _log(agent_id: str, msg: str) -> None:
    tag = f"[{agent_id:<10}]"
    print(f"{tag} {msg}", flush=True)


class Agent:
    def __init__(
        self,
        agent_id: str,
        role: str,
        system_prompt: str,
        subscribes: list[str],
        blackboard: Blackboard,
        repo_memory: RepoMemory,
        worktree_path: Path,
        worktree_mgr: WorktreeManager,
    ):
        self.agent_id = agent_id
        self.role = role
        self.system_prompt = system_prompt
        self.subscribes = subscribes
        self.blackboard = blackboard
        self.repo_memory = repo_memory
        self.worktree_path = worktree_path
        self.worktree_mgr = worktree_mgr
        self.mailbox: asyncio.Queue[BlackboardEvent] = blackboard.subscribe(agent_id)

        self.state = AgentState.IDLE
        self._shutdown = False
        self._reaction_count = 0
        self._llm_call_count = 0
        self._total_input_tokens = 0
        self._total_output_tokens = 0

        # Session continuation tracking
        self._active_session: Optional[dict] = None
        self._last_message_times: dict[str, float] = {}
        self._awaiting_reply_from: set[str] = set()  # agent IDs we sent @mentions to in current session

        # Per-reaction metrics tracking
        self.reaction_log: list[ReactionMetrics] = []
        self._current_metrics: Optional[ReactionMetrics] = None
        self._current_thinking: str = ""  # LLM text before tool calls, used by auto-capture

        client_kwargs: dict = {"api_key": ANTHROPIC_API_KEY}
        if ANTHROPIC_BASE_URL:
            client_kwargs["base_url"] = ANTHROPIC_BASE_URL
        self._client = AsyncAnthropic(**client_kwargs)

    # ── Lifecycle ─────────────────────────────────────────────────

    def reset_for_new_work_item(self) -> None:
        self.state = AgentState.IDLE
        self._reaction_count = 0
        self._llm_call_count = 0
        self._total_input_tokens = 0
        self._total_output_tokens = 0
        self._active_session = None
        self._last_message_times.clear()
        self._awaiting_reply_from.clear()
        self._all_done_revived = False
        self.reaction_log.clear()
        self._current_metrics = None

    def shutdown(self) -> None:
        self._shutdown = True

    @property
    def token_usage(self) -> int:
        return self._total_input_tokens + self._total_output_tokens

    def get_agent_metrics(self) -> dict:
        """Aggregate metrics for this agent across all reactions in the current work item."""
        return {
            "reactions": len(self.reaction_log),
            "llm_calls": self._llm_call_count,
            "input_tokens": self._total_input_tokens,
            "output_tokens": self._total_output_tokens,
            "total_tokens": self.token_usage,
            "files_written": list({
                fp for rm in self.reaction_log for fp in rm.files_written
            }),
            "conflicts_encountered": sum(1 for rm in self.reaction_log if rm.conflict_encountered),
            "conflicts_resolved": sum(1 for rm in self.reaction_log if rm.conflict_resolved),
            "reaction_log": [rm.to_dict() for rm in self.reaction_log],
        }

    # ── Relevance Check ───────────────────────────────────────────

    def _has_pending_deferred_tasks(self) -> bool:
        """Check if this agent has tasks with unmet dependencies."""
        for task in self.blackboard.tasks:
            if (task["assigned_to"] == self.agent_id
                    and task["status"] == "pending"
                    and task.get("depends_on")
                    and not self.blackboard.are_dependencies_met(task["id"])):
                return True
        return False

    def _is_relevant(self, event: BlackboardEvent) -> bool:
        if event.event_type in (EventType.WORK_ITEM_COMPLETE, EventType.BUDGET_EXHAUSTED):
            return True

        if event.event_type == EventType.ALL_DONE and self.agent_id == "lead":
            return True

        # If agent has deferred tasks, only react to task_complete (dep resolution)
        # and direct issues — ignore broadcasts, artifacts, and messages to avoid
        # starting work before dependencies are met
        if self._has_pending_deferred_tasks():
            if event.event_type not in (EventType.TASK_COMPLETE, EventType.NEW_ISSUE):
                return False

        # When a task completes, check if this agent has pending tasks whose deps are now met
        if event.event_type == EventType.TASK_COMPLETE:
            completed_task_id = event.entry.get("id", "")
            for task in self.blackboard.tasks:
                if (task["assigned_to"] == self.agent_id
                        and task["status"] == "pending"
                        and completed_task_id in task.get("depends_on", [])
                        and self.blackboard.are_dependencies_met(task["id"])):
                    return True

        for pattern in self.subscribes:
            if pattern == event.event_type.value:
                return True

            if pattern.startswith("task:") and event.event_type == EventType.NEW_TASK:
                target_role = pattern.split(":", 1)[1]
                if event.entry.get("assigned_to") == target_role:
                    # If task has unmet dependencies, defer — agent will be notified via task_complete
                    deps = event.entry.get("depends_on", [])
                    if deps and not self.blackboard.are_dependencies_met(event.entry.get("id", "")):
                        _log(self.agent_id, f"task {event.entry.get('id')} deferred — waiting on {deps}")
                        return False
                    return True

            if pattern.startswith("message:@") and event.event_type == EventType.NEW_MESSAGE:
                target_agent = pattern.split("@", 1)[1]
                to_agent = event.entry.get("to_agent", "")
                content = event.entry.get("content", "")
                if to_agent == target_agent or f"@{target_agent}" in content:
                    return True

            if pattern.startswith("issue:") and event.event_type == EventType.NEW_ISSUE:
                target_role = pattern.split(":", 1)[1]
                related_art = event.entry.get("related_artifact_id", "")
                for art in self.blackboard.artifacts:
                    if art["id"] == related_art and art["agent_id"] == target_role:
                        return True
                if event.entry.get("agent_id") != self.agent_id:
                    return True

            if pattern == "artifact" and event.event_type == EventType.NEW_ARTIFACT:
                return True

            if pattern == "issue" and event.event_type == EventType.NEW_ISSUE:
                return True

            if pattern == "task_complete" and event.event_type == EventType.TASK_COMPLETE:
                return True

        return False

    # ── Cooldown Check ────────────────────────────────────────────

    def _check_cooldown(self, event: BlackboardEvent) -> bool:
        if event.event_type != EventType.NEW_MESSAGE:
            return True
        sender = event.entry.get("from_agent", "")
        now = time.time()
        last_time = self._last_message_times.get(sender, 0)
        if now - last_time < MESSAGE_COOLDOWN:
            _log(self.agent_id, f"cooldown: skipping message from {sender}")
            return False
        self._last_message_times[sender] = now
        return True

    # ── Session Strategy ──────────────────────────────────────────

    def _should_continue(self, events: list[BlackboardEvent]) -> bool:
        """Continue existing session instead of creating fresh one.

        Triggers:
        - Reply to our message (explicit reply_to)
        - Message from an agent we recently @mentioned (awaiting reply)
        - Issue on our artifact
        """
        if self._active_session is None:
            return False
        session_age = time.time() - self._active_session["timestamp"]
        if session_age > SESSION_CONTINUE_TIMEOUT:
            return False

        for event in events:
            if event.event_type == EventType.NEW_MESSAGE:
                sender = event.entry.get("from_agent", "")

                # Explicit reply_to threading
                reply_to = event.entry.get("reply_to")
                if reply_to:
                    for msg in self.blackboard.messages:
                        if msg["id"] == reply_to and msg["from_agent"] == self.agent_id:
                            return True

                # Message from someone we @mentioned — treat as reply to our question
                if sender in self._awaiting_reply_from:
                    to_us = event.entry.get("to_agent", "") == self.agent_id
                    mentions_us = f"@{self.agent_id}" in event.entry.get("content", "")
                    if to_us or mentions_us:
                        return True

            if event.event_type == EventType.NEW_ISSUE:
                related_art = event.entry.get("related_artifact_id")
                if related_art:
                    for art in self.blackboard.artifacts:
                        if art["id"] == related_art and art["agent_id"] == self.agent_id:
                            return True

        return False

    # ── Revive Check ────────────────────────────────────────────

    def _should_revive(self, event: BlackboardEvent) -> bool:
        """Can this event wake up an agent that already called done?

        Strict rules to minimize wasted reactions:
        - Issues on own artifacts → always revive (must fix your bugs)
        - Dependency-met tasks → always revive (deferred work now unblocked)
        - Lead on all_done → revive for final review (once, not per task_complete)
        - Everything else (broadcasts, @mentions, task_complete) → stay done
        """

        # Issues on this agent's artifacts → must fix
        if event.event_type == EventType.NEW_ISSUE:
            related_art = event.entry.get("related_artifact_id", "")
            for art in self.blackboard.artifacts:
                if art["id"] == related_art and art["agent_id"] == self.agent_id:
                    return True

        # Lead revives on first all_done for final review — but only once
        if event.event_type == EventType.ALL_DONE and self.agent_id == "lead":
            if not getattr(self, "_all_done_revived", False):
                self._all_done_revived = True
                return True

        # Dependency-met tasks revive the assigned agent
        if event.event_type == EventType.TASK_COMPLETE:
            completed_task_id = event.entry.get("id", "")
            for task in self.blackboard.tasks:
                if (task["assigned_to"] == self.agent_id
                        and task["status"] == "pending"
                        and completed_task_id in task.get("depends_on", [])
                        and self.blackboard.are_dependencies_met(task["id"])):
                    return True

        return False

    # ── Main Event Loop ───────────────────────────────────────────

    async def run_forever(self) -> None:
        _log(self.agent_id, f"started (worktree: {self.worktree_path.name})")
        while not self._shutdown:
            try:
                event = await asyncio.wait_for(self.mailbox.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            if event.event_type == EventType.WORK_ITEM_COMPLETE:
                await self._reflect()
                self.state = AgentState.IDLE
                continue

            if event.event_type == EventType.BUDGET_EXHAUSTED:
                _log(self.agent_id, "budget exhausted — finishing current work, no new reactions")
                self.state = AgentState.DONE
                continue

            if self.state == AgentState.DONE:
                if self._should_revive(event):
                    _log(self.agent_id, f"revived by {event.event_type.value}")
                    traj.log(self.agent_id, "revive", f"by {event.event_type.value}")
                    self.state = AgentState.IDLE
                    self.blackboard._done_agents.discard(self.agent_id)
                    self.blackboard._all_done_emitted = False
                else:
                    continue

            if not self._is_relevant(event):
                continue

            if not self._check_cooldown(event):
                continue

            if self.blackboard.is_budget_exhausted():
                _log(self.agent_id, "budget exhausted, skipping reaction")
                continue

            # Batch events within a short window
            batched = [event]
            await asyncio.sleep(RELEVANCE_CHECK_TIMEOUT)
            while not self.mailbox.empty():
                try:
                    extra = self.mailbox.get_nowait()
                    if extra.event_type in (EventType.WORK_ITEM_COMPLETE, EventType.BUDGET_EXHAUSTED):
                        batched.append(extra)
                    elif self._is_relevant(extra) and self._check_cooldown(extra):
                        batched.append(extra)
                except asyncio.QueueEmpty:
                    break

            # Check for system events in batch
            for evt in batched:
                if evt.event_type == EventType.WORK_ITEM_COMPLETE:
                    await self._reflect()
                    self.state = AgentState.IDLE
                    break
                if evt.event_type == EventType.BUDGET_EXHAUSTED:
                    self.state = AgentState.DONE
                    break
            else:
                self.state = AgentState.WORKING
                event_names = ", ".join(e.event_type.value for e in batched)
                _log(self.agent_id, f"reacting to: {event_names}")

                # Rebase worktree on main to see latest code
                rebase_result = await self.rebase_worktree()
                if not rebase_result.success and rebase_result.conflict:
                    traj.log(self.agent_id, "conflict",
                             f"rebase conflict: {rebase_result.conflict.conflicted_files}")
                    await self._handle_conflict_resolution(rebase_result)

                await self._react(batched)
                self._reaction_count += 1
                if self.state != AgentState.DONE:
                    self.state = AgentState.IDLE

    # ── Worktree (real git operations) ──────────────────────────

    async def rebase_worktree(self) -> MergeResult:
        result = await self.worktree_mgr.rebase_on_main(self.agent_id)
        if not result.success and result.conflict:
            _log(self.agent_id, f"rebase conflict: {result.conflict.conflicted_files}")
        return result

    async def commit_and_merge(self) -> MergeResult:
        has_changes = await self.worktree_mgr.has_changes(self.agent_id)
        if not has_changes:
            return MergeResult(success=True, message="no changes to commit")

        await self.worktree_mgr.commit(
            self.agent_id,
            f"agent/{self.agent_id}: work on {self.blackboard.work_item_title}",
        )

        result = await self.worktree_mgr.merge_to_main(self.agent_id)

        if result.success:
            _log(self.agent_id, "committed + merged to main")
        elif result.conflict:
            _log(self.agent_id, f"merge CONFLICT in: {result.conflict.conflicted_files}")

        return result

    async def _handle_conflict_resolution(self, conflict_result: MergeResult) -> bool:
        conflict = conflict_result.conflict
        if not conflict:
            return False

        metrics = ReactionMetrics(
            agent_id=self.agent_id,
            reaction_index=len(self.reaction_log),
            event_types=["merge_conflict"],
            session_type="conflict_resolution",
            start_time=time.time(),
            conflict_encountered=True,
        )
        prev_in = self._total_input_tokens
        prev_out = self._total_output_tokens
        prev_calls = self._llm_call_count
        self._current_metrics = metrics

        resolved = False
        for attempt in range(MAX_CONFLICT_RETRIES):
            _log(self.agent_id, f"resolving conflict (attempt {attempt + 1}/{MAX_CONFLICT_RETRIES})")

            conflict_desc = "\n\n".join(
                f"=== {path} ===\n{content}"
                for path, content in conflict.conflict_markers.items()
            )

            conversation = [{
                "role": "user",
                "content": (
                    "MERGE CONFLICT: Your rebase on main has conflicts. "
                    "Resolve them by editing the conflicted files to remove ALL conflict markers "
                    "(<<<<<<< HEAD, =======, >>>>>>> lines). "
                    "Keep the correct combined content.\n\n"
                    f"Conflicted files:\n{conflict_desc}\n\n"
                    "Use write_file to write the resolved content for each conflicted file. "
                    "Make sure there are NO conflict markers left in the files."
                ),
            }]

            await self._llm_tool_loop(conversation)

            mark_ok = await self.worktree_mgr.mark_conflicts_resolved(self.agent_id)
            if mark_ok:
                merge_result = await self.worktree_mgr.merge_to_main(self.agent_id)
                if merge_result.success:
                    _log(self.agent_id, "conflict resolved, merged to main")
                    resolved = True
                    break
                if merge_result.conflict:
                    conflict = merge_result.conflict
                    continue

            await self.worktree_mgr.abort_rebase(self.agent_id)

        if not resolved:
            _log(self.agent_id, "could not resolve conflict, notifying Lead")
            self.blackboard.post_message(
                self.agent_id,
                f"Merge conflict I can't resolve in: {conflict.conflicted_files}",
                to_agent="lead",
            )

        metrics.conflict_resolved = resolved
        metrics.end_time = time.time()
        metrics.input_tokens = self._total_input_tokens - prev_in
        metrics.output_tokens = self._total_output_tokens - prev_out
        metrics.llm_calls = self._llm_call_count - prev_calls
        self.reaction_log.append(metrics)
        self._current_metrics = None
        return resolved

    # ── LLM Interaction ───────────────────────────────────────────

    async def _react(self, events: list[BlackboardEvent]) -> None:
        event_descriptions = []
        for evt in events:
            event_descriptions.append(
                f"[{evt.event_type.value}] from={evt.author} | {_summarize_entry(evt.entry)}"
            )

        event_text = "\n".join(event_descriptions)
        use_continue = self._should_continue(events)
        session_type = "continue" if use_continue else "fresh"

        event_names = ", ".join(e.event_type.value for e in events)
        traj.log(self.agent_id, "reaction_start", "",
                 session_type=session_type, events=event_names)

        metrics = ReactionMetrics(
            agent_id=self.agent_id,
            reaction_index=len(self.reaction_log),
            event_types=[e.event_type.value for e in events],
            session_type=session_type,
            start_time=time.time(),
        )
        prev_in = self._total_input_tokens
        prev_out = self._total_output_tokens
        prev_calls = self._llm_call_count
        self._current_metrics = metrics

        if use_continue and self._active_session is not None:
            _log(self.agent_id, "continuing existing session")
            traj.log(self.agent_id, "tool_call", "session continued (reply received)")
            conversation = self._active_session["conversation"]
            user_message = (
                f"Follow-up events:\n{event_text}\n\n"
                "Handle these events. When done, call the 'done' tool."
            )
            conversation.append({"role": "user", "content": user_message})
        else:
            _log(self.agent_id, "creating fresh session")
            self._awaiting_reply_from.clear()
            conversation = []

            memory_context = ""
            recalled = self.repo_memory.passive_recall(event_text, self.agent_id, PASSIVE_RECALL_LIMIT)
            if recalled:
                memory_lines = [f"  - [{e.action_type}] {e.summary}" for e in recalled]
                memory_context = "\nRepo memory (relevant past actions):\n" + "\n".join(memory_lines)
                _log(self.agent_id, f"passive recall: {len(recalled)} memories")
                traj.log(self.agent_id, "passive_recall", f"{len(recalled)} memories")
            metrics.passive_recall_count = len(recalled)

            bb_state = self.blackboard.read_compacted()
            bb_context = f"\nCurrent blackboard state:\n{json.dumps(bb_state, indent=2, default=str)}"

            user_message = (
                f"Events to handle:\n{event_text}"
                f"{memory_context}"
                f"{bb_context}\n\n"
                "Read the blackboard to get the latest state if needed, then take action. "
                "When you're done with all your tasks for this work item, call the 'done' tool."
            )
            conversation.append({"role": "user", "content": user_message})

        llm_ok = await self._llm_tool_loop(conversation)

        if not llm_ok:
            _log(self.agent_id, "LLM failed on first call — re-queuing events for retry")
            traj.log(self.agent_id, "tool_call", "RE-QUEUED: events put back in mailbox after LLM failure")
            for evt in events:
                self.mailbox.put_nowait(evt)
            metrics.end_time = time.time()
            self.reaction_log.append(metrics)
            self._current_metrics = None
            return

        self._active_session = {
            "conversation": conversation,
            "timestamp": time.time(),
        }

        # Commit changes and merge to main
        merge_result = await self.commit_and_merge()
        if merge_result.success and merge_result.message != "no changes to commit":
            traj.log(self.agent_id, "merge", merge_result.message)
        if not merge_result.success and merge_result.conflict:
            metrics.conflict_encountered = True
            traj.log(self.agent_id, "conflict",
                     f"merge conflict: {merge_result.conflict.conflicted_files}")
            resolved = await self._handle_conflict_resolution(merge_result)
            metrics.conflict_resolved = resolved
            if resolved:
                traj.log(self.agent_id, "conflict_resolved",
                         f"{merge_result.conflict.conflicted_files}")

        metrics.end_time = time.time()
        metrics.input_tokens = self._total_input_tokens - prev_in
        metrics.output_tokens = self._total_output_tokens - prev_out
        metrics.llm_calls = self._llm_call_count - prev_calls
        self.reaction_log.append(metrics)
        self._current_metrics = None

        duration = metrics.end_time - metrics.start_time
        traj.log(self.agent_id, "reaction_end", "",
                 duration=duration, llm_calls=metrics.llm_calls,
                 tokens=metrics.input_tokens + metrics.output_tokens)

    async def _llm_tool_loop(self, conversation: list[dict]) -> bool:
        """Run LLM tool-use loop. Returns False if the first LLM call failed (no work done)."""
        system_prompt = self._build_system_prompt()
        first_call = True
        cumulative_input_tokens = 0

        for _ in range(MAX_LLM_ITERATIONS_PER_REACTION):
            self._llm_call_count += 1
            try:
                response = await self._client.messages.create(
                    model=MODEL,
                    max_tokens=MAX_TOKENS,
                    system=system_prompt,
                    messages=conversation,
                    tools=TOOL_SCHEMAS,
                )
            except Exception as exc:
                error_str = str(exc).lower()
                is_context_overflow = any(
                    phrase in error_str
                    for phrase in ("too many tokens", "context length", "max_tokens", "prompt is too long")
                )
                _log(self.agent_id, f"LLM error: {exc}")
                traj.log(self.agent_id, "tool_call", f"LLM ERROR: {str(exc)[:100]}")
                if is_context_overflow:
                    _log(self.agent_id, "context overflow — committing current work, will continue in fresh session")
                    traj.log(self.agent_id, "tool_call", "CONTEXT OVERFLOW: stopping tool loop, work committed")
                    break
                if first_call:
                    return False
                break
            first_call = False

            input_tokens = response.usage.input_tokens if response.usage else 0
            output_tokens = response.usage.output_tokens if response.usage else 0
            self._total_input_tokens += input_tokens
            self._total_output_tokens += output_tokens
            self.blackboard.add_tokens(input_tokens + output_tokens)
            cumulative_input_tokens += input_tokens

            if cumulative_input_tokens > CONTEXT_WINDOW_LIMIT:
                _log(self.agent_id,
                     f"context at {cumulative_input_tokens:,}/{CONTEXT_WINDOW_LIMIT:,} — compacting conversation")
                traj.log(self.agent_id, "tool_call",
                         f"CONTEXT COMPACT: {cumulative_input_tokens:,} tokens, summarizing history")
                conversation[:] = self._compact_conversation(conversation)
                cumulative_input_tokens = 0

            assistant_content = response.content
            conversation.append({"role": "assistant", "content": assistant_content})

            tool_uses = [block for block in assistant_content if block.type == "tool_use"]
            if not tool_uses:
                for block in assistant_content:
                    if block.type == "text" and block.text.strip():
                        _log(self.agent_id, f"says: {block.text[:120]}...")
                        traj.log(self.agent_id, "says", block.text[:150])
                break

            # Capture the thinking text that precedes tool calls for auto-capture context
            thinking_parts = [b.text for b in assistant_content if b.type == "text" and b.text.strip()]
            self._current_thinking = " ".join(thinking_parts)[:500] if thinking_parts else ""

            tool_results = []
            for tool_use in tool_uses:
                # Record tool usage in current metrics
                if self._current_metrics is not None:
                    self._current_metrics.tools_called.append(tool_use.name)
                    if tool_use.name == "write_file":
                        written_path = tool_use.input.get("path", "")
                        if written_path:
                            self._current_metrics.files_written.append(written_path)

                handler = TOOL_HANDLERS.get(tool_use.name)
                if handler is None:
                    result_text = f"Unknown tool: {tool_use.name}"
                else:
                    try:
                        result_text = await handler(self, **tool_use.input)
                    except Exception as exc:
                        result_text = f"Tool error: {exc}"

                _log(self.agent_id, f"-> {tool_use.name}: {result_text[:100]}")
                traj.log(self.agent_id, "tool_call",
                         f"{tool_use.name}: {result_text[:120]}")

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_use.id,
                    "content": result_text,
                })

            conversation.append({"role": "user", "content": tool_results})

            if any(tu.name == "done" for tu in tool_uses):
                break

            if response.stop_reason != "tool_use":
                break

        return True

    def _compact_conversation(self, conversation: list[dict]) -> list[dict]:
        """Summarize conversation history to free up context space.

        CRITICAL: Must preserve tool_use/tool_result pairing. The Anthropic API
        requires every tool_result to have a matching tool_use in the preceding
        assistant message. We keep the last complete exchange (assistant with
        tool_uses + user with tool_results) intact.
        """
        if len(conversation) <= 2:
            return conversation

        # Find safe cut point: keep the last complete tool_use/tool_result pair
        # Walk backwards to find where to cut
        keep_from = len(conversation)
        found_pairs = 0
        idx = len(conversation) - 1
        while idx >= 0 and found_pairs < 2:
            msg = conversation[idx]
            role = msg.get("role", "")
            if role == "assistant":
                found_pairs += 1
                keep_from = idx
            idx -= 1

        if keep_from <= 1:
            return conversation

        # Extract key facts from older messages
        older = conversation[:keep_from]
        recent = conversation[keep_from:]

        files_written: list[str] = []
        tools_used: list[str] = []

        for msg in older:
            content = msg.get("content", "")
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        text = block.get("content", "")
                        if isinstance(text, str) and "File written:" in text:
                            files_written.append(text.split("File written:")[1].strip()[:60])
                    elif hasattr(block, "name") and block.type == "tool_use":
                        tools_used.append(block.name)

        summary_parts = ["[CONVERSATION COMPACTED — older messages summarized]"]
        if files_written:
            summary_parts.append(f"Files written so far: {', '.join(files_written[:15])}")
        if tools_used:
            summary_parts.append(f"Tools called: {', '.join(tools_used[:15])}")
        summary_parts.append("Continue your work. Check the blackboard for latest state if needed.")

        compacted = [{"role": "user", "content": "\n".join(summary_parts)}]
        compacted.extend(recent)

        _log(self.agent_id,
             f"compacted conversation: {len(conversation)} messages → {len(compacted)} messages")
        return compacted

    def _build_system_prompt(self) -> str:
        bb = self.blackboard
        return (
            f"You are {self.role} (id: {self.agent_id}) in a multi-agent software development team.\n\n"
            f"{self.system_prompt}\n\n"
            f"Current work item: {bb.work_item_title}\n"
            f"Description: {bb.work_item_description}\n\n"
            "IMPORTANT RULES:\n"
            "1. Each reaction is a fresh session — you don't remember previous conversations.\n"
            "2. Your repo memory and the blackboard state provide context from past actions.\n"
            "3. Use the blackboard tools to communicate with other agents.\n"
            "4. Use @mentions (@frontend, @backend, @qa, @lead) to direct messages.\n"
            "5. Write code using write_file with paths like 'src/api/checkout.ts' — no directory prefixes.\n"
            "6. When your work is complete, call the 'done' tool with a summary.\n"
            "7. Be concise — write realistic but compact code.\n"
            f"8. Token budget: {bb.tokens_used}/{bb.token_cap} used.\n"
        )

    # ── Reflection ────────────────────────────────────────────────

    async def _reflect(self) -> None:
        if self._llm_call_count == 0:
            return

        _log(self.agent_id, "reflecting on this work item...")

        metrics = ReactionMetrics(
            agent_id=self.agent_id,
            reaction_index=len(self.reaction_log),
            event_types=["work_item_complete"],
            session_type="reflection",
            start_time=time.time(),
        )
        prev_in = self._total_input_tokens
        prev_out = self._total_output_tokens
        prev_calls = self._llm_call_count
        self._current_metrics = metrics

        reflection_prompt = (
            "The work item is now complete. Reflect on what you did and learned. "
            "Use the memory_annotate tool to save 1-3 key lessons that would help "
            "in similar future tasks. Focus on: approaches that worked, mistakes to avoid, "
            "and patterns you discovered. Be specific and concise. "
            "Include citations to the files you worked with."
        )

        conversation = [{"role": "user", "content": reflection_prompt}]
        await self._llm_tool_loop(conversation)

        metrics.end_time = time.time()
        metrics.input_tokens = self._total_input_tokens - prev_in
        metrics.output_tokens = self._total_output_tokens - prev_out
        metrics.llm_calls = self._llm_call_count - prev_calls
        self.reaction_log.append(metrics)
        self._current_metrics = None

        _log(self.agent_id, f"reflection complete (repo memory: {self.repo_memory.count()} entries)")

    # ── Sub-agent support ─────────────────────────────────────────

    async def spawn_sub_agent(self, name: str, prompt: str) -> str:
        _log(self.agent_id, f"spawning sub-agent: {name}")

        sub_system = (
            f"You are a temporary research assistant named '{name}', spawned by {self.role}. "
            f"You work in the same directory. Complete the task and return a concise summary. "
            f"You do NOT have access to the blackboard or memory tools."
        )

        conversation = [{"role": "user", "content": prompt}]

        for _ in range(10):
            self._llm_call_count += 1
            try:
                response = await self._client.messages.create(
                    model=MODEL,
                    max_tokens=MAX_TOKENS,
                    system=sub_system,
                    messages=conversation,
                    tools=SUB_AGENT_TOOL_SCHEMAS,
                )
            except Exception as exc:
                return f"Sub-agent error: {exc}"

            input_tokens = response.usage.input_tokens if response.usage else 0
            output_tokens = response.usage.output_tokens if response.usage else 0
            self._total_input_tokens += input_tokens
            self._total_output_tokens += output_tokens
            self.blackboard.add_tokens(input_tokens + output_tokens)

            assistant_content = response.content
            conversation.append({"role": "assistant", "content": assistant_content})

            tool_uses = [block for block in assistant_content if block.type == "tool_use"]
            if not tool_uses:
                text_parts = [b.text for b in assistant_content if b.type == "text"]
                return " ".join(text_parts)[:500] if text_parts else "(no output)"

            tool_results = []
            for tool_use in tool_uses:
                if self._current_metrics is not None:
                    self._current_metrics.tools_called.append(f"sub:{tool_use.name}")

                handler = TOOL_HANDLERS.get(tool_use.name)
                if handler is None:
                    result_text = f"Unknown tool: {tool_use.name}"
                else:
                    try:
                        result_text = await handler(self, **tool_use.input)
                    except Exception as exc:
                        result_text = f"Tool error: {exc}"
                _log(self.agent_id, f"  sub[{name}] -> {tool_use.name}: {result_text[:80]}")
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_use.id,
                    "content": result_text,
                })
            conversation.append({"role": "user", "content": tool_results})

            if response.stop_reason != "tool_use":
                text_parts = [b.text for b in assistant_content if b.type == "text"]
                return " ".join(text_parts)[:500] if text_parts else "(completed)"

        return "(sub-agent reached iteration limit)"


def _summarize_entry(entry: dict) -> str:
    parts = []
    for key in ("title", "id", "content", "description", "summary"):
        val = entry.get(key)
        if val:
            text = str(val)[:100]
            parts.append(f"{key}={text}")
    if not parts:
        return str(entry)[:150]
    return ", ".join(parts)
