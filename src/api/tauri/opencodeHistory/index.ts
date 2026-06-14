import { invoke } from "@tauri-apps/api/core";

import type { ActivityChunk } from "@src/types/session/session";

export interface OpenCodeHistorySessionRow {
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
}

export interface OpenCodeHistorySessionPage {
  sessions: OpenCodeHistorySessionRow[];
  hasMore: boolean;
}

export interface OpenCodeRecentPath {
  path: string;
  name?: string;
  lastUsedAt: string;
  sessionCount: number;
}

export async function opencodeHistoryListSessions(args?: {
  limit?: number;
  offset?: number;
}): Promise<OpenCodeHistorySessionPage> {
  return invoke<OpenCodeHistorySessionPage>("opencode_history_list_sessions", {
    limit: args?.limit,
    offset: args?.offset,
  });
}

export async function opencodeRecentPaths(args?: {
  limit?: number;
}): Promise<OpenCodeRecentPath[]> {
  return invoke<OpenCodeRecentPath[]>("opencode_recent_paths", {
    limit: args?.limit,
  });
}

export async function opencodeHistoryChunks(
  sessionId: string
): Promise<ActivityChunk[]> {
  return invoke<ActivityChunk[]>("opencode_history_chunks", { sessionId });
}
