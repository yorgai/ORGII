import { invoke } from "@tauri-apps/api/core";

import {
  type BrickHistorySessionRow,
  type BrickHistorySourceId,
  brickHistoryQuerySessions,
} from "@src/api/tauri/brickHistory";

import type { ClaudeCodeSession, CliSession, CursorSession } from "./types";

const BRICK_DEVRECORD_LIMIT = 1000;
const CURSOR_MODE_AGENT = "agent";

function parseDateParts(date: string): [number, number, number] {
  const [yearPart, monthPart, dayPart] = date.split("-");
  return [
    Number.parseInt(yearPart ?? "1970", 10),
    Number.parseInt(monthPart ?? "1", 10),
    Number.parseInt(dayPart ?? "1", 10),
  ];
}

function startOfDayIso(date: string): string {
  const [year, month, day] = parseDateParts(date);
  return new Date(year, month - 1, day, 0, 0, 0, 0).toISOString();
}

function endOfDayIso(date: string): string {
  const [year, month, day] = parseDateParts(date);
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}

function isoToMs(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function cursorIsAgentic(session: BrickHistorySessionRow): boolean {
  if (typeof session.cursorIsAgentic === "boolean") {
    return session.cursorIsAgentic;
  }
  return session.cursorMode === CURSOR_MODE_AGENT;
}

async function listBrickSessionsInRange(
  sourceId: BrickHistorySourceId,
  startDate: string,
  endDate: string
): Promise<BrickHistorySessionRow[]> {
  const result = await brickHistoryQuerySessions({
    sourceId,
    createdAfter: startOfDayIso(startDate),
    createdBefore: endOfDayIso(endDate),
    limit: BRICK_DEVRECORD_LIMIT,
    refreshLimit: BRICK_DEVRECORD_LIMIT,
  });
  return result.sessions;
}

export async function getOrgtrackCursorSessions(
  startDate: string,
  endDate: string
): Promise<CursorSession[]> {
  const sessions = await listBrickSessionsInRange(
    "cursor_ide",
    startDate,
    endDate
  );
  return sessions.map((session) => ({
    id: session.sessionId,
    name: session.name,
    createdAt: isoToMs(session.createdAt),
    lastActiveAt: isoToMs(session.updatedAt || session.lastSeenAt),
    status: session.status,
    isAgentic: cursorIsAgentic(session),
    mode: session.cursorMode ?? "",
    model: session.model ?? "",
    linesAdded: session.linesAdded,
    linesRemoved: session.linesRemoved,
    filesChanged: session.filesChanged,
    tokensUsed: session.totalTokens,
  }));
}

export async function getOrgtrackClaudeCodeSessions(
  startDate: string,
  endDate: string
): Promise<ClaudeCodeSession[]> {
  const sessions = await listBrickSessionsInRange(
    "claude_code",
    startDate,
    endDate
  );
  return sessions.map((session) => ({
    id: session.externalSessionId,
    name: session.name,
    createdAt: isoToMs(session.createdAt),
    lastActiveAt: isoToMs(session.updatedAt || session.lastSeenAt),
    messageCount: session.messageCount,
    model: session.model ?? "",
    workspacePath: session.repoPath ?? "",
    gitBranch: session.branch ?? "",
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
  }));
}

export async function getOrgtrackCliSessions(
  startDate: string,
  endDate: string,
  tool?: string
): Promise<CliSession[]> {
  return invoke<CliSession[]>("orgtrack_get_cli_sessions", {
    tool: tool ?? null,
    startDate,
    endDate,
  });
}
