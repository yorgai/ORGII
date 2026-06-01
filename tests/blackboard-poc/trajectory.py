"""
Trajectory logger: captures a detailed, timestamped event log
and generates a readable markdown trajectory file after each run.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class TrajectoryEvent:
    timestamp: float
    agent_id: str
    event_type: str  # "reaction_start", "tool_call", "says", "merge", "conflict", "done", "system"
    detail: str
    extra: dict = field(default_factory=dict)


class TrajectoryLogger:
    def __init__(self) -> None:
        self.events: list[TrajectoryEvent] = []
        self._start_time: float = 0.0

    def reset(self, start_time: float) -> None:
        self.events.clear()
        self._start_time = start_time

    def log(self, agent_id: str, event_type: str, detail: str, **extra: object) -> None:
        self.events.append(TrajectoryEvent(
            timestamp=time.time(),
            agent_id=agent_id,
            event_type=event_type,
            detail=detail,
            extra=dict(extra),
        ))

    def _fmt_time(self, ts: float) -> str:
        elapsed = ts - self._start_time
        minutes = int(elapsed // 60)
        seconds = int(elapsed % 60)
        return f"{minutes:02d}:{seconds:02d}"

    def generate_markdown(self, result: dict) -> str:
        lines: list[str] = []

        title = result.get("work_item_title", "Unknown")
        status = result.get("status", "unknown")
        elapsed = result.get("elapsed", 0)
        llm_calls = result.get("llm_calls", 0)
        cost = result.get("cost_estimate_usd", 0)
        model = result.get("model", "unknown")
        team_config = result.get("team_config", {})
        bb = result.get("blackboard", {})
        conflicts = result.get("conflicts", {})
        memory = result.get("memory", {})

        lines.append(f"# Trajectory: {title}")
        lines.append("")
        lines.append(f"> **Status:** `{status}` | **Time:** {elapsed:.0f}s | "
                      f"**LLM calls:** {llm_calls} | **Cost:** ${cost:.2f}")
        lines.append(f"> **Model:** {model}")
        if team_config.get("agents_needed"):
            skipped = team_config.get("agents_skipped", [])
            lines.append(f"> **Team:** {team_config['agents_needed']} "
                          f"(complexity: {team_config.get('complexity', '?')}"
                          f"{', skipped: ' + str(skipped) if skipped else ''})")
        lines.append("")

        # Stats table
        lines.append("## Summary")
        lines.append("")
        lines.append("| Metric | Value |")
        lines.append("|--------|-------|")
        lines.append(f"| Tasks | {bb.get('tasks', 0)} |")
        lines.append(f"| Artifacts | {bb.get('artifacts', 0)} |")
        lines.append(f"| Messages | {bb.get('messages', 0)} |")
        lines.append(f"| Decisions | {bb.get('decisions', 0)} |")
        lines.append(f"| Issues | {bb.get('issues', 0)} |")
        lines.append(f"| Conflicts | {conflicts.get('total', 0)} "
                      f"({conflicts.get('resolved', 0)} resolved) |")
        lines.append(f"| Memory | {memory.get('entries_before', 0)} → "
                      f"{memory.get('entries_after', 0)} entries |")
        lines.append(f"| Input tokens | {result.get('input_tokens', 0):,} |")
        lines.append(f"| Output tokens | {result.get('output_tokens', 0):,} |")
        lines.append("")

        # Per-agent table
        lines.append("## Per-Agent Breakdown")
        lines.append("")
        lines.append("| Agent | Reactions | LLM Calls | Tokens | Files | Conflicts | Cost |")
        lines.append("|-------|-----------|-----------|--------|-------|-----------|------|")
        per_agent = result.get("per_agent", {})
        for agent_id, am in per_agent.items():
            cost_est = (am.get("input_tokens", 0) / 1e6) * 3.0 + (am.get("output_tokens", 0) / 1e6) * 15.0
            lines.append(
                f"| {agent_id} | {am.get('reactions', 0)} | {am.get('llm_calls', 0)} | "
                f"{am.get('total_tokens', 0):,} | {len(am.get('files_written', []))} | "
                f"{am.get('conflicts_encountered', 0)} | ${cost_est:.2f} |"
            )
        lines.append("")

        # Timeline
        lines.append("## Timeline")
        lines.append("")
        lines.append("```")
        for evt in self.events:
            ts = self._fmt_time(evt.timestamp)
            agent = evt.agent_id
            tag = f"[{ts}] {agent:<12}"

            if evt.event_type == "system":
                lines.append(f"[{ts}] {'SYSTEM':<12} {evt.detail}")
            elif evt.event_type == "reaction_start":
                session = evt.extra.get("session_type", "fresh")
                events_str = evt.extra.get("events", "")
                lines.append(f"{tag} ▶ reacting ({session}): {events_str}")
            elif evt.event_type == "reaction_end":
                dur = evt.extra.get("duration", 0)
                calls = evt.extra.get("llm_calls", 0)
                tokens = evt.extra.get("tokens", 0)
                lines.append(f"{tag} ◀ done ({dur:.0f}s, {calls} calls, {tokens:,} tokens)")
            elif evt.event_type == "tool_call":
                lines.append(f"{tag} → {evt.detail}")
            elif evt.event_type == "says":
                lines.append(f"{tag} 💬 {evt.detail}")
            elif evt.event_type == "merge":
                lines.append(f"{tag} ⛙ {evt.detail}")
            elif evt.event_type == "conflict":
                lines.append(f"{tag} ⚡ CONFLICT: {evt.detail}")
            elif evt.event_type == "conflict_resolved":
                lines.append(f"{tag} ✅ conflict resolved: {evt.detail}")
            elif evt.event_type == "revive":
                lines.append(f"{tag} 🔄 revived: {evt.detail}")
            elif evt.event_type == "done":
                lines.append(f"{tag} ✓ done: {evt.detail}")
            elif evt.event_type == "deferred":
                lines.append(f"{tag} ⏸ deferred: {evt.detail}")
            elif evt.event_type == "passive_recall":
                lines.append(f"{tag} 🧠 recalled {evt.detail}")
            elif evt.event_type == "team_config":
                lines.append(f"{tag} 🏗 {evt.detail}")
            else:
                lines.append(f"{tag} {evt.detail}")

        lines.append("```")
        lines.append("")

        # Files produced
        lines.append("## Files Produced")
        lines.append("")
        for agent_id, am in per_agent.items():
            files = am.get("files_written", [])
            if files:
                lines.append(f"**{agent_id}:**")
                for fp in files:
                    lines.append(f"- `{fp}`")
                lines.append("")

        return "\n".join(lines)

    def save_markdown(self, result: dict, output_path: Path) -> Path:
        md = self.generate_markdown(result)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(md)
        return output_path


# Global singleton
trajectory = TrajectoryLogger()
