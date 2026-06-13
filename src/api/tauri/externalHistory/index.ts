import { invoke } from "@tauri-apps/api/core";

import type { RepoKind } from "@src/api/tauri/repo";

export interface ExternalHistoryImportedRepo {
  repoId: string;
  name: string;
  path: string;
  kind: RepoKind;
}

interface ExternalHistoryImportedRepoWire {
  repo_id: string;
  name: string;
  path: string;
  kind: RepoKind;
}

export async function externalHistoryAutoImportRecentPaths(options?: {
  limit?: number;
}): Promise<ExternalHistoryImportedRepo[]> {
  const rows = await invoke<ExternalHistoryImportedRepoWire[]>(
    "external_history_auto_import_recent_paths",
    { limit: options?.limit }
  );

  return rows.map((row) => ({
    repoId: row.repo_id,
    name: row.name,
    path: row.path,
    kind: row.kind,
  }));
}
