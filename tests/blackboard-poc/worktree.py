"""
WorktreeManager: real git worktree operations for multi-agent file isolation.

Each agent gets its own git worktree (own branch, own working directory).
Code enters the main branch only through commit + rebase + fast-forward merge.

Merge flow (rebase-then-fast-forward):
  1. Agent commits changes to its branch
  2. Agent rebases on main
  3. If conflict → return conflict info → agent resolves → retry
  4. If clean → fast-forward merge to main (guaranteed conflict-free)
  5. Mutex ensures only one agent merges at a time
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from pathlib import Path


def _log_wt(msg: str) -> None:
    print(f"[worktree  ] {msg}", flush=True)


@dataclass
class ConflictInfo:
    """Returned when a rebase fails due to conflicts."""
    conflicted_files: list[str]
    conflict_markers: dict[str, str]  # file_path -> content with <<<< ==== >>>> markers


@dataclass
class MergeResult:
    success: bool
    conflict: ConflictInfo | None = None
    message: str = ""


class WorktreeManager:
    """Manages a git repository with per-agent worktrees."""

    def __init__(self, repo_root: Path):
        self.repo_root = repo_root
        self._merge_lock = asyncio.Lock()
        self._worktrees: dict[str, Path] = {}  # agent_id -> worktree path
        self._branches: dict[str, str] = {}  # agent_id -> branch name

    # ── Repository Setup ─────────────────────────────────────────

    async def init_repo(self) -> None:
        """Initialize a git repo with an initial commit on main."""
        self.repo_root.mkdir(parents=True, exist_ok=True)

        if (self.repo_root / ".git").exists():
            _log_wt(f"repo already exists at {self.repo_root}")
            return

        await self._run_git("init", "-b", "main", cwd=self.repo_root)
        await self._run_git("config", "user.email", "poc@test.local", cwd=self.repo_root)
        await self._run_git("config", "user.name", "POC", cwd=self.repo_root)

        readme = self.repo_root / "README.md"
        readme.write_text("# Multi-Agent Workspace\n")
        await self._run_git("add", ".", cwd=self.repo_root)
        await self._run_git("commit", "-m", "initial commit", cwd=self.repo_root)

        _log_wt(f"repo initialized at {self.repo_root}")

    # ── Worktree Lifecycle ───────────────────────────────────────

    async def create_worktree(self, agent_id: str, work_item_id: str) -> Path:
        """Create a git worktree for an agent. Returns worktree path."""
        branch = f"agent/wi-{work_item_id}-{agent_id}"
        wt_path = self.repo_root.parent / f"wt-{agent_id}"

        # Clean up if leftover from previous run
        if wt_path.exists():
            await self.remove_worktree(agent_id)

        await self._run_git(
            "worktree", "add", "-b", branch, str(wt_path), "main",
            cwd=self.repo_root,
        )
        await self._run_git("config", "user.email", f"{agent_id}@agent.local", cwd=wt_path)
        await self._run_git("config", "user.name", agent_id, cwd=wt_path)

        self._worktrees[agent_id] = wt_path
        self._branches[agent_id] = branch
        _log_wt(f"created worktree: {agent_id} -> {wt_path.name} (branch: {branch})")
        return wt_path

    async def remove_worktree(self, agent_id: str) -> None:
        """Remove a worktree and delete its branch."""
        wt_path = self._worktrees.get(agent_id)
        branch = self._branches.get(agent_id)

        if wt_path and wt_path.exists():
            await self._run_git(
                "worktree", "remove", "--force", str(wt_path),
                cwd=self.repo_root,
            )
            _log_wt(f"removed worktree: {agent_id}")

        if branch:
            await self._run_git(
                "branch", "-D", branch,
                cwd=self.repo_root,
                allow_fail=True,
            )

        self._worktrees.pop(agent_id, None)
        self._branches.pop(agent_id, None)

    async def remove_all_worktrees(self) -> None:
        for agent_id in list(self._worktrees.keys()):
            await self.remove_worktree(agent_id)

    def get_worktree_path(self, agent_id: str) -> Path | None:
        return self._worktrees.get(agent_id)

    # ── Git Operations ───────────────────────────────────────────

    async def has_changes(self, agent_id: str) -> bool:
        """Check if agent's worktree has uncommitted changes."""
        wt_path = self._worktrees.get(agent_id)
        if not wt_path or not wt_path.exists():
            return False
        result = await self._run_git("status", "--porcelain", cwd=wt_path)
        return bool(result.strip())

    async def commit(self, agent_id: str, message: str) -> bool:
        """Stage all and commit in agent's worktree. Returns True if committed."""
        wt_path = self._worktrees.get(agent_id)
        if not wt_path:
            return False

        if not await self.has_changes(agent_id):
            return False

        await self._run_git("add", "-A", cwd=wt_path)
        await self._run_git("commit", "-m", message, cwd=wt_path)
        _log_wt(f"[{agent_id}] committed: {message[:60]}")
        return True

    async def rebase_on_main(self, agent_id: str) -> MergeResult:
        """Rebase agent's branch on main. Returns conflict info if conflicts exist."""
        wt_path = self._worktrees.get(agent_id)
        if not wt_path or not wt_path.exists():
            return MergeResult(success=True, message="No worktree (skipped)")

        # First commit any uncommitted changes
        if await self.has_changes(agent_id):
            await self.commit(agent_id, f"auto-commit before rebase")

        returncode, stdout, stderr = await self._run_git_raw(
            "rebase", "main", cwd=wt_path,
        )

        if returncode == 0:
            _log_wt(f"[{agent_id}] rebase on main: clean")
            return MergeResult(success=True, message="clean rebase")

        # Rebase failed — check for conflicts
        conflict_info = await self._detect_conflicts(wt_path)
        if conflict_info:
            _log_wt(f"[{agent_id}] rebase CONFLICT: {conflict_info.conflicted_files}")
            return MergeResult(success=False, conflict=conflict_info, message="rebase conflict")

        # Other error
        await self._run_git("rebase", "--abort", cwd=wt_path, allow_fail=True)
        return MergeResult(success=False, message=f"rebase error: {stderr}")

    async def abort_rebase(self, agent_id: str) -> None:
        """Abort an in-progress rebase."""
        wt_path = self._worktrees.get(agent_id)
        if wt_path:
            await self._run_git("rebase", "--abort", cwd=wt_path, allow_fail=True)

    async def mark_conflicts_resolved(self, agent_id: str) -> bool:
        """After agent edits conflicted files, stage and continue rebase."""
        wt_path = self._worktrees.get(agent_id)
        if not wt_path:
            return False

        await self._run_git("add", "-A", cwd=wt_path)
        returncode, stdout, stderr = await self._run_git_raw(
            "rebase", "--continue", cwd=wt_path,
            env_override={"GIT_EDITOR": "true"},
        )
        if returncode == 0:
            _log_wt(f"[{agent_id}] conflict resolved, rebase continued")
            return True

        _log_wt(f"[{agent_id}] rebase --continue failed: {stderr}")
        return False

    async def merge_to_main(self, agent_id: str) -> MergeResult:
        """
        Rebase-then-fast-forward merge. Serialized via mutex.

        Uses git update-ref to advance main to the agent's branch tip
        without checkout, avoiding issues with worktree branch occupancy.
        """
        async with self._merge_lock:
            branch = self._branches.get(agent_id)
            wt_path = self._worktrees.get(agent_id)
            if not branch or not wt_path:
                return MergeResult(success=False, message="No branch or worktree")

            rebase_result = await self.rebase_on_main(agent_id)
            if not rebase_result.success:
                return rebase_result

            # Get the commit hash of the agent's branch tip
            agent_head = await self._run_git(
                "rev-parse", "HEAD", cwd=wt_path, allow_fail=True,
            )
            agent_head = agent_head.strip()
            if not agent_head:
                return MergeResult(success=False, message="Could not resolve agent HEAD")

            main_head = await self._run_git(
                "rev-parse", "main", cwd=self.repo_root, allow_fail=True,
            )
            main_head = main_head.strip()

            # Verify fast-forward: agent_head must be a descendant of main_head
            returncode, _, _ = await self._run_git_raw(
                "merge-base", "--is-ancestor", main_head, agent_head,
                cwd=self.repo_root,
            )
            if returncode != 0:
                _log_wt(f"[{agent_id}] not a fast-forward (main={main_head[:8]}, agent={agent_head[:8]})")
                return MergeResult(success=False, message="not a fast-forward merge")

            # Advance main ref to agent's commit (no checkout needed)
            await self._run_git(
                "update-ref", "refs/heads/main", agent_head,
                cwd=self.repo_root,
            )

            # Update repo_root working tree to match new main
            await self._run_git("checkout", "-f", "main", cwd=self.repo_root, allow_fail=True)

            _log_wt(f"[{agent_id}] merged to main (fast-forward via update-ref)")
            return MergeResult(success=True, message="merged to main")

    # ── Conflict Detection ───────────────────────────────────────

    async def _detect_conflicts(self, wt_path: Path) -> ConflictInfo | None:
        """Read conflict markers from conflicted files."""
        result = await self._run_git(
            "diff", "--name-only", "--diff-filter=U",
            cwd=wt_path, allow_fail=True,
        )
        conflicted_files = [f.strip() for f in result.strip().split("\n") if f.strip()]

        if not conflicted_files:
            return None

        conflict_markers: dict[str, str] = {}
        for file_path in conflicted_files:
            full_path = wt_path / file_path
            if full_path.exists():
                conflict_markers[file_path] = full_path.read_text()

        return ConflictInfo(
            conflicted_files=conflicted_files,
            conflict_markers=conflict_markers,
        )

    async def get_conflict_files(self, agent_id: str) -> ConflictInfo | None:
        """Get current conflict info for an agent's worktree."""
        wt_path = self._worktrees.get(agent_id)
        if not wt_path:
            return None
        return await self._detect_conflicts(wt_path)

    # ── Helpers ───────────────────────────────────────────────────

    async def get_log(self, branch: str = "main", limit: int = 10) -> str:
        result = await self._run_git(
            "log", "--oneline", f"-{limit}", branch,
            cwd=self.repo_root, allow_fail=True,
        )
        return result.strip()

    async def get_file_from_main(self, file_path: str) -> str | None:
        """Read a file from the main branch."""
        full_path = self.repo_root / file_path
        if full_path.exists():
            return full_path.read_text()
        return None

    # ── Low-level git execution ──────────────────────────────────

    async def _run_git(
        self,
        *args: str,
        cwd: Path,
        allow_fail: bool = False,
    ) -> str:
        returncode, stdout, stderr = await self._run_git_raw(*args, cwd=cwd)
        if returncode != 0 and not allow_fail:
            raise RuntimeError(f"git {' '.join(args)} failed (rc={returncode}): {stderr}")
        return stdout

    async def _run_git_raw(
        self,
        *args: str,
        cwd: Path,
        env_override: dict[str, str] | None = None,
    ) -> tuple[int, str, str]:
        env = os.environ.copy()
        env["GIT_TERMINAL_PROMPT"] = "0"
        if env_override:
            env.update(env_override)

        proc = await asyncio.create_subprocess_exec(
            "git", *args,
            cwd=str(cwd),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout_bytes, stderr_bytes = await proc.communicate()
        return (
            proc.returncode or 0,
            stdout_bytes.decode(errors="replace"),
            stderr_bytes.decode(errors="replace"),
        )
