import type { FileChangeInfo } from "@src/engines/ChatPanel/InputArea/components/compactFileChangesHelpers";
import type { TurnModifiedFile } from "@src/engines/SessionCore/storage/sqliteCache";

function basename(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] || path;
}

/**
 * Map the DB-materialized per-round file list into the `FileChangeInfo`
 * shape the composer `FileChangeRow` renders. Pure: no aggregation happens
 * here — the backend turn indexer already deduped and summed line stats.
 *
 * Defensive against partial rows (missing `fileName`, negative counts) so a
 * single malformed historical entry can't crash the footer.
 */
export function mapTurnModifiedFilesToFileChanges(
  files: readonly TurnModifiedFile[] | undefined | null
): FileChangeInfo[] {
  if (!files || files.length === 0) return [];

  return files
    .filter((file) => typeof file?.path === "string" && file.path.length > 0)
    .map((file) => {
      const additions = Number.isFinite(file.additions)
        ? Math.max(0, Math.trunc(file.additions))
        : 0;
      const deletions = Number.isFinite(file.deletions)
        ? Math.max(0, Math.trunc(file.deletions))
        : 0;
      return {
        path: file.path,
        fileName:
          typeof file.fileName === "string" && file.fileName.length > 0
            ? file.fileName
            : basename(file.path),
        status: file.status ?? "modified",
        additions,
        deletions,
        lineCount: 0,
      };
    });
}
