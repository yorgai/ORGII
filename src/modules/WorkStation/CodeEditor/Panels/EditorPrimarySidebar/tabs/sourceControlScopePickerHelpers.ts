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
    summary.uncommitted_files <= 0 &&
    summary.uncommitted_additions <= 0 &&
    summary.uncommitted_deletions <= 0
  ) {
    return null;
  }

  return {
    additions: summary.uncommitted_additions,
    deletions: summary.uncommitted_deletions,
  };
}

export function diffActivityScore(
  summary?: GitWorktreeDiffSummary | null
): number {
  if (!summary) return 0;
  return (
    summary.uncommitted_additions +
    summary.uncommitted_deletions +
    summary.committed_additions +
    summary.committed_deletions
  );
}

export function formatScopePickerPath(path: string): string {
  return formatRepoPathForDisplay({ path }).displayPath;
}

export function sourceControlScopeStorageKey(repoPath: string): string {
  return normalizeDisplayPath(repoPath).replace(/\/+$/, "");
}

export function normalizeScopePath(path: string): string {
  return sourceControlScopeStorageKey(path);
}

export function resolveScopeRepoRoot(
  scope: SourceControlScope,
  repoPath: string
): string {
  return scope.kind === "worktree" ? scope.path : repoPath;
}

export function formatScopeDiffStatsTooltip(
  summary: GitWorktreeDiffSummary
): string {
  const parts: string[] = [];
  if (summary.uncommitted_additions > 0 || summary.uncommitted_deletions > 0) {
    parts.push(
      `Working tree +${summary.uncommitted_additions} -${summary.uncommitted_deletions}`
    );
  }
  if (summary.committed_additions > 0 || summary.committed_deletions > 0) {
    const base = summary.base_ref ? `since ${summary.base_ref}` : "committed";
    parts.push(
      `${base} +${summary.committed_additions} -${summary.committed_deletions}`
    );
  }
  return parts.join(" · ");
}

/** Single-line label for a scope picker row (avoids stacked title + subtitle). */
export function scopePickerRowLabel(
  kind: "main" | "worktree",
  name: string,
  branch: string
): string {
  if (kind === "main") {
    return branch ? `${name} · ${branch}` : name;
  }
  return branch || name;
}

export function scopePickerRowTitle(
  kind: "main" | "worktree",
  name: string,
  branch: string,
  path: string
): string {
  const displayPath = formatScopePickerPath(path);
  if (kind === "main") {
    return displayPath;
  }
  if (branch && branch !== name) {
    return `${name} · ${branch} · ${displayPath}`;
  }
  return `${name} · ${displayPath}`;
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

  const scopePath = normalizeScopePath(scope.path);
  const exists = worktrees.some(
    (worktree) => normalizeScopePath(worktree.path) === scopePath
  );
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

export function normalizeScopePickerQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function scopePickerEntryMatchesQuery(
  entry: { name: string; branch: string; path: string },
  query: string
): boolean {
  const normalized = normalizeScopePickerQuery(query);
  if (!normalized) return true;

  const haystack = [
    entry.name,
    entry.branch,
    worktreeFolderName(entry.path),
    formatScopePickerPath(entry.path),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalized);
}

export function filterScopePickerWorktrees<T extends ScopePickerWorktreeEntry>(
  worktrees: T[],
  query: string
): T[] {
  if (!normalizeScopePickerQuery(query)) return worktrees;

  return worktrees.filter((worktree) =>
    scopePickerEntryMatchesQuery(
      {
        name: worktreeFolderName(worktree.path),
        branch: worktree.branch,
        path: worktree.path,
      },
      query
    )
  );
}

export function mainScopeMatchesQuery(
  repoName: string,
  branchLabel: string,
  repoPath: string,
  query: string
): boolean {
  return scopePickerEntryMatchesQuery(
    { name: repoName, branch: branchLabel, path: repoPath },
    query
  );
}

export function shouldShowScopePickerSearch(worktreeCount: number): boolean {
  return worktreeCount >= 5;
}

export function extractMainWorktreeDiffSummary(
  entries: Array<{
    is_main: boolean;
    diff_summary?: GitWorktreeDiffSummary | null;
  }>
): GitWorktreeDiffSummary | null {
  return entries.find((entry) => entry.is_main)?.diff_summary ?? null;
}
