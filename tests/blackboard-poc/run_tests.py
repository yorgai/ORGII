#!/usr/bin/env python3
"""
Test runner for the Agent-as-Service + Blackboard POC.

Runs selected test scenarios, collects structured metrics,
writes JSON reports, and prints a console summary table.

Usage:
  python run_tests.py --scenario 1           # single scenario
  python run_tests.py --scenario 1 5         # memory carry-over test
  python run_tests.py --scenario 2           # conflict test
  python run_tests.py --scenario 4 --token-cap 150000  # budget test
  python run_tests.py --all                  # all scenarios
  python run_tests.py --scenario 1 --timeout 300       # custom timeout
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from orchestrator import Orchestrator, parse_work_item
from trajectory import trajectory as traj
from config import BASE_DIR, ANTHROPIC_API_KEY, DATA_DIR

WORK_ITEMS_DIR = BASE_DIR / "work_items"
REPORTS_DIR = DATA_DIR / "reports"
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

SCENARIOS: dict[int, dict] = {
    1: {
        "name": "Auth (full-stack)",
        "file": "03-user-auth.md",
        "description": "Full-stack baseline: Lead decomposes, FE+BE work in parallel, QA reviews",
    },
    2: {
        "name": "Shared Config (conflict)",
        "file": "04-shared-config.md",
        "description": "Both FE and BE write to same file — tests git conflict resolution",
    },
    3: {
        "name": "Shortcuts (FE-only)",
        "file": "05-keyboard-shortcuts.md",
        "description": "Frontend-only feature — tests agent self-exclusion",
    },
    4: {
        "name": "Budget-limited",
        "file": "03-user-auth.md",
        "description": "Same as scenario 1 but with low token_cap — tests partial completion",
        "default_token_cap": 150_000,
    },
    5: {
        "name": "Password Reset (memory)",
        "file": "06-password-reset.md",
        "description": "Extends login feature — tests memory carry-over from scenario 1",
    },
    6: {
        "name": "Stripe Checkout (high-value)",
        "file": "07-stripe-checkout.md",
        "description": "Full-stack payment integration — tests multi-agent value on complex, security-sensitive feature",
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run multi-agent POC test scenarios with metrics collection",
    )
    parser.add_argument(
        "--scenario", "-s",
        type=int, nargs="+",
        help="Scenario number(s) to run (1-5). Multiple = sequential.",
    )
    parser.add_argument(
        "--all", "-a",
        action="store_true",
        help="Run all scenarios sequentially",
    )
    parser.add_argument(
        "--timeout", "-t",
        type=float, default=None,
        help="Override timeout per work item (seconds). Default: 180",
    )
    parser.add_argument(
        "--token-cap",
        type=int, default=None,
        help="Override token cap per work item. Default: 2000000",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and validate scenarios without running (no API calls)",
    )
    return parser.parse_args()


def load_scenario(scenario_num: int) -> dict:
    if scenario_num not in SCENARIOS:
        raise ValueError(f"Unknown scenario {scenario_num}. Available: {list(SCENARIOS.keys())}")

    scenario = SCENARIOS[scenario_num]
    wi_path = WORK_ITEMS_DIR / scenario["file"]
    if not wi_path.exists():
        raise FileNotFoundError(f"Work item file not found: {wi_path}")

    work_item = parse_work_item(wi_path)
    return {
        "scenario_num": scenario_num,
        "scenario_name": scenario["name"],
        "scenario_description": scenario["description"],
        "work_item": work_item,
        "default_token_cap": scenario.get("default_token_cap"),
    }


def write_report(result: dict, scenario_num: int, run_id: str) -> Path:
    report = {
        "run_id": run_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "scenario": scenario_num,
        "scenario_name": SCENARIOS[scenario_num]["name"],
        **result,
    }

    # Strip reaction_log from per_agent for the summary report (keep it in full report)
    report_path = REPORTS_DIR / f"{run_id}-scenario-{scenario_num}.json"
    report_path.write_text(json.dumps(report, indent=2, default=str))
    return report_path


def print_summary_table(results: list[tuple[int, dict]]) -> None:
    print()
    print("=" * 95)
    print("  TEST RESULTS SUMMARY")
    print("=" * 95)

    header = (
        f"{'Scenario':<28} {'Status':<9} {'Time':>6} {'LLM':>5} "
        f"{'In Tok':>8} {'Out Tok':>8} {'Cost':>8} {'Issues':>6} {'Conflicts':>9}"
    )
    print(header)
    print("-" * 95)

    total_time = 0.0
    total_calls = 0
    total_in = 0
    total_out = 0
    total_cost = 0.0

    for scenario_num, result in results:
        name = SCENARIOS[scenario_num]["name"]
        label = f"{scenario_num}: {name}"
        status = result["status"]
        elapsed = result["elapsed"]
        llm_calls = result["llm_calls"]
        input_tok = result["input_tokens"]
        output_tok = result["output_tokens"]
        cost = result["cost_estimate_usd"]
        issues = result["blackboard"]["issues"]
        conflicts = result["conflicts"]["total"]

        total_time += elapsed
        total_calls += llm_calls
        total_in += input_tok
        total_out += output_tok
        total_cost += cost

        in_k = f"{input_tok / 1000:.0f}K" if input_tok >= 1000 else str(input_tok)
        out_k = f"{output_tok / 1000:.0f}K" if output_tok >= 1000 else str(output_tok)

        print(
            f"{label:<28} {status:<9} {elapsed:>5.0f}s {llm_calls:>5} "
            f"{in_k:>8} {out_k:>8} ${cost:>6.2f} {issues:>6} {conflicts:>9}"
        )

    print("-" * 95)

    in_total_k = f"{total_in / 1000:.0f}K" if total_in >= 1000 else str(total_in)
    out_total_k = f"{total_out / 1000:.0f}K" if total_out >= 1000 else str(total_out)
    print(
        f"{'TOTAL':<28} {'':9} {total_time:>5.0f}s {total_calls:>5} "
        f"{in_total_k:>8} {out_total_k:>8} ${total_cost:>6.2f}"
    )
    print("=" * 95)
    print()


async def main() -> None:
    args = parse_args()

    if not args.scenario and not args.all:
        print("Usage: python run_tests.py --scenario 1 [2 3 ...] | --all")
        print("\nAvailable scenarios:")
        for num, info in SCENARIOS.items():
            print(f"  {num}: {info['name']} — {info['description']}")
        return

    scenario_nums = list(SCENARIOS.keys()) if args.all else (args.scenario or [])

    # Validate all scenarios before starting
    scenarios = []
    for num in scenario_nums:
        try:
            scenarios.append(load_scenario(num))
        except (ValueError, FileNotFoundError) as exc:
            print(f"Error: {exc}")
            sys.exit(1)

    if args.dry_run:
        print("\n=== DRY RUN — no API calls ===\n")
        for scenario in scenarios:
            print(f"  Scenario {scenario['scenario_num']}: {scenario['scenario_name']}")
            print(f"    Work item: {scenario['work_item']['title']}")
            print(f"    Token cap: {args.token_cap or scenario.get('default_token_cap') or 'default'}")
        print("\n  All scenarios validated.\n")
        return

    if not ANTHROPIC_API_KEY:
        print("\nError: ANTHROPIC_API_KEY not set.")
        print("Copy .env.example to .env and add your API key.")
        sys.exit(1)

    run_id = datetime.now().strftime("%Y%m%d-%H%M%S")

    print()
    print("=" * 60)
    print("  Agent-as-Service POC — Test Runner")
    print(f"  Run ID: {run_id}")
    print(f"  Scenarios: {[s['scenario_num'] for s in scenarios]}")
    print("=" * 60)

    orch = Orchestrator()
    orch.create_repo_memory()
    await orch.init_worktree_manager()

    first_wi = scenarios[0]["work_item"]
    orch.create_blackboard(first_wi["id"], first_wi["title"], first_wi["description"])
    await orch.create_worktrees(first_wi["id"])
    await orch.create_agents()
    orch.start_agent_tasks()
    print(f"\n[BOOT] {len(orch.agents)} agent services online.\n")

    results: list[tuple[int, dict]] = []
    for idx, scenario in enumerate(scenarios):
        scenario_num = scenario["scenario_num"]
        work_item = scenario["work_item"]

        token_cap = args.token_cap or scenario.get("default_token_cap")

        import time as _time
        traj.reset(_time.time())
        traj.log("system", "system", f"Work item posted: {work_item['title']}")

        result = await orch.run_work_item(
            work_item_id=work_item["id"],
            title=work_item["title"],
            description=work_item["description"],
            timeout=args.timeout,
            token_cap=token_cap,
        )
        results.append((scenario_num, result))

        report_path = write_report(result, scenario_num, run_id)
        print(f"\n  Report saved: {report_path.name}")

        traj_path = REPORTS_DIR / f"{run_id}-scenario-{scenario_num}-trajectory.md"
        traj.save_markdown(result, traj_path)
        print(f"  Trajectory saved: {traj_path.name}")

        if idx < len(scenarios) - 1:
            mem_count = orch.repo_memory.count() if orch.repo_memory else 0
            print(f"\n--- Next scenario. Repo memory: {mem_count} entries ---\n")
            await asyncio.sleep(2.0)

    await orch.shutdown()

    print_summary_table(results)

    # Print report file locations
    print("Reports:")
    for scenario_num, _ in results:
        report_file = REPORTS_DIR / f"{run_id}-scenario-{scenario_num}.json"
        print(f"  {report_file}")
    print()


if __name__ == "__main__":
    asyncio.run(main())
