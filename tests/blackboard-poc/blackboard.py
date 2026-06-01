"""
Blackboard: shared state + pub/sub event bus for multi-agent collaboration.

All agent communication happens through a shared Blackboard — no direct
agent-to-agent calls, no orchestrator relay. The Blackboard is both
persistent state and pub/sub event bus.

Key features (Agent-as-Service model):
  - IDs on all entries for cross-referencing
  - Compaction for context injection (completed entries compressed)
  - Token usage tracking with budget cap
  - Status tracking (running/complete/partial/cancelled)
  - Related fields (related_task_id, related_artifact_id, reply_to)
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional


class EventType(str, Enum):
    NEW_WORK_ITEM = "new_work_item"
    NEW_TASK = "new_task"
    TASK_UPDATED = "task_updated"
    TASK_COMPLETE = "task_complete"
    TASK_PARKED = "task_parked"
    NEW_ARTIFACT = "new_artifact"
    NEW_MESSAGE = "new_message"
    NEW_DECISION = "new_decision"
    NEW_ISSUE = "new_issue"
    ALL_DONE = "all_done"
    BUDGET_EXHAUSTED = "budget_exhausted"
    WORK_ITEM_COMPLETE = "work_item_complete"


@dataclass
class BlackboardEvent:
    event_id: str
    event_type: EventType
    section: str
    entry_id: str
    entry: dict
    author: str
    timestamp: float = field(default_factory=time.time)


def _gen_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


@dataclass
class Blackboard:
    work_item_id: str
    work_item_title: str
    work_item_description: str
    persist_path: Optional[Path] = None

    status: str = "running"  # running | complete | partial | cancelled
    tokens_used: int = 0
    token_cap: int = 2_000_000

    tasks: list[dict] = field(default_factory=list)
    artifacts: list[dict] = field(default_factory=list)
    messages: list[dict] = field(default_factory=list)
    decisions: list[dict] = field(default_factory=list)
    issues: list[dict] = field(default_factory=list)
    recommended_follow_ups: list[str] = field(default_factory=list)

    _subscribers: dict[str, asyncio.Queue] = field(default_factory=dict, repr=False)
    _done_agents: set[str] = field(default_factory=set, repr=False)
    _all_agent_ids: set[str] = field(default_factory=set, repr=False)
    _active_agents: set[str] = field(default_factory=set, repr=False)

    # Team configuration set by Lead via configure_team tool
    team_config: Optional[dict] = field(default=None, repr=False)

    def subscribe(self, agent_id: str) -> asyncio.Queue:
        mailbox: asyncio.Queue = asyncio.Queue()
        self._subscribers[agent_id] = mailbox
        self._all_agent_ids.add(agent_id)
        self._active_agents.add(agent_id)
        return mailbox

    def configure_active_agents(self, agents_needed: list[str], complexity: str, rationale: str) -> list[str]:
        """Set which agents are active. Lead is always active. Returns list of skipped agents."""
        self._active_agents = {"lead"} | set(agents_needed)
        self.team_config = {
            "agents_needed": agents_needed,
            "complexity": complexity,
            "rationale": rationale,
        }
        skipped = [aid for aid in self._all_agent_ids if aid not in self._active_agents]
        for agent_id in skipped:
            self._done_agents.add(agent_id)
        self.team_config["agents_skipped"] = skipped
        _log_bb = f"[blackboard] team configured: active={list(self._active_agents)}, skipped={skipped}"
        print(_log_bb, flush=True)
        return skipped

    # ── Token tracking ─────────────────────────────────────────────

    def add_tokens(self, count: int) -> None:
        self.tokens_used += count

    def is_budget_exhausted(self) -> bool:
        return self.tokens_used >= self.token_cap

    # ── Event emission ─────────────────────────────────────────────

    def _emit(self, event: BlackboardEvent) -> None:
        for agent_id, mailbox in self._subscribers.items():
            if agent_id != event.author and agent_id in self._active_agents:
                mailbox.put_nowait(event)
        self._save()

    def _emit_to_all(self, event: BlackboardEvent) -> None:
        for agent_id, mailbox in self._subscribers.items():
            if agent_id in self._active_agents:
                mailbox.put_nowait(event)
        self._save()

    def _save(self) -> None:
        if self.persist_path is None:
            return
        snapshot = {
            "work_item_id": self.work_item_id,
            "work_item_title": self.work_item_title,
            "work_item_description": self.work_item_description,
            "status": self.status,
            "tokens_used": self.tokens_used,
            "token_cap": self.token_cap,
            "tasks": self.tasks,
            "artifacts": self.artifacts,
            "messages": self.messages,
            "decisions": self.decisions,
            "issues": self.issues,
            "recommended_follow_ups": self.recommended_follow_ups,
        }
        self.persist_path.write_text(json.dumps(snapshot, indent=2, default=str))

    # ── Write operations ───────────────────────────────────────────

    def post_work_item(self) -> None:
        entry = {
            "work_item_id": self.work_item_id,
            "title": self.work_item_title,
            "description": self.work_item_description,
            "timestamp": time.time(),
        }
        event = BlackboardEvent(
            event_id=_gen_id("evt"),
            event_type=EventType.NEW_WORK_ITEM,
            section="work_item",
            entry_id=self.work_item_id,
            entry=entry,
            author="system",
        )
        self._emit_to_all(event)

    def post_task(
        self,
        agent_id: str,
        title: str,
        assigned_to: str,
        description: str,
        depends_on: Optional[list[str]] = None,
    ) -> dict:
        task_id = _gen_id("task")
        entry = {
            "id": task_id,
            "title": title,
            "assigned_to": assigned_to,
            "status": "pending",
            "description": description,
            "depends_on": depends_on or [],
            "created_by": agent_id,
            "notes": None,
            "timestamp": time.time(),
        }
        self.tasks.append(entry)
        self._emit(BlackboardEvent(
            event_id=_gen_id("evt"),
            event_type=EventType.NEW_TASK,
            section="tasks",
            entry_id=task_id,
            entry=entry,
            author=agent_id,
        ))
        return entry

    def update_task(
        self,
        agent_id: str,
        task_id: str,
        status: str,
        notes: Optional[str] = None,
    ) -> Optional[dict]:
        for task in self.tasks:
            if task["id"] == task_id:
                task["status"] = status
                if notes:
                    task["notes"] = notes
                task["updated_at"] = time.time()

                if status == "complete":
                    event_type = EventType.TASK_COMPLETE
                elif status == "parked":
                    event_type = EventType.TASK_PARKED
                else:
                    event_type = EventType.TASK_UPDATED

                self._emit(BlackboardEvent(
                    event_id=_gen_id("evt"),
                    event_type=event_type,
                    section="tasks",
                    entry_id=task_id,
                    entry=task,
                    author=agent_id,
                ))
                return task
        return None

    def post_artifact(
        self,
        agent_id: str,
        title: str,
        content: str,
        file_path: Optional[str] = None,
        related_task_id: Optional[str] = None,
    ) -> dict:
        artifact_id = _gen_id("art")
        entry = {
            "id": artifact_id,
            "agent_id": agent_id,
            "title": title,
            "content": content,
            "file_path": file_path,
            "related_task_id": related_task_id,
            "timestamp": time.time(),
        }
        self.artifacts.append(entry)
        self._emit(BlackboardEvent(
            event_id=_gen_id("evt"),
            event_type=EventType.NEW_ARTIFACT,
            section="artifacts",
            entry_id=artifact_id,
            entry=entry,
            author=agent_id,
        ))
        return entry

    def post_message(
        self,
        from_agent: str,
        content: str,
        to_agent: Optional[str] = None,
        reply_to: Optional[str] = None,
    ) -> dict:
        msg_id = _gen_id("msg")
        entry = {
            "id": msg_id,
            "from_agent": from_agent,
            "to_agent": to_agent,
            "reply_to": reply_to,
            "content": content,
            "timestamp": time.time(),
        }
        self.messages.append(entry)
        self._emit(BlackboardEvent(
            event_id=_gen_id("evt"),
            event_type=EventType.NEW_MESSAGE,
            section="messages",
            entry_id=msg_id,
            entry=entry,
            author=from_agent,
        ))
        return entry

    def post_decision(
        self,
        agent_id: str,
        title: str,
        rationale: str,
        related_task_id: Optional[str] = None,
    ) -> dict:
        decision_id = _gen_id("dec")
        entry = {
            "id": decision_id,
            "agent_id": agent_id,
            "title": title,
            "rationale": rationale,
            "related_task_id": related_task_id,
            "timestamp": time.time(),
        }
        self.decisions.append(entry)
        self._emit(BlackboardEvent(
            event_id=_gen_id("evt"),
            event_type=EventType.NEW_DECISION,
            section="decisions",
            entry_id=decision_id,
            entry=entry,
            author=agent_id,
        ))
        return entry

    def post_issue(
        self,
        agent_id: str,
        title: str,
        description: str,
        severity: str = "medium",
        related_artifact_id: Optional[str] = None,
    ) -> dict:
        issue_id = _gen_id("iss")
        entry = {
            "id": issue_id,
            "agent_id": agent_id,
            "title": title,
            "description": description,
            "severity": severity,
            "related_artifact_id": related_artifact_id,
            "resolved": False,
            "timestamp": time.time(),
        }
        self.issues.append(entry)
        self._emit(BlackboardEvent(
            event_id=_gen_id("evt"),
            event_type=EventType.NEW_ISSUE,
            section="issues",
            entry_id=issue_id,
            entry=entry,
            author=agent_id,
        ))
        return entry

    _all_done_emitted: bool = field(default=False, repr=False)

    def mark_agent_done(self, agent_id: str, summary: str) -> None:
        already_done = agent_id in self._done_agents
        self._done_agents.add(agent_id)
        if not already_done:
            self.post_message(agent_id, f"[DONE] {summary}")
        if not self._all_done_emitted and self._done_agents >= self._active_agents:
            self._all_done_emitted = True
            event = BlackboardEvent(
                event_id=_gen_id("evt"),
                event_type=EventType.ALL_DONE,
                section="system",
                entry_id="all_done",
                entry={"summary": "All agents have completed"},
                author="system",
            )
            self._emit_to_all(event)

    def notify_budget_exhausted(self) -> None:
        self.status = "partial"
        for task in self.tasks:
            if task["status"] == "pending":
                task["status"] = "parked"
                self.recommended_follow_ups.append(
                    f"{task['id']}: {task['title']} (parked — assigned to @{task['assigned_to']})"
                )
        event = BlackboardEvent(
            event_id=_gen_id("evt"),
            event_type=EventType.BUDGET_EXHAUSTED,
            section="system",
            entry_id="budget",
            entry={"tokens_used": self.tokens_used, "token_cap": self.token_cap},
            author="system",
        )
        self._emit_to_all(event)

    def notify_work_item_complete(self) -> None:
        if self.status == "running":
            self.status = "complete"
        event = BlackboardEvent(
            event_id=_gen_id("evt"),
            event_type=EventType.WORK_ITEM_COMPLETE,
            section="system",
            entry_id="complete",
            entry={"status": self.status},
            author="system",
        )
        self._emit_to_all(event)

    # ── Read operations ────────────────────────────────────────────

    def read_section(self, section: str) -> list[dict]:
        return getattr(self, section, [])

    def read_all(self) -> dict:
        return {
            "work_item": {
                "id": self.work_item_id,
                "title": self.work_item_title,
                "description": self.work_item_description,
                "status": self.status,
                "tokens_used": self.tokens_used,
                "token_cap": self.token_cap,
            },
            "tasks": self.tasks,
            "artifacts": self.artifacts,
            "messages": self.messages,
            "decisions": self.decisions,
            "issues": self.issues,
        }

    def read_compacted(self) -> dict:
        """Compacted view for context injection into fresh sessions."""
        return {
            "work_item": {
                "id": self.work_item_id,
                "title": self.work_item_title,
                "description": self.work_item_description,
                "status": self.status,
            },
            "tasks": [self._compact_task(t) for t in self.tasks],
            "artifacts": [self._compact_artifact(a) for a in self.artifacts],
            "messages": self._compact_messages(),
            "decisions": self.decisions,  # always full
            "issues": [self._compact_issue(i) for i in self.issues],
        }

    def _compact_task(self, task: dict) -> dict:
        if task["status"] == "complete":
            return {
                "id": task["id"],
                "title": task["title"],
                "status": "complete",
                "assigned_to": task["assigned_to"],
                "notes": task.get("notes"),
            }
        return task

    def _compact_artifact(self, artifact: dict) -> dict:
        content = artifact.get("content", "")
        first_line = content.split("\n")[0][:100] if content else ""
        return {
            "id": artifact["id"],
            "agent_id": artifact["agent_id"],
            "title": artifact["title"],
            "file_path": artifact.get("file_path"),
            "summary": first_line,
            "related_task_id": artifact.get("related_task_id"),
        }

    def _compact_messages(self) -> list[dict]:
        recent_limit = 15
        if len(self.messages) <= recent_limit:
            return self.messages
        older = self.messages[:-recent_limit]
        recent = self.messages[-recent_limit:]
        participants = set()
        for msg in older:
            participants.add(msg["from_agent"])
            if msg.get("to_agent"):
                participants.add(msg["to_agent"])
        summary_entry = {
            "id": "summary",
            "from_agent": "system",
            "content": f"[{len(older)} earlier messages between {', '.join(sorted(participants))}]",
            "timestamp": older[-1]["timestamp"] if older else 0,
        }
        return [summary_entry] + recent

    def _compact_issue(self, issue: dict) -> dict:
        if issue.get("resolved"):
            return {
                "id": issue["id"],
                "title": issue["title"],
                "severity": issue["severity"],
                "resolved": True,
            }
        return issue

    # ── Dependency Check ────────────────────────────────────────────

    def are_dependencies_met(self, task_id: str) -> bool:
        """Check if all depends_on tasks are complete."""
        for task in self.tasks:
            if task["id"] == task_id:
                deps = task.get("depends_on", [])
                if not deps:
                    return True
                for dep_id in deps:
                    dep_task = next((t for t in self.tasks if t["id"] == dep_id), None)
                    if dep_task is None or dep_task["status"] != "complete":
                        return False
                return True
        return False

    def get_blocking_deps(self, task_id: str) -> list[str]:
        """Return list of incomplete dependency task IDs."""
        for task in self.tasks:
            if task["id"] == task_id:
                deps = task.get("depends_on", [])
                blocking = []
                for dep_id in deps:
                    dep_task = next((t for t in self.tasks if t["id"] == dep_id), None)
                    if dep_task is None or dep_task["status"] != "complete":
                        blocking.append(dep_id)
                return blocking
        return []

    # ── Stats ──────────────────────────────────────────────────────

    def get_stats(self) -> dict:
        return {
            "tasks": len(self.tasks),
            "artifacts": len(self.artifacts),
            "messages": len(self.messages),
            "decisions": len(self.decisions),
            "issues": len(self.issues),
            "tokens_used": self.tokens_used,
            "status": self.status,
        }

    def reset_for_new_work_item(self) -> None:
        self.artifacts.clear()
        self.messages.clear()
        self.decisions.clear()
        self.issues.clear()
        self.tasks.clear()
        self.recommended_follow_ups.clear()
        self._done_agents.clear()
        self._all_done_emitted = False
        self._active_agents = set(self._all_agent_ids)
        self.team_config = None
        self.tokens_used = 0
        self.status = "running"
        for mailbox in self._subscribers.values():
            while not mailbox.empty():
                try:
                    mailbox.get_nowait()
                except asyncio.QueueEmpty:
                    break
