"""
Shared Repo Memory: repo-scoped, citation-validated memory store.

Key differences from per-agent memory:
  - Single shared store (all agents read/write the same memory)
  - Auto-captured from code actions (write_file, edit, post_artifact)
  - Citation-validated: entries anchored to file paths
  - Passive recall: top-N graded entries injected at session start
  - memory_annotate for supplemental insights (replaces memory_store)
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

MEMORY_MAX_ENTRIES = 500


@dataclass
class Citation:
    file_path: str
    symbol: str | None = None

    def to_dict(self) -> dict:
        result: dict = {"file_path": self.file_path}
        if self.symbol:
            result["symbol"] = self.symbol
        return result

    @classmethod
    def from_dict(cls, data: dict) -> Citation:
        return cls(file_path=data["file_path"], symbol=data.get("symbol"))


@dataclass
class MemoryEntry:
    entry_id: str
    summary: str
    citations: list[Citation]
    source_agent: str
    action_type: str  # "auto_capture" | "annotate" | "decision" | "reflection"
    importance: float = 5.0
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "entry_id": self.entry_id,
            "summary": self.summary,
            "citations": [c.to_dict() for c in self.citations],
            "source_agent": self.source_agent,
            "action_type": self.action_type,
            "importance": self.importance,
            "timestamp": self.timestamp,
        }

    @classmethod
    def from_dict(cls, data: dict) -> MemoryEntry:
        return cls(
            entry_id=data["entry_id"],
            summary=data["summary"],
            citations=[Citation.from_dict(c) for c in data.get("citations", [])],
            source_agent=data["source_agent"],
            action_type=data["action_type"],
            importance=data.get("importance", 5.0),
            timestamp=data.get("timestamp", 0.0),
        )


class RepoMemory:
    """Shared repository-scoped memory store used by all agents."""

    def __init__(self, persist_path: Path):
        self.persist_path = persist_path
        self.entries: list[MemoryEntry] = []

    def load_from_disk(self) -> int:
        if not self.persist_path.exists():
            return 0
        raw = json.loads(self.persist_path.read_text())
        self.entries = [MemoryEntry.from_dict(entry) for entry in raw.get("entries", [])]
        return len(self.entries)

    def save_to_disk(self) -> None:
        data = {
            "version": 2,
            "entries": [entry.to_dict() for entry in self.entries],
        }
        self.persist_path.parent.mkdir(parents=True, exist_ok=True)
        self.persist_path.write_text(json.dumps(data, indent=2, default=str))

    # ── Auto-capture (called by tool handlers) ──────────────────────

    def auto_capture(
        self,
        summary: str,
        file_path: str,
        source_agent: str,
        action_type: str = "auto_capture",
        importance: float = 5.0,
    ) -> MemoryEntry:
        """System-level capture triggered by write_file, edit, post_artifact."""
        entry = MemoryEntry(
            entry_id=f"mem-{uuid.uuid4().hex[:8]}",
            summary=summary,
            citations=[Citation(file_path=file_path)],
            source_agent=source_agent,
            action_type=action_type,
            importance=importance,
        )
        self._add_entry(entry)
        return entry

    # ── Agent-initiated annotation ──────────────────────────────────

    def annotate(
        self,
        summary: str,
        rationale: str | None,
        citations: list[dict],
        source_agent: str,
    ) -> MemoryEntry:
        """Agent adds supplemental context (rationale, insights)."""
        entry = MemoryEntry(
            entry_id=f"mem-{uuid.uuid4().hex[:8]}",
            summary=f"{summary}" + (f" | Rationale: {rationale}" if rationale else ""),
            citations=[Citation.from_dict(c) for c in citations],
            source_agent=source_agent,
            action_type="annotate",
            importance=7.0,
        )
        self._add_entry(entry)
        return entry

    # ── Recall ──────────────────────────────────────────────────────

    def passive_recall(self, event_text: str, agent_id: str, limit: int = 15) -> list[MemoryEntry]:
        """Graded recall for session injection. Scores by relevance + importance + recency."""
        if not self.entries:
            return []

        now = time.time()
        scored: list[tuple[float, MemoryEntry]] = []

        event_lower = event_text.lower()
        event_keywords = set(event_lower.split())

        for entry in self.entries:
            searchable = f"{entry.summary} {' '.join(c.file_path for c in entry.citations)}".lower()
            keyword_score = sum(1 for kw in event_keywords if kw in searchable)
            importance_score = entry.importance
            recency_hours = max((now - entry.timestamp) / 3600, 0.1)
            recency_score = 5.0 / recency_hours  # recent entries score higher

            total = keyword_score * 3 + importance_score + min(recency_score, 10.0)
            if total > 0:
                scored.append((total, entry))

        scored.sort(key=lambda x: -x[0])
        return [entry for _, entry in scored[:limit]]

    def active_recall(
        self,
        query: str,
        files: list[str] | None = None,
        limit: int = 20,
    ) -> list[MemoryEntry]:
        """Explicit search by agent during session (memory_recall tool)."""
        if not query.strip():
            return sorted(self.entries, key=lambda x: -x.importance)[:limit]

        query_lower = query.lower()
        keywords = query_lower.split()
        scored: list[tuple[float, MemoryEntry]] = []

        for entry in self.entries:
            if files:
                entry_files = {c.file_path for c in entry.citations}
                if not any(ef.startswith(prefix) for ef in entry_files for prefix in files):
                    continue

            searchable = f"{entry.summary} {' '.join(c.file_path for c in entry.citations)}".lower()
            score = sum(1 for kw in keywords if kw in searchable)
            if score > 0:
                scored.append((score * 2 + entry.importance, entry))

        scored.sort(key=lambda x: -x[0])
        return [entry for _, entry in scored[:limit]]

    # ── Internal ────────────────────────────────────────────────────

    def _add_entry(self, entry: MemoryEntry) -> None:
        if len(self.entries) >= MEMORY_MAX_ENTRIES:
            self.entries.sort(key=lambda x: x.importance + (x.timestamp / 1e10))
            self.entries.pop(0)
        self.entries.append(entry)

    def count(self) -> int:
        return len(self.entries)

    def clear(self) -> None:
        self.entries.clear()
