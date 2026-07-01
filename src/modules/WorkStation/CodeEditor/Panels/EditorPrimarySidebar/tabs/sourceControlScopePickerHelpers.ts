import type { GitWorktreeDiffSummary } from "@src/api/http/git/types";
import {
  formatRepoPathForDisplay,
  normalizeDisplayPath,
} from "@src/util/file/repoPathDisplay";

export type SourceControlScope =
  | { kind: "local" }
  | { kind: "worktree"; path: string };

export type SourceControlScopeMap = Record<string, SourceControlScope>;

export interface ScopePickerDiffStats {
  additions: number;
  deletions: number;
}

export interface ScopePickerWorktreeEntry {
  path: string;
  branch: string;
  diff_summary?: GitWorktreeDiffSummary | null;
}

export function diffStatsFromSummary(
  summary?: GitWorktreeDiffSummary | null
): ScopePickerDiffStats | null {
  if (!summary) return null;
  if (
    summary.total_files <= 0 &&
    summary.total_additions <= 0 &&
    summary.total_deletions <= 0
  ) {
    return null;
  }

  return {
    additions: summary.total_additions,
    deletions: summary.total_deletions,
  };
}

export function diffActivityScore(
  summary?: GitWorktreeDiffSummary | null
): number {
  const stats = diffStatsFromSummary(summary);
  if (!stats) return 0;
  return stats.additions + stats.deletions;
}

export function formatScopePickerPath(path: string): string {
  return formatRepoPathForDisplay({ path }).displayPath;
}

export function sourceControlScopeStorageKey(repoPath: string): string {
  return normalizeDisplayPath(repoPath).replace(/\/+$/, "");
}

export function readSourceControlScope(
  scopeMap: SourceControlScopeMap,
  repoPath: string
): SourceControlScope {
  return scopeMap[sourceControlScopeStorageKey(repoPath)] ?? { kind: "local" };
}

export function reconcileSourceControlScope(
  scope: SourceControlScope,
  worktrees: Array<{ path: string }>,
  options?: { worktreesReady?: boolean }
): SourceControlScope {
  if (scope.kind === "local") return scope;
  if (options?.worktreesReady === false) return scope;

  const exists = worktrees.some((worktree) => worktree.path === scope.path);
  return exists ? scope : { kind: "local" };
}

export function scopesEqual(
  left: SourceControlScope,
  right: SourceControlScope
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "local") return true;
  return right.kind === "worktree" && left.path === right.path;
}

export function sortWorktreesByDiffActivity<T extends ScopePickerWorktreeEntry>(
  worktrees: T[]
): T[] {
  return [...worktrees].sort((left, right) => {
    const scoreDelta =
      diffActivityScore(right.diff_summary) -
      diffActivityScore(left.diff_summary);
    if (scoreDelta !== 0) return scoreDelta;

    const leftLabel = left.path.split("/").pop() || left.path;
    const rightLabel = right.path.split("/").pop() || right.path;
    return leftLabel.localeCompare(rightLabel);
  });
}

export function resolveScopeBranchLabel(
  branchLabel: string,
  selectedWorktree?: Pick<ScopePickerWorktreeEntry, "branch">
): string {
  return selectedWorktree?.branch || branchLabel;
}

export function worktreeFolderName(path: string): string {
  return path.split("/").pop() || "worktree";
}

export interface ScopeBreadcrumbSegment {
  label: string;
  tone: "muted" | "primary" | "secondary";
}

/** Breadcrumb segments for the scope toolbar trigger — worktree prefix only when scoped. */
export function resolveScopeBreadcrumbSegments(options: {
  repoName: string;
  branchLabel: string;
  scope: SourceControlScope;
  selectedWorktreePath?: string;
}): ScopeBreadcrumbSegment[] {
  const { repoName, branchLabel, scope, selectedWorktreePath } = options;
  const segments: ScopeBreadcrumbSegment[] = [];

  if (scope.kind === "worktree" && selectedWorktreePath) {
    segments.push({
      label: worktreeFolderName(selectedWorktreePath),
      tone: "muted",
    });
  }

  segments.push({ label: repoName, tone: "primary" });
  segments.push({ label: branchLabel, tone: "secondary" });
  return segments;
}

export function extractMainWorktreeDiffSummary(
  entries: Array<{
    is_main: boolean;
    diff_summary?: GitWorktreeDiffSummary | null;
  }>
): GitWorktreeDiffSummary | null {
  return entries.find((entry) => entry.is_main)?.diff_summary ?? null;
}
