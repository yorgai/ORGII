"""
Orchestrator: lifecycle manager for the Agent-as-Service system.

The orchestrator does NOT tell agents what to do — it only:
  1. Creates real git worktrees for each agent
  2. Posts work items to the blackboard
  3. Tracks cumulative token usage → stops scheduling at token_cap
  4. Waits for completion (or timeout)
  5. Triggers reflection + memory persistence
  6. Cleans up worktrees
  7. Handles graceful shutdown with partial completion
  8. Aggregates per-agent metrics and builds timeline
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

from blackboard import Blackboard, EventType
from agent import Agent, _log
from memory import RepoMemory
from worktree import WorktreeManager
from config import (
    AGENT_DEFINITIONS,
    BLACKBOARD_DIR,
    MEMORY_DIR,
    WORKSPACE_DIR,
    MODEL,
    TOKEN_CAP_PER_WORK_ITEM,
    WORK_ITEM_TIMEOUT,
)

# Per-million-token pricing (input, output) for cost estimation
MODEL_PRICING: dict[str, tuple[float, float]] = {
    "claude-sonnet-4-20250514": (3.0, 15.0),
    "claude-sonnet-4-5": (3.0, 15.0),
    "claude-haiku-35-20241022": (0.80, 4.0),
}
DEFAULT_PRICING = (3.0, 15.0)


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    input_rate, output_rate = MODEL_PRICING.get(model, DEFAULT_PRICING)
    return (input_tokens / 1_000_000) * input_rate + (output_tokens / 1_000_000) * output_rate


class Orchestrator:
    def __init__(self) -> None:
        self.agents: list[Agent] = []
        self._agent_tasks: list[asyncio.Task] = []
        self.blackboard: Blackboard | None = None
        self.repo_memory: RepoMemory | None = None
        self.worktree_mgr: WorktreeManager | None = None

    # ── Boot ─────────────────────────────────────────────────────

    def create_repo_memory(self) -> RepoMemory:
        persist_path = MEMORY_DIR / "repo_memory.json"
        self.repo_memory = RepoMemory(persist_path)
        count = self.repo_memory.load_from_disk()
        print(f"[BOOT] Repo memory loaded: {count} entries")
        return self.repo_memory

    def create_blackboard(self, work_item_id: str, title: str, description: str) -> Blackboard:
        persist_path = BLACKBOARD_DIR / f"{work_item_id}.json"
        self.blackboard = Blackboard(
            work_item_id=work_item_id,
            work_item_title=title,
            work_item_description=description,
            persist_path=persist_path,
            token_cap=TOKEN_CAP_PER_WORK_ITEM,
        )
        return self.blackboard

    async def init_worktree_manager(self) -> WorktreeManager:
        repo_root = WORKSPACE_DIR / "repo"
        self.worktree_mgr = WorktreeManager(repo_root)
        await self.worktree_mgr.init_repo()
        return self.worktree_mgr

    async def create_worktrees(self, work_item_id: str) -> dict[str, Path]:
        if self.worktree_mgr is None:
            raise RuntimeError("Init worktree manager first")

        worktrees: dict[str, Path] = {}
        for defn in AGENT_DEFINITIONS:
            wt_path = await self.worktree_mgr.create_worktree(defn["id"], work_item_id)
            worktrees[defn["id"]] = wt_path
        return worktrees

    async def cleanup_worktrees(self) -> None:
        if self.worktree_mgr:
            await self.worktree_mgr.remove_all_worktrees()

    async def create_agents(self) -> list[Agent]:
        if self.blackboard is None:
            raise RuntimeError("Create blackboard before agents")
        if self.repo_memory is None:
            raise RuntimeError("Create repo memory before agents")
        if self.worktree_mgr is None:
            raise RuntimeError("Init worktree manager before agents")

        self.agents = []
        for defn in AGENT_DEFINITIONS:
            wt_path = self.worktree_mgr.get_worktree_path(defn["id"])
            if wt_path is None:
                raise RuntimeError(f"No worktree for {defn['id']}")
            agent = Agent(
                agent_id=defn["id"],
                role=defn["role"],
                system_prompt=defn["system_prompt"],
                subscribes=defn["subscribes"],
                blackboard=self.blackboard,
                repo_memory=self.repo_memory,
                worktree_path=wt_path,
                worktree_mgr=self.worktree_mgr,
            )
            self.agents.append(agent)
        return self.agents

    def start_agent_tasks(self) -> list[asyncio.Task]:
        self._agent_tasks = [
            asyncio.create_task(agent.run_forever(), name=f"agent-{agent.agent_id}")
            for agent in self.agents
        ]
        return self._agent_tasks

    # ── Work Item Execution ──────────────────────────────────────

    async def run_work_item(
        self,
        work_item_id: str,
        title: str,
        description: str,
        timeout: float | None = None,
        token_cap: int | None = None,
    ) -> dict:
        if timeout is None:
            timeout = WORK_ITEM_TIMEOUT

        print()
        print("=" * 60)
        print(f"  WORK ITEM: {title}")
        print("=" * 60)
        print()

        bb = self.blackboard
        if bb is None:
            raise RuntimeError("No blackboard")

        bb.work_item_id = work_item_id
        bb.work_item_title = title
        bb.work_item_description = description
        bb.persist_path = BLACKBOARD_DIR / f"{work_item_id}.json"
        bb.reset_for_new_work_item()

        if token_cap is not None:
            bb.token_cap = token_cap

        memory_before = self.repo_memory.count() if self.repo_memory else 0

        await self.cleanup_worktrees()
        worktrees = await self.create_worktrees(work_item_id)

        for agent in self.agents:
            agent.reset_for_new_work_item()
            wt_path = worktrees.get(agent.agent_id)
            if wt_path:
                agent.worktree_path = wt_path

        bb.post_work_item()

        start_time = time.time()
        try:
            await asyncio.wait_for(
                self._wait_for_completion_with_budget(), timeout=timeout
            )
        except asyncio.TimeoutError:
            print(f"\n[TIMEOUT] Work item timed out after {timeout}s")
            if bb.status == "running":
                bb.status = "partial"

        elapsed = time.time() - start_time

        # Wait for in-flight reactions to finish (agents in WORKING state)
        for _ in range(15):
            if all(a.state.value != "working" for a in self.agents):
                break
            await asyncio.sleep(2.0)

        bb.notify_work_item_complete()
        await asyncio.sleep(5.0)

        # Save handoff context for partial completions
        if bb.status == "partial" and self.repo_memory:
            self._save_handoff_context(bb)

        memory_after = self.repo_memory.count() if self.repo_memory else 0

        # ── Aggregate metrics ────────────────────────────────────
        bb_stats = bb.get_stats()
        total_llm_calls = sum(a._llm_call_count for a in self.agents)
        total_input_tokens = sum(a._total_input_tokens for a in self.agents)
        total_output_tokens = sum(a._total_output_tokens for a in self.agents)
        cost = estimate_cost(MODEL, total_input_tokens, total_output_tokens)

        per_agent: dict[str, dict] = {}
        all_reaction_entries: list[dict] = []
        total_conflicts = 0
        total_conflicts_resolved = 0

        for agent in self.agents:
            agent_metrics = agent.get_agent_metrics()
            per_agent[agent.agent_id] = agent_metrics
            total_conflicts += agent_metrics["conflicts_encountered"]
            total_conflicts_resolved += agent_metrics["conflicts_resolved"]

            for rm in agent.reaction_log:
                all_reaction_entries.append(rm.to_dict())

        all_reaction_entries.sort(key=lambda x: x["start_time"])

        # Build relative-time timeline
        timeline: list[dict] = [
            {"t": 0.0, "agent": "system", "event": "work_item_posted"}
        ]
        for entry in all_reaction_entries:
            rel_start = round(entry["start_time"] - start_time, 2)
            rel_end = round(entry["end_time"] - start_time, 2) if entry["end_time"] else rel_start
            timeline.append({
                "t": rel_start,
                "agent": entry["agent_id"],
                "event": "reaction_start",
                "session_type": entry["session_type"],
                "event_types": entry["event_types"],
            })
            timeline.append({
                "t": rel_end,
                "agent": entry["agent_id"],
                "event": "reaction_end",
                "llm_calls": entry["llm_calls"],
                "tokens": entry["total_tokens"],
                "duration": entry["duration_seconds"],
            })

        passive_recalls = sum(
            rm.passive_recall_count for a in self.agents for rm in a.reaction_log
        )

        team_config = bb.team_config or {
            "agents_needed": [a.agent_id for a in self.agents if a.agent_id != "lead"],
            "agents_skipped": [],
            "complexity": "unknown",
            "rationale": "configure_team not called — all agents active",
        }

        result = {
            "work_item_id": work_item_id,
            "work_item_title": title,
            "model": MODEL,
            "status": bb.status,
            "elapsed": round(elapsed, 2),
            "llm_calls": total_llm_calls,
            "input_tokens": total_input_tokens,
            "output_tokens": total_output_tokens,
            "tokens_used": bb.tokens_used,
            "token_cap": bb.token_cap,
            "cost_estimate_usd": round(cost, 4),
            "team_config": team_config,
            "blackboard": bb_stats,
            "per_agent": per_agent,
            "conflicts": {
                "total": total_conflicts,
                "resolved": total_conflicts_resolved,
                "unresolved": total_conflicts - total_conflicts_resolved,
            },
            "memory": {
                "entries_before": memory_before,
                "entries_after": memory_after,
                "passive_recalls": passive_recalls,
            },
            "timeline": timeline,
            "recommended_follow_ups": bb.recommended_follow_ups,
        }

        # ── Print summary ────────────────────────────────────────
        print()
        print("-" * 60)
        print(f"  WORK ITEM {bb.status.upper()} — {elapsed:.0f}s, {total_llm_calls} LLM calls")
        if team_config.get("agents_skipped"):
            print(f"  Team: active={team_config['agents_needed']}, "
                  f"skipped={team_config['agents_skipped']}, "
                  f"complexity={team_config['complexity']}")
        print(f"  Tokens: {bb.tokens_used:,} / {bb.token_cap:,} "
              f"({bb.tokens_used / max(bb.token_cap, 1) * 100:.1f}%)")
        print(f"  Cost estimate: ${cost:.4f}")
        print(f"  Per-agent:")
        for agent_id, am in per_agent.items():
            print(f"    {agent_id:<10} reactions={am['reactions']}  "
                  f"llm_calls={am['llm_calls']}  "
                  f"tokens={am['total_tokens']:,}  "
                  f"files={len(am['files_written'])}  "
                  f"conflicts={am['conflicts_encountered']}")
        print(f"  Blackboard: {bb_stats['tasks']} tasks, {bb_stats['artifacts']} artifacts, "
              f"{bb_stats['messages']} messages, {bb_stats['decisions']} decisions, "
              f"{bb_stats['issues']} issues")
        if total_conflicts > 0:
            print(f"  Conflicts: {total_conflicts} total, "
                  f"{total_conflicts_resolved} resolved, "
                  f"{total_conflicts - total_conflicts_resolved} unresolved")
        print(f"  Memory: {memory_before} -> {memory_after} entries "
              f"({passive_recalls} passive recalls)")
        if bb.recommended_follow_ups:
            print(f"  Follow-ups: {bb.recommended_follow_ups}")
        print("-" * 60)

        await self.cleanup_worktrees()

        return result

    async def _wait_for_completion_with_budget(self) -> None:
        bb = self.blackboard
        assert bb is not None
        idle_ticks = 0

        while True:
            all_done = all(
                agent.state.value == "done" for agent in self.agents
            )
            if all_done:
                return

            if bb.is_budget_exhausted() and bb.status == "running":
                print(f"\n[BUDGET] Token cap reached: {bb.tokens_used:,} >= {bb.token_cap:,}")
                bb.notify_budget_exhausted()
                await asyncio.sleep(10.0)
                return

            # Stuck detection: all agents idle/done but tasks remain
            all_idle_or_done = all(
                agent.state.value in ("idle", "done") for agent in self.agents
            )
            if all_idle_or_done:
                pending_tasks = [
                    t for t in bb.tasks
                    if t["status"] in ("pending", "blocked")
                ]
                if pending_tasks:
                    idle_ticks += 1
                    if idle_ticks == 3:  # 6 seconds stuck → try self-healing
                        # Separate tasks with met deps from truly stuck ones
                        healable = [t for t in pending_tasks if bb.are_dependencies_met(t["id"])]
                        if healable:
                            print(f"\n[HEAL] Re-delivering {len(healable)} tasks with met dependencies")
                            for task in healable:
                                from blackboard import BlackboardEvent, EventType, _gen_id
                                event = BlackboardEvent(
                                    event_id=_gen_id("evt"),
                                    event_type=EventType.NEW_TASK,
                                    section="tasks",
                                    entry_id=task["id"],
                                    entry=task,
                                    author="system",
                                )
                                bb._emit(event)
                            idle_ticks = 0
                        # else: deps truly unmet, keep waiting

                    elif idle_ticks >= 8:  # 16 seconds → unrecoverable, park and exit
                        stuck_info = [(t["id"], t["title"], t["status"]) for t in pending_tasks]
                        print(f"\n[STUCK] Unrecoverable: {len(pending_tasks)} tasks stuck: {stuck_info}")
                        for task in pending_tasks:
                            task["status"] = "parked"
                            bb.recommended_follow_ups.append(
                                f"{task['id']}: {task['title']} (stuck — deps unmet or agent done prematurely)"
                            )
                        bb.status = "partial"
                        return
                else:
                    idle_ticks = 0
            else:
                idle_ticks = 0

            await asyncio.sleep(2.0)

    # ── Handoff Context ───────────────────────────────────────────

    def _save_handoff_context(self, bb: Blackboard) -> None:
        """Save structured context to repo memory so the next WI knows what was done and what remains."""
        if not self.repo_memory:
            return

        completed_tasks = [t for t in bb.tasks if t["status"] == "complete"]
        parked_tasks = [t for t in bb.tasks if t["status"] == "parked"]
        decisions = bb.decisions

        completed_summary = "; ".join(
            f"{t['title']} (@{t['assigned_to']})" for t in completed_tasks
        ) or "none"

        parked_summary = "; ".join(
            f"{t['title']} (@{t['assigned_to']}): {t.get('description', '')[:80]}"
            for t in parked_tasks
        ) or "none"

        decision_summary = "; ".join(
            f"{d['title']}: {d['rationale'][:60]}" for d in decisions
        ) or "none"

        handoff_text = (
            f"HANDOFF from partial work item '{bb.work_item_title}': "
            f"Completed: [{completed_summary}]. "
            f"Parked (needs follow-up): [{parked_summary}]. "
            f"Decisions: [{decision_summary}]."
        )

        self.repo_memory.auto_capture(
            summary=handoff_text,
            file_path="(handoff)",
            source_agent="system",
            action_type="handoff",
            importance=9.0,
        )

        # Also save each parked task as a separate high-importance memory entry
        for task in parked_tasks:
            self.repo_memory.auto_capture(
                summary=(
                    f"PARKED TASK from '{bb.work_item_title}': "
                    f"{task['title']} (assigned to @{task['assigned_to']}). "
                    f"Description: {task.get('description', 'N/A')[:150]}. "
                    f"Depends on: {task.get('depends_on', [])}."
                ),
                file_path="(parked-task)",
                source_agent="system",
                action_type="handoff",
                importance=8.0,
            )

        print(f"[HANDOFF] Saved context: {len(completed_tasks)} completed, "
              f"{len(parked_tasks)} parked, {len(decisions)} decisions → repo memory")

    # ── Shutdown ─────────────────────────────────────────────────

    async def shutdown(self) -> None:
        print("\n[SHUTDOWN] Saving repo memory to disk...")
        for agent in self.agents:
            agent.shutdown()

        for task in self._agent_tasks:
            task.cancel()

        await asyncio.gather(*self._agent_tasks, return_exceptions=True)

        if self.repo_memory:
            self.repo_memory.save_to_disk()
            print(f"[SHUTDOWN] Repo memory saved: {self.repo_memory.count()} entries")

        print("[SHUTDOWN] Complete.")


def parse_work_item(path: Path) -> dict:
    text = path.read_text()
    lines = text.strip().split("\n")

    title = ""
    description_lines = []
    in_body = False

    for line in lines:
        stripped = line.strip()
        if not title and stripped.startswith("# "):
            title = stripped[2:].strip()
            in_body = True
            continue
        if in_body:
            description_lines.append(line)

    work_item_id = path.stem
    description = "\n".join(description_lines).strip()

    return {
        "id": work_item_id,
        "title": title,
        "description": description,
    }
