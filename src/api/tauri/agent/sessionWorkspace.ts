/**
 * Agent Session Workspace API
 *
 * Frontend wrapper for the `SessionWorkspace` runtime model.
 * Each agent session owns one `SessionWorkspace` in
 * memory describing its `workspace_root`, `working_dir`, and the set of
 * additional directories (`AdditionalDirectory[]`) granted during the
 * session.
 *
 * Use these commands to:
 *  - mirror multi-root IDE workspace folders into an already-running
 *    session (add/remove) — see `useSessionWorkspaceSync`.
 *  - switch a running session into a git worktree.
 *  - inspect the workspace for debugging or slash-command-style UIs.
 *
 * Launch-time seeding (mapping `workspaceFoldersAtom` → first
 * `SessionWorkspace`) happens inside `sessionLaunch` via the
 * `additionalDirectories` field on `SessionLaunchParams`, NOT through
 * these commands.
 */
import { invokeTauri } from "@src/util/platform/tauri/init";

/**
 * Origin of an additional directory entry. Mirrors the Rust enum
 * `agent_core::session::workspace::DirectorySource` (serde
 * `rename_all = "camelCase"`).
 *
 * Frontend wiring currently only produces `"session"` — the transient
 * in-memory scope that dies with the runtime. The other variants are
 * reserved for future settings-layer and CLI-flag integrations.
 */
export type DirectorySource =
  | "session"
  | "localSettings"
  | "userSettings"
  | "cliArg";

export const DIRECTORY_SOURCE = {
  SESSION: "session",
  LOCAL_SETTINGS: "localSettings",
  USER_SETTINGS: "userSettings",
  CLI_ARG: "cliArg",
} as const satisfies Record<string, DirectorySource>;

/** One entry in `SessionWorkspaceView.additionalDirectories`. */
export interface AdditionalDirectoryView {
  path: string;
  source: DirectorySource;
}

/**
 * Full snapshot of a session's workspace. Paths are absolute and
 * canonicalised by the backend at insertion time.
 */
export interface SessionWorkspaceView {
  sessionId: string;
  workspaceRoot: string;
  workingDir: string;
  isWorktree: boolean;
  additionalDirectories: AdditionalDirectoryView[];
}

export interface WorktreeMergeResult {
  merged: boolean;
  branch: string;
  baseBranch: string;
  conflicts: string[];
  error?: string;
}

/**
 * Grant the session access to `path` in addition to its `workspace_root`.
 *
 * Returns `true` if the directory was inserted, `false` if it was
 * already present (first-writer-wins — the original `source` is kept).
 *
 * `source` defaults to `"session"` on the Rust side when omitted.
 */
export async function addSessionDirectory(
  sessionId: string,
  path: string,
  source?: DirectorySource
): Promise<boolean> {
  return invokeTauri<boolean>("agent_session_add_directory", {
    sessionId,
    path,
    source,
  });
}

/**
 * Revoke access to `path`. Returns `true` if an entry was removed,
 * `false` if it was not in the workspace. Does NOT touch
 * `workspace_root`.
 */
export async function removeSessionDirectory(
  sessionId: string,
  path: string
): Promise<boolean> {
  return invokeTauri<boolean>("agent_session_remove_directory", {
    sessionId,
    path,
  });
}

/** Switch the current running session into a git worktree. */
export async function enterSessionWorktree(
  sessionId: string,
  branch?: string
): Promise<SessionWorkspaceView> {
  return invokeTauri<SessionWorkspaceView>("agent_session_enter_worktree", {
    sessionId,
    branch,
  });
}

export async function applySessionWorktree(
  sessionId: string,
  strategy?: string
): Promise<WorktreeMergeResult> {
  return invokeTauri<WorktreeMergeResult>("agent_session_apply_worktree", {
    sessionId,
    strategy,
  });
}

export async function deleteSessionWorktree(
  sessionId: string
): Promise<SessionWorkspaceView> {
  return invokeTauri<SessionWorkspaceView>("agent_session_delete_worktree", {
    sessionId,
  });
}

/** Inspect the current workspace of a running session. */
export async function listSessionWorkspace(
  sessionId: string
): Promise<SessionWorkspaceView> {
  return invokeTauri<SessionWorkspaceView>("agent_session_list_workspaces", {
    sessionId,
  });
}
