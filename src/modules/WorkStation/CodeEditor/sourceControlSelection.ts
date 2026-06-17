import type { WorkStationTab } from "@src/store/workstation/tabs/types";
import type { GitFile } from "@src/types/git/types";

export interface ResolvedGitDiffSelection {
  /** Repo root the file belongs to (worktree-aware), falling back to host repo. */
  effectiveRepoPath: string;
  /** Absolute on-disk path for the selected file. */
  absolutePath: string;
  /** Path relative to `effectiveRepoPath`, used as the git-diff cache key. */
  relativePath: string;
  /** Whether the active tab is the Source Control "all changes" view. */
  isAllChangesView: boolean;
}

/**
 * Pure resolver for a Source Control sidebar file selection. Extracted from
 * `useSourceControlSetup.handleDiffSidebarFileSelect` so the path math and the
 * all-changes detection can be unit-tested without React.
 */
export function resolveGitDiffSelection(
  file: GitFile,
  repoPath: string,
  activeTab: WorkStationTab | undefined | null
): ResolvedGitDiffSelection {
  const effectiveRepoPath = file.repoRoot ?? repoPath;
  const absolutePath = file.path.startsWith("/")
    ? file.path
    : `${effectiveRepoPath}/${file.path}`;
  const relativePath = file.path.startsWith(effectiveRepoPath)
    ? file.path.slice(effectiveRepoPath.length + 1)
    : file.path;

  const isAllChangesView =
    activeTab?.type === "source-control" &&
    activeTab.data.mode === "all-changes";

  return { effectiveRepoPath, absolutePath, relativePath, isAllChangesView };
}
