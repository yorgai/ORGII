/**
 * IDE Context Collector
 *
 * Collects current IDE state from Jotai stores and returns a payload suitable
 * for passing to Tauri agent commands. Provides IDE awareness to both the
 * built-in coding agent (system prompt) and external CLI agents (user message).
 *
 * Data collected:
 * - activeFile: currently focused file in the editor
 * - openFiles: all files open in editor tabs
 * - cursorPosition: "filePath:line:column" of the active cursor
 * - gitBranch: current git branch name
 * - gitStatus: summary string ("3 modified, 1 staged, 2 untracked")
 * - gitChangedFiles: list of changed file paths
 * - linterErrors: top error/warning messages from LSP diagnostics
 *
 * Repo-scoped invariant: every atom this collector reads is global to the
 * toolbar repo (the editor opens one workspace, gitStatus is per-toolbar,
 * LSP diagnostics live in a single map keyed by the active workspace).
 * That means when a session running on repo A asks for IDE context while
 * the toolbar is pointed at repo B, the collector would otherwise leak
 * repo B's editor / git / LSP state into repo A's agent. Callers therefore
 * pass the session's persisted `repo_path` as `expectedRepoPath`; when it
 * doesn't match the toolbar repo (or no session repo is known and the
 * caller is multi-session-aware) we return `undefined` rather than ship a
 * cross-repo payload. The fallback is "no context", which is strictly
 * better than "wrong context".
 */
import type {
  UserProfileWire,
  WorkspaceSnapshot,
} from "@src/services/context/workspaceSnapshot";
import { currentGitStatusAtom } from "@src/store/git";
import { currentBranchAtom } from "@src/store/repo/atoms";
import { currentRepoAtom } from "@src/store/repo/derived";
import { settingsAtom } from "@src/store/settings";
import { globalStatusBarStateAtom } from "@src/store/ui/workStationAtom";
import { workspaceFoldersAtom } from "@src/store/ui/workspaceFoldersAtom";
import { userPresenceWireAtom } from "@src/store/user/userPresenceAtom";
import { globalLspDiagnosticsAtom } from "@src/store/workstation/codeEditor/diagnostics/globalLspDiagnosticsAtom";
import {
  activeWorkStationFilePathAtom,
  workstationLayoutAtom,
} from "@src/store/workstation/tabs";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

export type { WorkspaceSnapshot };

const MAX_OPEN_FILES = 30;
const MAX_CHANGED_FILES = 50;
const MAX_LINTER_ERRORS = 20;

export interface CollectIdeContextOptions {
  /**
   * The session's persisted repo path. When supplied, the collector verifies
   * the global repo selection points at the same path before returning data;
   * otherwise it returns `undefined` to avoid leaking a different repo's
   * editor / git / LSP state into this session's agent payload.
   *
   * Pass `null` only when the call has no associated session (e.g. the
   * session creator is launching a brand-new session and the global repo
   * selection IS the chosen repo by definition). Omitting the argument is
   * equivalent to `null` and is preserved for callers that genuinely
   * have no session affinity.
   */
  expectedRepoPath?: string | null;
}

function normalizeRepoPath(value: string | undefined | null): string | null {
  if (!value) return null;
  return value.replace(/\/+$/, "");
}

function buildUserProfileWire(
  settings: Record<string, unknown>
): UserProfileWire | undefined {
  const profile: UserProfileWire = {};

  const techSavvy = settings["general.profileTechSavvy"];
  if (typeof techSavvy === "string" && techSavvy.trim().length > 0) {
    profile.techSavvy = techSavvy as UserProfileWire["techSavvy"];
  }

  const jobRoles = settings["general.profileJobRoles"];
  if (Array.isArray(jobRoles) && jobRoles.length > 0) {
    const filteredJobRoles = jobRoles.filter(
      (role): role is string => typeof role === "string" && role.length > 0
    );
    if (filteredJobRoles.length > 0) {
      profile.jobRoles = filteredJobRoles;
    }
  }

  const familiarTechStacks = settings["general.profileFamiliarTechStacks"];
  if (Array.isArray(familiarTechStacks) && familiarTechStacks.length > 0) {
    const filteredTechStacks = familiarTechStacks.filter(
      (stack): stack is string => typeof stack === "string" && stack.length > 0
    );
    if (filteredTechStacks.length > 0) {
      profile.familiarTechStacks = filteredTechStacks;
    }
  }

  const description = settings["general.profileDescription"];
  if (typeof description === "string" && description.trim().length > 0) {
    profile.description = description.trim();
  }

  return Object.keys(profile).length > 0 ? profile : undefined;
}

export function collectIdeContext(
  options: CollectIdeContextOptions = {}
): WorkspaceSnapshot | undefined {
  try {
    const store = getInstrumentedStore();

    // Presence and profile are user-scoped, not repo-scoped, so they always
    // ride along even when the repo affinity check below trips. Resolve once
    // up front so both the cross-repo bail and the normal path can attach them.
    let presenceWire;
    let userProfile;
    try {
      presenceWire = store.get(userPresenceWireAtom);
      userProfile = buildUserProfileWire(store.get(settingsAtom));
    } catch {
      presenceWire = undefined;
      userProfile = undefined;
    }

    const expected = normalizeRepoPath(options.expectedRepoPath);
    if (expected) {
      const toolbarRepo = store.get(currentRepoAtom);
      const toolbarPath = normalizeRepoPath(
        toolbarRepo?.path ?? toolbarRepo?.fs_uri
      );
      if (toolbarPath && toolbarPath !== expected) {
        const userScopedPayload: WorkspaceSnapshot = {};
        if (presenceWire) {
          userScopedPayload.userPresence = presenceWire;
        }
        if (userProfile) {
          userScopedPayload.userProfile = userProfile;
        }
        return Object.keys(userScopedPayload).length > 0
          ? userScopedPayload
          : undefined;
      }
    }

    const payload: WorkspaceSnapshot = {};
    let hasData = false;

    // Active file
    try {
      const activeFile = store.get(activeWorkStationFilePathAtom);
      if (activeFile) {
        payload.activeFile = activeFile;
        hasData = true;
      }
    } catch {
      /* not available */
    }

    // Open files in the single main pane
    try {
      const layout = store.get(workstationLayoutAtom);
      const tabs = layout?.mainPane?.tabs ?? [];
      const seen = new Set<string>();
      const openFiles: string[] = [];
      for (const tab of tabs) {
        const fp = tab.data?.filePath;
        if (typeof fp === "string" && fp && !seen.has(fp)) {
          seen.add(fp);
          openFiles.push(fp);
          if (openFiles.length >= MAX_OPEN_FILES) break;
        }
      }
      if (openFiles.length > 0) {
        payload.openFiles = openFiles;
        hasData = true;
      }
    } catch {
      /* tabs not available */
    }

    // Cursor position (file:line:column)
    try {
      const statusBar = store.get(globalStatusBarStateAtom);
      if (statusBar.cursor && payload.activeFile) {
        payload.cursorPosition = `${payload.activeFile}:${statusBar.cursor.line}:${statusBar.cursor.column}`;
        hasData = true;
      }
    } catch {
      /* cursor not available */
    }

    // Git branch
    try {
      const branch = store.get(currentBranchAtom);
      if (branch) {
        payload.gitBranch = branch;
        hasData = true;
      }
    } catch {
      /* branch not available */
    }

    // Git status summary + changed file paths
    try {
      const status = store.get(currentGitStatusAtom);
      if (status?.working_directory) {
        const wd = status.working_directory;

        // Summary counts
        const parts: string[] = [];
        const staged = wd.staged_count ?? 0;
        const unstaged = wd.unstaged_count ?? 0;
        const untracked = wd.untracked_count ?? 0;
        if (unstaged > 0) parts.push(`${unstaged} modified`);
        if (staged > 0) parts.push(`${staged} staged`);
        if (untracked > 0) parts.push(`${untracked} untracked`);
        if (parts.length > 0) {
          payload.gitStatus = parts.join(", ");
          hasData = true;
        }

        // Changed file paths (much more useful than just counts)
        if (wd.files && wd.files.length > 0) {
          payload.gitChangedFiles = wd.files
            .slice(0, MAX_CHANGED_FILES)
            .map((file) => {
              const prefix = file.staged ? "[staged] " : "";
              return `${prefix}${file.path} (${file.status})`;
            });
          hasData = true;
        }
      }
    } catch {
      /* git status not available */
    }

    // Linter errors (top errors from LSP diagnostics)
    try {
      const diagnosticsMap = store.get(globalLspDiagnosticsAtom);
      if (diagnosticsMap.size > 0) {
        const errors: string[] = [];
        for (const [filePath, diagnostics] of diagnosticsMap) {
          for (const diag of diagnostics) {
            if (diag.severity === "error" || diag.severity === "warning") {
              errors.push(
                `${filePath}:${diag.line}:${diag.column}: ${diag.severity}: ${diag.message}`
              );
              if (errors.length >= MAX_LINTER_ERRORS) break;
            }
          }
          if (errors.length >= MAX_LINTER_ERRORS) break;
        }
        if (errors.length > 0) {
          payload.linterErrors = errors;
          hasData = true;
        }
      }
    } catch {
      /* diagnostics not available */
    }

    // Workspace folders (multi-root)
    try {
      const folders = store.get(workspaceFoldersAtom);
      if (folders.length > 0) {
        payload.workspaceFolders = folders.map((folder) => folder.path);
        hasData = true;
      }
    } catch {
      /* workspace folders not available */
    }

    // User-scoped ambient state ships on every turn even when the IDE has
    // nothing else to report. Read up front (above) so the cross-repo bail
    // path can still attach it.
    if (presenceWire) {
      payload.userPresence = presenceWire;
      hasData = true;
    }
    if (userProfile) {
      payload.userProfile = userProfile;
      hasData = true;
    }

    return hasData ? payload : undefined;
  } catch {
    return undefined;
  }
}
