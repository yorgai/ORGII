/**
 * Cursor IDE history — Tauri API wrappers.
 *
 * These commands surface Cursor IDE chat history (read from Cursor's
 * `~/.../state.vscdb`) as read-only sessions in our session list.
 * Frontend never sees the bare composer UUID — every session id is
 * prefixed with `cursoride-` (see `CURSOR_IDE_SESSION_PREFIX`).
 */
import { invoke } from "@tauri-apps/api/core";

import {
  type BrickHistorySessionPage,
  type BrickHistorySessionRow,
  brickHistoryChunks,
  brickHistorySessions,
} from "@src/api/tauri/brickHistory";
import type { ActivityChunk } from "@src/types/session/session";

const CURSOR_IDE_BRICK_SOURCE_ID = "cursor_ide" as const;

/**
 * One Cursor IDE composer surfaced as a frontend-ready session row.
 * Mirrors the Rust `CursorIdeSessionRow` (camelCase via serde).
 */
export interface CursorIdeSessionRow {
  sessionId: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  category: "cursor_ide";
  readOnly: true;
  model?: string;
  totalTokens: number;
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  touchedFiles: string[];
  background: boolean;
  isActive: boolean;
  repoPath?: string;
  repoName?: string;
  branch?: string;
}

/**
 * Page returned from Brick-backed Cursor IDE session listing.
 *
 * `hasMore` reflects whether a follow-up `(limit, offset + sessions.length)`
 * call would surface more rows. The sidebar's per-category pagination uses
 * this signal to decide whether to render a "Load more" row.
 */
export interface CursorIdeSessionPage {
  sessions: CursorIdeSessionRow[];
  hasMore: boolean;
}

export interface CursorIdeTurnSummary {
  turnId: string;
  nextTurnId: string | null;
  turnIndex: number;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  userPreview: string;
  eventCount: number;
  bodyEventCount: number;
}

export interface CursorIdeInitialWindow {
  chunks: ActivityChunk[];
  turns: CursorIdeTurnSummary[];
  totalBubbleCount: number;
  userBubbleCount: number;
  recentBubbleCount: number;
  recentStartCursor: string | null;
  recentEndCursor: string | null;
  hasUnloadedMiddle: boolean;
}

export interface CursorIdeFullRefresh {
  chunks: ActivityChunk[];
  turns: CursorIdeTurnSummary[];
}

export interface CursorIdeTurnWindow {
  chunks: ActivityChunk[];
  userBubbleId: string;
  nextUserBubbleId: string | null;
  loadedBubbleCount: number;
}

function asCursorIdeSessionRow(
  row: BrickHistorySessionRow
): CursorIdeSessionRow {
  return {
    sessionId: row.sessionId,
    name: row.name,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    category: "cursor_ide",
    readOnly: true,
    model: row.model,
    totalTokens: row.totalTokens,
    linesAdded: row.linesAdded,
    linesRemoved: row.linesRemoved,
    filesChanged: row.filesChanged,
    touchedFiles: row.touchedFiles,
    background: row.background,
    isActive: row.isActive,
    repoPath: row.repoPath,
    repoName: row.repoName,
    branch: row.branch,
  };
}

function asCursorIdeSessionPage(
  page: BrickHistorySessionPage
): CursorIdeSessionPage {
  return {
    sessions: page.sessions.map(asCursorIdeSessionRow),
    hasMore: page.hasMore,
  };
}

export async function cursorIdeLiveFullRefresh(
  sessionId: string
): Promise<CursorIdeFullRefresh> {
  return invoke<CursorIdeFullRefresh>("brick_history_cursor_full_refresh", {
    sessionId,
  });
}

/**
 * Paginated list of Cursor IDE composers, ordered most-recent-first.
 *
 * Defaults: `limit = 200`, `offset = 0` — large enough to cover the
 * previous "fetch everything" behaviour for typical users while bounded
 * for power users with thousands of composers. Pass smaller `limit`
 * values (e.g. 10) for the sidebar's per-category paginated loader.
 */
export async function cursorIdeListSessions(args?: {
  limit?: number;
  offset?: number;
}): Promise<CursorIdeSessionPage> {
  const page = await brickHistorySessions({
    sourceId: CURSOR_IDE_BRICK_SOURCE_ID,
    limit: args?.limit,
    offset: args?.offset,
  });
  return asCursorIdeSessionPage(page);
}

/**
 * Read all bubbles for one Cursor IDE composer, returned as `ActivityChunk[]`
 * ready to feed through the standard event pipeline (`processChunksRust` →
 * `eventStoreProxy` → `ChatHistory`).
 */
export async function cursorIdeChunks(
  sessionId: string
): Promise<ActivityChunk[]> {
  return brickHistoryChunks({
    sourceId: CURSOR_IDE_BRICK_SOURCE_ID,
    sessionId,
  });
}

export async function cursorIdeInitialWindow(args: {
  sessionId: string;
  recentLimit?: number;
}): Promise<CursorIdeInitialWindow> {
  const chunks = await brickHistoryChunks({
    sourceId: CURSOR_IDE_BRICK_SOURCE_ID,
    sessionId: args.sessionId,
  });
  return {
    chunks,
    turns: [],
    totalBubbleCount: chunks.length,
    userBubbleCount: 0,
    recentBubbleCount: chunks.length,
    recentStartCursor: null,
    recentEndCursor: null,
    hasUnloadedMiddle: false,
  };
}

export async function cursorIdeFullRefresh(
  sessionId: string
): Promise<CursorIdeFullRefresh> {
  return invoke<CursorIdeFullRefresh>("brick_history_cursor_full_refresh", {
    sessionId,
  });
}

export async function cursorIdeTurnWindow(args: {
  sessionId: string;
  userBubbleId: string;
}): Promise<CursorIdeTurnWindow> {
  return invoke<CursorIdeTurnWindow>("brick_history_cursor_turn_window", {
    sessionId: args.sessionId,
    userBubbleId: args.userBubbleId,
  });
}
