/**
 * Semantic Search API
 */
import { invoke } from "@tauri-apps/api/core";

import type {
  EmbeddingModelStatus,
  IncrementalIndexResult,
  SemanticHit,
  USearchIndexInfo,
} from "./types";

export async function checkAdvancedSearchEnabled(): Promise<boolean> {
  return invoke<boolean>("check_advanced_search_enabled");
}

export async function checkSemanticAvailable(): Promise<boolean> {
  return invoke<boolean>("check_semantic_available");
}

export async function searchSemantic(
  query: string,
  repoFilter?: string,
  limit?: number,
  modelId?: string,
  offset?: number
): Promise<SemanticHit[]> {
  return invoke<SemanticHit[]>("search_semantic", {
    query,
    repoFilter,
    limit,
    modelId,
    offset,
  });
}

export async function indexRepositorySemantic(
  repoId: string,
  repoPath: string,
  modelId?: string
): Promise<number> {
  let normalizedPath = repoPath;
  if (normalizedPath.startsWith("file://")) {
    normalizedPath = normalizedPath.replace("file://", "");
  }
  normalizedPath = decodeURIComponent(normalizedPath);
  return invoke<number>("index_repository_semantic", {
    repoId,
    repoPath: normalizedPath,
    modelId,
  });
}

export async function removeRepositorySemantic(repoId: string): Promise<void> {
  return invoke<void>("remove_repository_semantic", { repoId });
}

export async function cancelSemanticIndexing(repoId: string): Promise<boolean> {
  return invoke<boolean>("cancel_semantic_indexing", { repoId });
}

export async function incrementalIndexSemantic(
  repoId: string,
  repoPath: string,
  filePaths: string[],
  modelId?: string
): Promise<IncrementalIndexResult> {
  let normalizedPath = repoPath;
  if (normalizedPath.startsWith("file://")) {
    normalizedPath = normalizedPath.replace("file://", "");
  }
  normalizedPath = decodeURIComponent(normalizedPath);
  return invoke<IncrementalIndexResult>("incremental_index_semantic", {
    repoId,
    repoPath: normalizedPath,
    filePaths,
    modelId,
  });
}

export async function checkEmbeddingModelStatus(): Promise<EmbeddingModelStatus> {
  return invoke<EmbeddingModelStatus>("check_embedding_model_status");
}

export async function downloadEmbeddingModel(): Promise<void> {
  return invoke<void>("download_embedding_model");
}

export async function deleteEmbeddingModel(): Promise<void> {
  return invoke<void>("delete_embedding_model");
}

export async function setModelDir(path: string): Promise<void> {
  return invoke<void>("set_model_dir", { path });
}

export async function getModelDirPath(): Promise<string> {
  return invoke<string>("get_model_dir_path");
}

export async function isSemanticSearchAvailable(): Promise<boolean> {
  try {
    return await checkSemanticAvailable();
  } catch {
    return false;
  }
}

export async function getSemanticIndexInfo(): Promise<USearchIndexInfo | null> {
  try {
    return await invoke<USearchIndexInfo>("get_semantic_index_info");
  } catch {
    return null;
  }
}

export async function getModelInfo(): Promise<string> {
  return invoke<string>("get_model_info");
}

export async function stopEmbedder(): Promise<void> {
  return invoke<void>("stop_embedder");
}
