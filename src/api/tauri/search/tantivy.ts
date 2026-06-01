/**
 * Tantivy Search & Incremental Indexing API
 */
import { invoke } from "@tauri-apps/api/core";

import type {
  IncrementalIndexResult,
  TantivyIndexInfo,
  TantivyIndexStats,
  TantivySearchHit,
} from "./types";

export async function indexRepositoryTantivy(
  repoId: string,
  repoPath: string
): Promise<TantivyIndexStats> {
  let normalizedPath = repoPath;
  if (normalizedPath.startsWith("file://")) {
    normalizedPath = normalizedPath.replace("file://", "");
  }
  normalizedPath = decodeURIComponent(normalizedPath);
  return invoke<TantivyIndexStats>("index_repository_tantivy", {
    repoId,
    repoPath: normalizedPath,
  });
}

export async function searchTantivy(
  query: string,
  repoFilter?: string,
  limit?: number,
  offset?: number
): Promise<TantivySearchHit[]> {
  return invoke<TantivySearchHit[]>("search_tantivy", {
    query,
    repoFilter,
    limit,
    offset,
  });
}

export async function getTantivyIndexInfo(): Promise<TantivyIndexInfo> {
  return invoke<TantivyIndexInfo>("get_tantivy_index_info");
}

export async function removeRepositoryTantivy(repoId: string): Promise<number> {
  return invoke<number>("remove_repository_tantivy", { repoId });
}

export async function clearTantivyIndex(): Promise<void> {
  return invoke<void>("clear_tantivy_index");
}

export async function incrementalIndexFiles(
  repoId: string,
  repoPath: string,
  filePaths: string[]
): Promise<IncrementalIndexResult> {
  let normalizedPath = repoPath;
  if (normalizedPath.startsWith("file://")) {
    normalizedPath = normalizedPath.replace("file://", "");
  }
  normalizedPath = decodeURIComponent(normalizedPath);
  return invoke<IncrementalIndexResult>("incremental_index_files", {
    repoId,
    repoPath: normalizedPath,
    filePaths,
  });
}

export async function removeFilesFromIndex(
  repoId: string,
  filePaths: string[]
): Promise<number> {
  return invoke<number>("remove_files_from_index", { repoId, filePaths });
}
