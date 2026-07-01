import { brickHistoryRecentPaths } from "@src/api/tauri/brickHistory";
import type { RepoKind } from "@src/api/tauri/repo";

export interface ExternalHistoryImportedRepo {
  repoId: string;
  name: string;
  path: string;
  kind: RepoKind;
}

export async function externalHistoryAutoImportRecentPaths(options?: {
  limit?: number;
}): Promise<ExternalHistoryImportedRepo[]> {
  const rows = await brickHistoryRecentPaths({ limit: options?.limit });

  return rows.map((row) => ({
    repoId: `brick-recent:${row.repoPath}`,
    name: row.repoName ?? row.repoPath,
    path: row.repoPath,
    kind: "folder" as RepoKind,
  }));
}
