/**
 * Accumulated Commit Pool + Fetch Helpers
 *
 * Module-level pool of fetched commits per repo. When the user switches to
 * a narrower range (3m → 1m), commits are filtered from pool (instant).
 * Expanding (1m → 3m) fetches only the delta.
 *
 * Also provides buildStatsEntry for converting CommitDiffResult → CommitStatsEntry.
 */
import { getGitCommits } from "@src/api/http/git/commits";
import { getGitCommitDiff } from "@src/api/http/git/diff";
import type { GitCommitInfo } from "@src/api/http/git/types";

import type { CommitStatsEntry } from "./types";

// ============================================
// Merge Detection
// ============================================

/** Merge commits have >1 parent — their diffs double-count changes already in individual commits. */
export function isMergeCommit(commit: GitCommitInfo): boolean {
  return commit.parent_shas.length > 1;
}

// ============================================
// Commit Pool
// ============================================

interface CommitPool {
  commits: GitCommitInfo[];
  maxDays: number;
}

const MAX_POOLS = 5;
const FETCH_PAGE_SIZE = 500;

export const commitPools = new Map<string, CommitPool>();

export function getPoolKey(repoPath: string, repoId: string): string {
  return `${repoPath}::${repoId}`;
}

function filterCommitsByDays(
  commits: GitCommitInfo[],
  days: number
): GitCommitInfo[] {
  const cutoffMs = Date.now() - days * 86_400_000;
  return commits.filter(
    (commit) => new Date(commit.author?.date ?? 0).getTime() >= cutoffMs
  );
}

/**
 * Fetches commits for a given range, using the accumulated commit pool.
 * - If we already fetched a >= range for this repo, filters from pool (instant).
 * - Otherwise, fetches only the delta (older commits we don't have yet).
 */
export async function fetchCommitsForRange(
  repoPath: string,
  repoId: string,
  days: number,
  onProgress?: (commits: GitCommitInfo[]) => void
): Promise<GitCommitInfo[]> {
  const poolKey = getPoolKey(repoPath, repoId);
  const pool = commitPools.get(poolKey);

  if (pool && pool.maxDays >= days) {
    return filterCommitsByDays(pool.commits, days);
  }

  const cutoffMs = Date.now() - days * 86_400_000;
  const existingCommits = pool?.commits ?? [];
  const skipCount = existingCommits.length;

  const newCommits: GitCommitInfo[] = [];
  let skip = skipCount;
  let keepFetching = true;

  while (keepFetching) {
    const result = await getGitCommits({
      repo_id: repoId,
      repo_path: repoPath,
      limit: FETCH_PAGE_SIZE,
      skip,
    });

    if (!result?.commits || result.commits.length === 0) break;

    for (const commit of result.commits) {
      const commitMs = new Date(commit.author?.date ?? 0).getTime();
      if (commitMs < cutoffMs) {
        keepFetching = false;
        break;
      }
      newCommits.push(commit);
    }

    skip += result.commits.length;
    const hasMorePages = result.commits.length >= FETCH_PAGE_SIZE;
    if (!hasMorePages) break;

    if (onProgress) {
      onProgress(
        filterCommitsByDays([...existingCommits, ...newCommits], days)
      );
    }
  }

  const allCommits = [...existingCommits, ...newCommits];

  if (!commitPools.has(poolKey) && commitPools.size >= MAX_POOLS) {
    const first = commitPools.keys().next().value;
    if (first) commitPools.delete(first);
  }
  commitPools.set(poolKey, { commits: allCommits, maxDays: days });

  return filterCommitsByDays(allCommits, days);
}

// ============================================
// Stats Entry Builder
// ============================================

export const STATS_CONCURRENCY = 25;

export function buildStatsEntry(
  diff: NonNullable<Awaited<ReturnType<typeof getGitCommitDiff>>>
): CommitStatsEntry {
  return {
    filesChanged: diff.stats.files_changed,
    insertions: diff.stats.insertions,
    deletions: diff.stats.deletions,
    fileChanges: diff.files.map((file) => ({
      path: file.file_path,
      insertions: file.insertions,
      deletions: file.deletions,
      status: file.status,
    })),
  };
}

export { getGitCommitDiff };
