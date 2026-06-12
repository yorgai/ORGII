/**
 * sessionWorkspaceSyncPlan — pure diff logic for `useSessionWorkspaceSync`.
 *
 * Given the backend's canonical workspace snapshot and the IDE's current
 * multi-root folder list, compute which directories the IDE sync layer
 * should add to / remove from the running session.
 *
 * Ownership rules (the whole point of this module):
 *  - The IDE sync layer ONLY manages entries with
 *    `source === "ideWorkspace"`. Entries granted by the agent
 *    (`"session"`, e.g. via `/add-dir`) or by settings/CLI layers are
 *    NEVER eligible for removal, and a path already present under any
 *    source is never re-added.
 *  - Path comparison relies on the backend canonicalising every stored
 *    path at insertion time — snapshot paths are compared with plain
 *    string equality. IDE-side paths only get trailing-slash trimming
 *    as input hygiene before being compared or sent.
 */
import {
  type AdditionalDirectoryView,
  DIRECTORY_SOURCE,
} from "@src/api/tauri/agent/sessionWorkspace";

/** Input-hygiene trim applied to IDE-side paths before compare/send. */
export function trimTrailingSlashes(path: string): string {
  return path.replace(/\/+$/, "");
}

export interface WorkspaceSyncPlanInput {
  /** Canonical workspace root from the backend snapshot. */
  workspaceRoot: string;
  /** Canonical additional directories from the backend snapshot. */
  additionalDirectories: readonly AdditionalDirectoryView[];
  /** Raw folder paths from `workspaceFoldersAtom` (any normalisation state). */
  ideFolderPaths: readonly string[];
  /**
   * Paths whose `add` previously returned `false` (already present on
   * the backend under a canonical alias, e.g. a symlinked IDE path).
   * Skipped to avoid re-issuing no-op adds on every run. Callers must
   * evict a path from this set once it leaves the IDE folder list.
   */
  suppressedAdds?: ReadonlySet<string>;
}

export interface WorkspaceSyncPlan {
  /**
   * True when the session's `workspaceRoot` is not among the IDE
   * folders — the session is detached from this window's workspace and
   * must not be synced (matches launch-time policy in `useSessionLaunch`).
   */
  detached: boolean;
  /** IDE folder paths to grant via `addSessionDirectory(source: "ideWorkspace")`. */
  toAdd: string[];
  /** Canonical backend paths (ideWorkspace-sourced only) to revoke. */
  toRemove: string[];
}

export function computeWorkspaceSyncPlan(
  input: WorkspaceSyncPlanInput
): WorkspaceSyncPlan {
  const { workspaceRoot, additionalDirectories, suppressedAdds } = input;

  const idePaths = input.ideFolderPaths
    .map(trimTrailingSlashes)
    .filter((path) => path.length > 0);

  // `workspaceRoot` is canonical (no trailing slash), but trim
  // defensively so the comparison cannot break on backend formatting.
  const canonicalRoot = trimTrailingSlashes(workspaceRoot);

  if (!idePaths.includes(canonicalRoot)) {
    return { detached: true, toAdd: [], toRemove: [] };
  }

  const desired = new Set(idePaths.filter((path) => path !== canonicalRoot));

  // Paths the backend already knows about under ANY source. Adding one
  // of these would be a first-writer-wins no-op at best, and must never
  // happen for agent-granted (`"session"`) entries.
  const present = new Set(additionalDirectories.map((entry) => entry.path));

  const managedByIde = new Set(
    additionalDirectories
      .filter((entry) => entry.source === DIRECTORY_SOURCE.IDE_WORKSPACE)
      .map((entry) => entry.path)
  );

  const toAdd: string[] = [];
  for (const path of desired) {
    if (present.has(path)) continue;
    if (suppressedAdds?.has(path)) continue;
    toAdd.push(path);
  }

  const toRemove: string[] = [];
  for (const path of managedByIde) {
    if (!desired.has(path)) toRemove.push(path);
  }

  return { detached: false, toAdd, toRemove };
}

/**
 * Paths of non-IDE-managed entries (anything except `"ideWorkspace"`),
 * sorted for stable change detection. Used to log agent/settings-driven
 * workspace changes for debugging without mirroring them into UI state.
 */
export function nonIdeManagedPaths(
  additionalDirectories: readonly AdditionalDirectoryView[]
): string[] {
  return additionalDirectories
    .filter((entry) => entry.source !== DIRECTORY_SOURCE.IDE_WORKSPACE)
    .map((entry) => `${entry.source}:${entry.path}`)
    .sort();
}
