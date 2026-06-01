import type { GitFile } from "@src/types/git/types";
import { decodeOctalPath } from "@src/util/file/pathUtils";

export function getEffectiveRepoPath(file: GitFile, fallback: string): string {
  return file.repoRoot ?? fallback;
}

export function getRelativePath(filePath: string, repoPath: string): string {
  return filePath.startsWith(`${repoPath}/`)
    ? filePath.slice(repoPath.length + 1)
    : filePath;
}

export function getDiffLookupKeys(
  filePath: string,
  repoPath: string
): string[] {
  const relativePath = getRelativePath(filePath, repoPath);
  const absolutePath = filePath.startsWith("/")
    ? filePath
    : `${repoPath}/${filePath}`;
  return [filePath, relativePath, absolutePath, decodeOctalPath(filePath)];
}

export function countContentLines(content: string): number {
  return content ? content.split("\n").length : 0;
}

interface DiffStatsSource {
  insertions?: number | null;
  deletions?: number | null;
}

export function getEffectiveDiffStats(
  file: GitFile,
  diff: DiffStatsSource,
  oldContent: string,
  newContent: string
): { additions: number; deletions: number } {
  const fallbackAdditions =
    file.status === "added" ? countContentLines(newContent) : 0;
  const fallbackDeletions =
    file.status === "deleted" ? countContentLines(oldContent) : 0;

  return {
    additions:
      diff.insertions !== undefined && diff.insertions !== null
        ? Math.max(diff.insertions, fallbackAdditions)
        : fallbackAdditions,
    deletions:
      diff.deletions !== undefined && diff.deletions !== null
        ? Math.max(diff.deletions, fallbackDeletions)
        : fallbackDeletions,
  };
}
