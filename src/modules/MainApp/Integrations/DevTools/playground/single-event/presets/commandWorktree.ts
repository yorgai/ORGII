import type { StatusPreset } from "../../types";

export const commandWorktreePresets: Record<string, StatusPreset[]> = {
  add: [
    {
      key: "completed",
      label: "Created new worktree",
      status: "completed",
      argsPatch: {
        action: "add",
        branch: "feature/auth-refactor",
        base_ref: "main",
      },
      resultPatch: {
        success: true,
        reused: false,
        branch: "feature/auth-refactor",
        path: "/Users/developer/projects/orgii/.orgii/worktrees/feature/auth-refactor",
        base: "main",
        content:
          "Created worktree at `/Users/developer/projects/orgii/.orgii/worktrees/feature/auth-refactor`\nBranch: `feature/auth-refactor`\nBase: `main`\n\nAll file operations now target this worktree. Use `leave` to return.",
      },
    },
    {
      key: "reused",
      label: "Switched to existing worktree",
      status: "completed",
      argsPatch: {
        action: "add",
        branch: "fix/memory-leak",
        base_ref: undefined,
      },
      resultPatch: {
        success: true,
        reused: true,
        branch: "fix/memory-leak",
        path: "/Users/developer/projects/orgii/.orgii/worktrees/fix/memory-leak",
        base: "HEAD",
        content:
          "Switched to existing worktree at `/Users/developer/projects/orgii/.orgii/worktrees/fix/memory-leak`\nBranch: `fix/memory-leak`",
      },
    },
    {
      key: "running",
      label: "Running",
      status: "running",
      argsPatch: {
        action: "add",
        branch: "refactor/session-api",
        base_ref: "main",
      },
      resultPatch: { success: undefined, content: undefined },
    },
    {
      key: "failed-already-in",
      label: "Failed (already in a worktree)",
      status: "failed",
      argsPatch: {
        action: "add",
        branch: "feature/new-branch",
        base_ref: "main",
      },
      resultPatch: {
        success: false,
        content: "Already in a worktree. Leave first before adding another.",
      },
    },
    {
      key: "failed-git-error",
      label: "Failed (invalid git reference)",
      status: "failed",
      argsPatch: {
        action: "add",
        branch: "feature/conflict-branch",
        base_ref: "nonexistent-ref",
      },
      resultPatch: {
        success: false,
        content:
          "git worktree add failed: fatal: invalid reference: nonexistent-ref",
      },
    },
  ],
  leave: [
    {
      key: "completed",
      label: "Left worktree",
      status: "completed",
      argsPatch: {
        action: "leave",
        remove: false,
      },
      resultPatch: {
        success: true,
        removed: false,
        branch: "feature/auth-refactor",
        path: "/Users/developer/projects/orgii/.orgii/worktrees/feature/auth-refactor",
        content:
          "Left worktree `/Users/developer/projects/orgii/.orgii/worktrees/feature/auth-refactor`\nReturned to `/Users/developer/projects/orgii`",
      },
    },
    {
      key: "removed",
      label: "Removed worktree",
      status: "completed",
      argsPatch: {
        action: "leave",
        remove: true,
      },
      resultPatch: {
        success: true,
        removed: true,
        branch: "fix/memory-leak",
        path: "/Users/developer/projects/orgii/.orgii/worktrees/fix/memory-leak",
        content:
          "Left worktree `/Users/developer/projects/orgii/.orgii/worktrees/fix/memory-leak`\nReturned to `/Users/developer/projects/orgii`\nRemoved worktree directory.",
      },
    },
    {
      key: "running",
      label: "Running",
      status: "running",
      argsPatch: {
        action: "leave",
        remove: true,
      },
      resultPatch: { success: undefined, content: undefined },
    },
    {
      key: "failed",
      label: "Failed (no active worktree)",
      status: "failed",
      argsPatch: {
        action: "leave",
        remove: false,
      },
      resultPatch: {
        success: false,
        content: "Not currently in a worktree.",
      },
    },
    {
      key: "remove-warning",
      label: "Left worktree (removal failed)",
      status: "completed",
      argsPatch: {
        action: "leave",
        remove: true,
      },
      resultPatch: {
        success: true,
        removed: false,
        branch: "feature/wip",
        path: "/Users/developer/projects/orgii/.orgii/worktrees/feature/wip",
        content:
          "Left worktree `/Users/developer/projects/orgii/.orgii/worktrees/feature/wip`\nReturned to `/Users/developer/projects/orgii`\nWarning: Failed to remove worktree: fatal: cannot remove a dirty working tree; use --force to override",
      },
    },
  ],
  list: [
    {
      key: "completed",
      label: "Listed worktrees (3)",
      status: "completed",
      argsPatch: { action: "list" },
      resultPatch: {
        success: true,
        count: 3,
        entries: [
          { path: "/Users/developer/projects/orgii", branch: "main" },
          {
            path: "/Users/developer/projects/orgii/.orgii/worktrees/feature/auth-refactor",
            branch: "feature/auth-refactor",
          },
          {
            path: "/Users/developer/projects/orgii/.orgii/worktrees/fix/memory-leak",
            branch: "fix/memory-leak",
          },
        ],
        content: [
          "**Worktrees (3):**",
          "- `/Users/developer/projects/orgii` (branch: main)",
          "- `/Users/developer/projects/orgii/.orgii/worktrees/feature/auth-refactor` (branch: feature/auth-refactor)",
          "- `/Users/developer/projects/orgii/.orgii/worktrees/fix/memory-leak` (branch: fix/memory-leak)",
        ].join("\n"),
      },
    },
    {
      key: "single",
      label: "Listed worktrees (1)",
      status: "completed",
      argsPatch: { action: "list" },
      resultPatch: {
        success: true,
        count: 1,
        entries: [{ path: "/Users/developer/projects/orgii", branch: "main" }],
        content:
          "**Worktrees (1):**\n- `/Users/developer/projects/orgii` (branch: main)",
      },
    },
    {
      key: "running",
      label: "Running",
      status: "running",
      argsPatch: { action: "list" },
      resultPatch: { success: undefined, content: undefined },
    },
    {
      key: "failed",
      label: "Failed (not a repo)",
      status: "failed",
      argsPatch: { action: "list" },
      resultPatch: {
        success: false,
        content:
          "git worktree list failed: fatal: not a git repository (or any of the parent directories): .git",
      },
    },
  ],
};
