#!/usr/bin/env python3
"""
Agent-as-Service + Blackboard Multi-Agent POC — Entry Point.

Agent = persistent service (identity + memory).
Session = ephemeral reaction (fresh LLM conversation per event).

Boots persistent agent services, runs work items sequentially,
demonstrates fresh-session-per-event model with shared repo memory.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from orchestrator import Orchestrator, parse_work_item
from config import BASE_DIR, ANTHROPIC_API_KEY


WORK_ITEMS_DIR = BASE_DIR / "work_items"


async def main() -> None:
    print()
    print("=" * 60)
    print("  Agent-as-Service + Blackboard POC")
    print("  Fresh sessions per event | Shared repo memory")
    print("=" * 60)

    if not ANTHROPIC_API_KEY:
        print("\nError: ANTHROPIC_API_KEY not set.")
        print("Copy .env.example to .env and add your API key:")
        print("  cp .env.example .env")
        print("  # Edit .env with your key")
        sys.exit(1)

    work_item_files = sorted(WORK_ITEMS_DIR.glob("*.md"))
    if not work_item_files:
        print("No work items found in work_items/")
        return

    work_items = [parse_work_item(path) for path in work_item_files]

    orch = Orchestrator()

    # Shared repo memory — persists across work items
    orch.create_repo_memory()

    # Initialize git repo and worktree manager
    await orch.init_worktree_manager()

    first = work_items[0]
    orch.create_blackboard(first["id"], first["title"], first["description"])
    await orch.create_worktrees(first["id"])
    await orch.create_agents()
    orch.start_agent_tasks()
    print(f"\n[BOOT] {len(orch.agents)} agent services online, waiting for work.\n")

    results = []
    for idx, work_item in enumerate(work_items):
        result = await orch.run_work_item(
            work_item_id=work_item["id"],
            title=work_item["title"],
            description=work_item["description"],
        )
        results.append(result)

        if idx < len(work_items) - 1:
            print(f"\n--- Agents persist, posting next work item ---")
            print(f"--- Repo memory carries {orch.repo_memory.count()} entries forward ---\n")
            await asyncio.sleep(2.0)

    await orch.shutdown()

    # ── Final Summary ────────────────────────────────────────────

    print("\n" + "=" * 60)
    print("  FINAL SUMMARY")
    print("=" * 60)

    for idx, (work_item, res) in enumerate(zip(work_items, results)):
        print(f"\n  Work Item {idx + 1}: {work_item['title']}")
        print(f"    Status: {res['status']} | Time: {res['elapsed']:.0f}s | LLM calls: {res['llm_calls']}")
        print(f"    Tokens: {res['tokens_used']:,}")
        stats = res["stats"]
        print(f"    Tasks: {stats['tasks']} | Artifacts: {stats['artifacts']} | "
              f"Messages: {stats['messages']} | Decisions: {stats['decisions']} | Issues: {stats['issues']}")
        if res["recommended_follow_ups"]:
            print(f"    Follow-ups: {res['recommended_follow_ups']}")

    if len(results) >= 2:
        r1, r2 = results[0], results[1]
        if r2["llm_calls"] < r1["llm_calls"]:
            pct = (1 - r2["llm_calls"] / max(r1["llm_calls"], 1)) * 100
            print(f"\n  Memory effect: Run 2 used {pct:.0f}% fewer LLM calls than Run 1")
        else:
            print(f"\n  Note: Run 2 used {r2['llm_calls']} LLM calls vs Run 1's {r1['llm_calls']}")

    print()


if __name__ == "__main__":
    asyncio.run(main())
