import { invoke } from "@tauri-apps/api/core";

import type { ActivityChunk } from "@src/types/session/session";

export type BrickHistorySourceId =
  | "codex_app"
  | "claude_code"
  | "cursor_ide"
  | "cursor_agent"
  | "opencode"
  | "windsurf"
  | "workbuddy"
  | "gemini";

export interface BrickHistorySourceRow {
  sourceId: BrickHistorySourceId;
  displayName: string;
  available: boolean;
  paths: string[];
}

export interface BrickHistorySessionRow {
  sessionId: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  category: "external_history" | "cursor_ide";
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
  sourceId: BrickHistorySourceId;
  externalSessionId: string;
  sourcePath?: string;
  sourceUri?: string;
  parserVersion?: string;
  inputTokens: number;
  outputTokens: number;
  lastSeenAt: string;
  liveness?: string;
  lastScanLiveness?: string;
  cursorMode?: string;
  cursorIsAgentic?: boolean;
  messageCount: number;
}

export interface BrickHistorySessionPage {
  sessions: BrickHistorySessionRow[];
  hasMore: boolean;
}

export interface BrickHistoryRefreshStats {
  sourceId: BrickHistorySourceId;
  limit: number;
  sourceAvailable: boolean;
  profiles: number;
  sessionsScanned: number;
  sessionsReindexed: number;
  sessionsUnchanged: number;
  plansUpserted: number;
  eventsAppended: number;
}

export interface BrickHistoryRecentPathRow {
  repoPath: string;
  repoName?: string;
  sessionCount: number;
  lastSeenAt: string;
  sourceIds: BrickHistorySourceId[];
}

export interface BrickHistoryPlanRow {
  sourceId: BrickHistorySourceId;
  externalPlanId: string;
  title?: string;
  sourcePath?: string;
  sourceUri?: string;
  parserVersion?: string;
  discoveredAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
  metadata?: unknown;
}

export interface BrickHistoryPlanPage {
  plans: BrickHistoryPlanRow[];
  hasMore: boolean;
}

export interface BrickHistoryPlanEdgeRow {
  sourceId: BrickHistorySourceId;
  externalPlanId: string;
  externalSessionId: string;
  sessionId: string;
  role: string;
  todoIds?: unknown;
  discoveredAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
  metadata?: unknown;
}

export async function brickHistorySources(): Promise<BrickHistorySourceRow[]> {
  return invoke<BrickHistorySourceRow[]>("brick_history_sources");
}

export async function brickHistoryRefreshSource(args: {
  sourceId: BrickHistorySourceId;
  limit?: number;
}): Promise<BrickHistoryRefreshStats> {
  return invoke<BrickHistoryRefreshStats>("brick_history_refresh_source", {
    sourceId: args.sourceId,
    limit: args.limit,
  });
}

export async function brickHistorySessions(args: {
  sourceId: BrickHistorySourceId;
  limit?: number;
  offset?: number;
}): Promise<BrickHistorySessionPage> {
  return invoke<BrickHistorySessionPage>("brick_history_sessions", {
    sourceId: args.sourceId,
    limit: args.limit,
    offset: args.offset,
  });
}

export async function brickHistoryChunks(args: {
  sourceId: BrickHistorySourceId;
  sessionId: string;
}): Promise<ActivityChunk[]> {
  return invoke<ActivityChunk[]>("brick_history_chunks", { request: args });
}

export async function brickHistoryRecentPaths(args?: {
  limit?: number;
}): Promise<BrickHistoryRecentPathRow[]> {
  return invoke<BrickHistoryRecentPathRow[]>("brick_history_recent_paths", {
    limit: args?.limit,
  });
}

export async function brickHistoryPlans(args?: {
  sourceId?: BrickHistorySourceId;
  limit?: number;
  offset?: number;
}): Promise<BrickHistoryPlanPage> {
  return invoke<BrickHistoryPlanPage>("brick_history_plans", {
    sourceId: args?.sourceId,
    limit: args?.limit,
    offset: args?.offset,
  });
}

export async function brickHistoryPlanEdges(args?: {
  sourceId?: BrickHistorySourceId;
  externalPlanIds?: string[];
}): Promise<BrickHistoryPlanEdgeRow[]> {
  return invoke<BrickHistoryPlanEdgeRow[]>("brick_history_plan_edges", {
    sourceId: args?.sourceId,
    externalPlanIds: args?.externalPlanIds,
  });
}
