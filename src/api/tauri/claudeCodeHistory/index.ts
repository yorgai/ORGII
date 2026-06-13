import { invoke } from "@tauri-apps/api/core";

import type { ActivityChunk } from "@src/types/session/session";

export interface ClaudeCodeHistorySessionRow {
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

export interface ClaudeCodeHistorySessionPage {
  sessions: ClaudeCodeHistorySessionRow[];
  hasMore: boolean;
}

export interface ClaudeCodeRecentPath {
  path: string;
  name?: string;
  lastUsedAt: string;
  sessionCount: number;
}

export async function claudeCodeHistoryListSessions(args?: {
  limit?: number;
  offset?: number;
}): Promise<ClaudeCodeHistorySessionPage> {
  return invoke<ClaudeCodeHistorySessionPage>(
    "claude_code_history_list_sessions",
    {
      limit: args?.limit,
      offset: args?.offset,
    }
  );
}

export async function claudeCodeRecentPaths(args?: {
  limit?: number;
}): Promise<ClaudeCodeRecentPath[]> {
  return invoke<ClaudeCodeRecentPath[]>("claude_code_recent_paths", {
    limit: args?.limit,
  });
}

export async function claudeCodeHistoryChunks(
  sessionId: string
): Promise<ActivityChunk[]> {
  return invoke<ActivityChunk[]>("claude_code_history_chunks", { sessionId });
}
