#!/usr/bin/env python3
"""
Dry-run tests: validates Agent-as-Service architecture components
without making any LLM API calls.

Tests cover:
  1. Blackboard pub/sub with IDs and compaction
  2. Shared repo memory with auto-capture and passive recall
  3. Blackboard token tracking and budget exhaustion
  4. Agent done tracking with ALL_DONE event
  5. Real git worktree lifecycle (create, commit, merge, remove)
  6. Real git conflict detection and resolution
  7. Blackboard persistence with new fields
  8. Reset for new work item
  9. Memory eviction at max size
"""

from __future__ import annotations

import asyncio
import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from blackboard import Blackboard, EventType
from memory import RepoMemory
from worktree import WorktreeManager
from config import BLACKBOARD_DIR


async def test_blackboard_pubsub_with_ids() -> None:
    print("--- Test 1: Blackboard pub/sub with IDs ---")
    bb = Blackboard("test-1", "Test Work Item", "Description here")

    q_lead = bb.subscribe("lead")
    q_fe = bb.subscribe("frontend")
    q_be = bb.subscribe("backend")

    bb.post_work_item()
    assert q_lead.qsize() == 1, f"Expected 1, got {q_lead.qsize()}"
    assert q_fe.qsize() == 1
    assert q_be.qsize() == 1

    event = q_lead.get_nowait()
    assert event.event_type == EventType.NEW_WORK_ITEM
    assert event.event_id.startswith("evt-")
    print(f"  work_item event: id={event.event_id}")

    # Post task — should have auto-generated ID
    task = bb.post_task("lead", "Implement toggle", "frontend", "Build dark mode toggle")
    assert task["id"].startswith("task-"), f"Expected task- prefix, got {task['id']}"
    assert task["assigned_to"] == "frontend"
    assert task["status"] == "pending"
    print(f"  task created: id={task['id']}, assigned_to={task['assigned_to']}")

    # Post artifact with related_task_id
    artifact = bb.post_artifact("frontend", "DarkMode.tsx", "Toggle component", "src/DarkMode.tsx", task["id"])
    assert artifact["id"].startswith("art-")
    assert artifact["related_task_id"] == task["id"]
    print(f"  artifact created: id={artifact['id']}, related_task={artifact['related_task_id']}")

    # Post message with reply_to
    msg1 = bb.post_message("frontend", "Need API endpoint", to_agent="backend")
    msg2 = bb.post_message("backend", "API ready at /api/theme", to_agent="frontend", reply_to=msg1["id"])
    assert msg2["reply_to"] == msg1["id"]
    print(f"  threaded messages: {msg1['id']} -> {msg2['id']}")

    # Post decision with related_task_id
    decision = bb.post_decision("lead", "Use CSS variables", "Better browser support", task["id"])
    assert decision["related_task_id"] == task["id"]
    print(f"  decision: id={decision['id']}")

    # Post issue with related_artifact_id
    issue = bb.post_issue("qa", "Missing border", "No border on toggle", "medium", artifact["id"])
    assert issue["related_artifact_id"] == artifact["id"]
    print(f"  issue: id={issue['id']}, related_artifact={issue['related_artifact_id']}")

    print(f"  Stats: {bb.get_stats()}")
    print("  PASSED\n")


async def test_shared_repo_memory() -> None:
    print("--- Test 2: Shared repo memory ---")
    with tempfile.TemporaryDirectory() as tmpdir:
        persist_path = Path(tmpdir) / "repo_memory.json"
        mem = RepoMemory(persist_path)

        # Auto-capture from different agents
        mem.auto_capture("Wrote DarkMode.tsx (45 lines)", "src/DarkMode.tsx", "frontend")
        mem.auto_capture("Wrote theme-api.ts (30 lines)", "src/api/theme.ts", "backend")
        mem.auto_capture("Decision: Use CSS variables for theming", "(decision)", "lead",
                         action_type="decision", importance=8.0)
        assert mem.count() == 3
        print(f"  Auto-captured {mem.count()} entries from 3 agents")

        # Annotate (supplemental)
        mem.annotate(
            summary="CSS variables are more maintainable than SCSS for theming",
            rationale="SCSS requires compilation, CSS vars are native",
            citations=[{"file_path": "src/DarkMode.tsx", "symbol": "ThemeToggle"}],
            source_agent="frontend",
        )
        assert mem.count() == 4
        print(f"  Annotated: total {mem.count()} entries")

        # Passive recall — should score relevant entries higher
        recalled = mem.passive_recall("dark mode CSS theme toggle", "qa", limit=3)
        assert len(recalled) > 0
        print(f"  Passive recall for 'dark mode CSS theme toggle': {len(recalled)} entries")
        for entry in recalled:
            print(f"    [{entry.action_type}:{entry.source_agent}] {entry.summary[:60]}")

        # Active recall with file filter
        results = mem.active_recall("theme", files=["src/api/"])
        assert any("theme" in e.summary.lower() for e in results)
        print(f"  Active recall 'theme' filtered to src/api/: {len(results)} entries")

        # Persistence
        mem.save_to_disk()
        mem2 = RepoMemory(persist_path)
        count = mem2.load_from_disk()
        assert count == 4
        print(f"  Persisted and loaded {count} entries")

    print("  PASSED\n")


async def test_blackboard_compaction() -> None:
    print("--- Test 3: Blackboard compaction ---")
    bb = Blackboard("test-compact", "Compaction Test", "Test compaction rules")
    bb.subscribe("agent-a")

    # Add complete task — should be compacted
    task = bb.post_task("lead", "Build toggle", "frontend", "Full description here")
    bb.update_task("frontend", task["id"], "complete", "All done")

    # Add pending task — should stay full
    pending_task = bb.post_task("lead", "Build settings", "backend", "Another description")

    # Add 20 messages — older ones should be summarized
    for idx in range(20):
        bb.post_message("frontend", f"Message {idx}", to_agent="backend")

    # Add resolved issue — should be compacted
    bb.post_issue("qa", "Fixed bug", "Was broken", "low")
    bb.issues[0]["resolved"] = True

    # Add unresolved issue — should stay full
    bb.post_issue("qa", "Open bug", "Still broken", "high")

    # Add decision — always full
    bb.post_decision("lead", "Use React", "Team knows React")

    compacted = bb.read_compacted()

    # Completed task should be compacted (no description)
    completed_tasks = [t for t in compacted["tasks"] if t["status"] == "complete"]
    assert len(completed_tasks) == 1
    assert "description" not in completed_tasks[0]
    print(f"  Completed task compacted: {completed_tasks[0]}")

    # Pending task should have full description
    pending_tasks = [t for t in compacted["tasks"] if t["status"] == "pending"]
    assert len(pending_tasks) == 1
    assert "description" in pending_tasks[0]
    print(f"  Pending task kept full: has description")

    # Messages: first should be summary
    assert compacted["messages"][0]["id"] == "summary"
    assert len(compacted["messages"]) == 16  # 1 summary + 15 recent
    print(f"  Messages compacted: {len(compacted['messages'])} entries (1 summary + 15 recent)")

    # Resolved issue should be compacted
    resolved = [i for i in compacted["issues"] if i.get("resolved")]
    assert len(resolved) == 1
    assert "description" not in resolved[0]
    print(f"  Resolved issue compacted: {resolved[0]}")

    # Decisions always full
    assert len(compacted["decisions"]) == 1
    assert "rationale" in compacted["decisions"][0]
    print(f"  Decision kept full: has rationale")

    # Artifacts compacted to summary
    assert all("summary" in a for a in compacted["artifacts"])
    print(f"  Artifacts compacted to summaries")

    print("  PASSED\n")


async def test_token_tracking() -> None:
    print("--- Test 4: Token tracking and budget ---")
    bb = Blackboard("test-budget", "Budget Test", "Test budget cap", token_cap=1000)
    bb.subscribe("agent-a")

    assert not bb.is_budget_exhausted()

    bb.add_tokens(500)
    assert bb.tokens_used == 500
    assert not bb.is_budget_exhausted()
    print(f"  Added 500 tokens: {bb.tokens_used}/{bb.token_cap}")

    bb.add_tokens(600)
    assert bb.tokens_used == 1100
    assert bb.is_budget_exhausted()
    print(f"  Added 600 more: {bb.tokens_used}/{bb.token_cap} — exhausted: {bb.is_budget_exhausted()}")

    # Budget exhaustion should park pending tasks
    bb.post_task("lead", "Task A", "frontend", "Description")
    bb.post_task("lead", "Task B", "backend", "Description")
    bb.notify_budget_exhausted()
    assert bb.status == "partial"
    parked = [t for t in bb.tasks if t["status"] == "parked"]
    assert len(parked) == 2
    assert len(bb.recommended_follow_ups) == 2
    print(f"  Budget exhausted: {len(parked)} tasks parked, {len(bb.recommended_follow_ups)} follow-ups")

    print("  PASSED\n")


async def test_done_tracking() -> None:
    print("--- Test 5: Agent done tracking ---")
    bb = Blackboard("test-done", "Done Test", "Test")
    q1 = bb.subscribe("agent-1")
    q2 = bb.subscribe("agent-2")

    bb.mark_agent_done("agent-1", "Finished my work")
    assert "agent-1" in bb._done_agents
    assert q2.qsize() == 1  # message posted

    bb.mark_agent_done("agent-2", "Also finished")
    found_all_done = False
    while not q1.empty():
        evt = q1.get_nowait()
        if evt.event_type == EventType.ALL_DONE:
            found_all_done = True
            assert evt.event_id.startswith("evt-")
    assert found_all_done, "Expected ALL_DONE event"
    print("  ALL_DONE event emitted with proper event_id")
    print("  PASSED\n")


async def test_git_worktree_lifecycle() -> None:
    print("--- Test 6: Real git worktree lifecycle ---")
    with tempfile.TemporaryDirectory() as tmpdir:
        repo_root = Path(tmpdir) / "repo"
        mgr = WorktreeManager(repo_root)

        # Init repo
        await mgr.init_repo()
        assert (repo_root / ".git").exists()
        print(f"  Git repo initialized at {repo_root.name}/")

        # Create worktrees
        fe_path = await mgr.create_worktree("frontend", "wi-01")
        be_path = await mgr.create_worktree("backend", "wi-01")
        assert fe_path.exists()
        assert be_path.exists()
        assert (fe_path / ".git").exists()  # worktree has .git file (not dir)
        print(f"  Worktrees: frontend={fe_path.name}, backend={be_path.name}")

        # Frontend writes and commits
        (fe_path / "DarkMode.tsx").write_text("export const DarkMode = () => {};")
        await mgr.commit("frontend", "add DarkMode component")
        print(f"  Frontend committed DarkMode.tsx")

        # Merge frontend to main
        result = await mgr.merge_to_main("frontend")
        assert result.success, f"Merge failed: {result.message}"
        print(f"  Frontend merged to main: {result.message}")

        # Verify file exists on main
        assert (repo_root / "DarkMode.tsx").exists()
        print(f"  DarkMode.tsx visible on main branch")

        # Backend rebases — should now see DarkMode.tsx
        rebase_result = await mgr.rebase_on_main("backend")
        assert rebase_result.success
        assert (be_path / "DarkMode.tsx").exists()
        content = (be_path / "DarkMode.tsx").read_text()
        assert "DarkMode" in content
        print(f"  Backend rebased: sees DarkMode.tsx from main")

        # Backend writes its own file and merges
        (be_path / "api.ts").write_text("export function getTheme() { return 'dark'; }")
        await mgr.commit("backend", "add theme API")
        result = await mgr.merge_to_main("backend")
        assert result.success
        assert (repo_root / "api.ts").exists()
        print(f"  Backend merged api.ts to main")

        # Verify git log shows both commits
        log = await mgr.get_log(limit=5)
        assert "DarkMode" in log
        assert "theme API" in log
        print(f"  Git log:\n    {log.replace(chr(10), chr(10) + '    ')}")

        # Cleanup
        await mgr.remove_all_worktrees()
        assert not fe_path.exists()
        assert not be_path.exists()
        print(f"  Worktrees cleaned up")

    print("  PASSED\n")


async def test_git_conflict_detection_and_resolution() -> None:
    print("--- Test 7: Real git conflict detection and resolution ---")
    with tempfile.TemporaryDirectory() as tmpdir:
        repo_root = Path(tmpdir) / "repo"
        mgr = WorktreeManager(repo_root)
        await mgr.init_repo()

        fe_path = await mgr.create_worktree("frontend", "wi-02")
        be_path = await mgr.create_worktree("backend", "wi-02")

        # Both agents write to the SAME file with different content
        shared_file = "shared-config.ts"

        # Frontend writes version A
        (fe_path / shared_file).write_text(
            'export const config = {\n  theme: "dark",\n  lang: "en"\n};\n'
        )
        await mgr.commit("frontend", "frontend: set theme config")
        print(f"  Frontend wrote {shared_file} (theme: dark)")

        # Backend writes version B (different content, same file)
        (be_path / shared_file).write_text(
            'export const config = {\n  theme: "light",\n  api: "/api/v2"\n};\n'
        )
        await mgr.commit("backend", "backend: set api config")
        print(f"  Backend wrote {shared_file} (theme: light, api: /api/v2)")

        # Frontend merges first — should succeed
        result = await mgr.merge_to_main("frontend")
        assert result.success, f"Frontend merge failed: {result.message}"
        print(f"  Frontend merged to main first: OK")

        # Backend tries to merge — should CONFLICT
        result = await mgr.merge_to_main("backend")
        assert not result.success, "Expected conflict!"
        assert result.conflict is not None
        assert shared_file in result.conflict.conflicted_files
        print(f"  Backend merge CONFLICT detected: {result.conflict.conflicted_files}")

        # Verify conflict markers exist in the file
        conflict_content = result.conflict.conflict_markers[shared_file]
        assert "<<<<<<" in conflict_content
        assert "======" in conflict_content
        assert ">>>>>>>" in conflict_content
        print(f"  Conflict markers present in {shared_file}")

        # Print the actual conflict content for debugging visibility
        print(f"  --- Conflict content ---")
        for line in conflict_content.split("\n"):
            print(f"    {line}")
        print(f"  --- End conflict ---")

        # Manually resolve the conflict (simulate what LLM would do)
        resolved_content = (
            'export const config = {\n'
            '  theme: "dark",\n'
            '  lang: "en",\n'
            '  api: "/api/v2"\n'
            '};\n'
        )
        (be_path / shared_file).write_text(resolved_content)
        print(f"  Resolved conflict manually (merged both changes)")

        # Mark resolved and continue rebase
        resolved = await mgr.mark_conflicts_resolved("backend")
        assert resolved, "Failed to continue rebase after resolution"
        print(f"  Rebase continued after conflict resolution")

        # Now merge should succeed
        result = await mgr.merge_to_main("backend")
        assert result.success, f"Post-resolution merge failed: {result.message}"
        print(f"  Backend merged to main after conflict resolution: OK")

        # Verify final content on main
        final_content = (repo_root / shared_file).read_text()
        assert '"dark"' in final_content
        assert '"/api/v2"' in final_content
        assert '"en"' in final_content
        print(f"  Final content on main contains both changes")

        # Verify no conflict markers remain
        assert "<<<<<<" not in final_content
        assert "======" not in final_content
        print(f"  No conflict markers in final content")

        await mgr.remove_all_worktrees()

    print("  PASSED\n")


async def test_blackboard_persistence() -> None:
    print("--- Test 8: Blackboard persistence with new fields ---")
    persist_path = BLACKBOARD_DIR / "test-persist-v2.json"
    bb = Blackboard(
        "test-persist-v2", "Persist Test", "Test",
        persist_path=persist_path, token_cap=5000,
    )
    bb.subscribe("agent-a")

    bb.add_tokens(1234)
    task = bb.post_task("lead", "Build it", "frontend", "Detailed description")
    artifact = bb.post_artifact("frontend", "test.tsx", "const x = 1;", "src/test.tsx", task["id"])
    bb.post_decision("lead", "Use TypeScript", "Type safety", task["id"])
    bb.post_issue("qa", "Missing test", "Need unit test", "low", artifact["id"])
    msg = bb.post_message("frontend", "Done!", to_agent="lead")
    bb.post_message("lead", "Great!", to_agent="frontend", reply_to=msg["id"])

    assert persist_path.exists()
    data = json.loads(persist_path.read_text())

    assert data["status"] == "running"
    assert data["tokens_used"] == 1234
    assert data["token_cap"] == 5000
    assert data["tasks"][0]["id"].startswith("task-")
    assert data["artifacts"][0]["related_task_id"] == task["id"]
    assert data["issues"][0]["related_artifact_id"] == artifact["id"]
    assert data["messages"][1]["reply_to"] == msg["id"]

    print(f"  Persisted with status, tokens, IDs, and related fields")
    print(f"  Keys: {list(data.keys())}")

    persist_path.unlink(missing_ok=True)
    print("  PASSED\n")


async def test_reset_for_new_work_item() -> None:
    print("--- Test 9: Reset for new work item ---")
    bb = Blackboard("test-reset", "Reset Test", "Test", token_cap=5000)
    bb.subscribe("agent-a")

    bb.add_tokens(2000)
    bb.post_task("lead", "Old task", "frontend", "Old description")
    bb.post_artifact("frontend", "old.tsx", "old code")
    bb.post_message("frontend", "old message")
    bb.status = "partial"

    bb.reset_for_new_work_item()

    assert bb.tokens_used == 0
    assert bb.status == "running"
    assert len(bb.tasks) == 0
    assert len(bb.artifacts) == 0
    assert len(bb.messages) == 0
    assert len(bb.recommended_follow_ups) == 0
    print(f"  Reset: tokens=0, status=running, all sections cleared")
    print("  PASSED\n")


async def test_memory_eviction() -> None:
    print("--- Test 10: Memory eviction at max size ---")
    with tempfile.TemporaryDirectory() as tmpdir:
        persist_path = Path(tmpdir) / "test_eviction.json"
        mem = RepoMemory(persist_path)

        # Override max for testing
        import memory as mem_module
        original_max = mem_module.MEMORY_MAX_ENTRIES
        mem_module.MEMORY_MAX_ENTRIES = 5

        for idx in range(7):
            mem.auto_capture(f"Entry {idx}", f"file_{idx}.ts", "agent-a", importance=float(idx))

        assert mem.count() == 5, f"Expected 5, got {mem.count()}"
        entry_summaries = [e.summary for e in mem.entries]
        assert "Entry 0" not in entry_summaries  # lowest importance evicted first
        print(f"  Eviction works: 7 added, {mem.count()} kept (lowest importance evicted)")

        mem_module.MEMORY_MAX_ENTRIES = original_max

    print("  PASSED\n")


async def main() -> None:
    print("\n=== Agent-as-Service POC Dry-Run Tests ===\n")
    await test_blackboard_pubsub_with_ids()
    await test_shared_repo_memory()
    await test_blackboard_compaction()
    await test_token_tracking()
    await test_done_tracking()
    await test_git_worktree_lifecycle()
    await test_git_conflict_detection_and_resolution()
    await test_blackboard_persistence()
    await test_reset_for_new_work_item()
    await test_memory_eviction()
    print("=== All 10 tests passed ===\n")


if __name__ == "__main__":
    asyncio.run(main())
