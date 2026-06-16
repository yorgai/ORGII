import { invoke } from "@tauri-apps/api/core";

import type { ActivityChunk } from "@src/types/session/session";

export interface WindsurfHistorySessionRow {
  sessionId: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  category: "external_history";
  readOnly: true;
  model?: string;
  totalTokens: number;
  background: boolean;
  isActive: boolean;
  repoPath?: string;
  repoName?: string;
  branch?: string;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  touchedFiles: string[];
}

export interface WindsurfHistorySessionPage {
  sessions: WindsurfHistorySessionRow[];
  hasMore: boolean;
}

export interface WindsurfRecentPath {
  path: string;
  name?: string;
  lastUsedAt: string;
  sessionCount: number;
}

export async function windsurfHistoryListSessions(args?: {
  limit?: number;
  offset?: number;
}): Promise<WindsurfHistorySessionPage> {
  return invoke<WindsurfHistorySessionPage>("windsurf_history_list_sessions", {
    limit: args?.limit,
    offset: args?.offset,
  });
}

export async function windsurfRecentPaths(args?: {
  limit?: number;
}): Promise<WindsurfRecentPath[]> {
  return invoke<WindsurfRecentPath[]>("windsurf_recent_paths", {
    limit: args?.limit,
  });
}

export async function windsurfHistoryChunks(
  sessionId: string
): Promise<ActivityChunk[]> {
  return invoke<ActivityChunk[]>("windsurf_history_chunks", { sessionId });
}
