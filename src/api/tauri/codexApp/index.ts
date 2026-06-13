import { invoke } from "@tauri-apps/api/core";

import type { ActivityChunk } from "@src/types/session/session";

export interface CodexAppSessionRow {
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

export interface CodexAppSessionPage {
  sessions: CodexAppSessionRow[];
  hasMore: boolean;
}

export interface CodexAppRecentPath {
  path: string;
  name?: string;
  lastUsedAt: string;
  sessionCount: number;
}

export async function codexAppListSessions(args?: {
  limit?: number;
  offset?: number;
}): Promise<CodexAppSessionPage> {
  return invoke<CodexAppSessionPage>("codex_app_list_sessions", {
    limit: args?.limit,
    offset: args?.offset,
  });
}

export async function codexAppRecentPaths(args?: {
  limit?: number;
}): Promise<CodexAppRecentPath[]> {
  return invoke<CodexAppRecentPath[]>("codex_app_recent_paths", {
    limit: args?.limit,
  });
}

export async function codexAppChunks(
  sessionId: string
): Promise<ActivityChunk[]> {
  return invoke<ActivityChunk[]>("codex_app_chunks", { sessionId });
}
