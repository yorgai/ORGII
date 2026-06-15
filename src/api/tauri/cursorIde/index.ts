/**
 * Cursor IDE history — Tauri API wrappers.
 *
 * These commands surface Cursor IDE chat history (read from Cursor's
 * `~/.../state.vscdb`) as read-only sessions in our session list.
 * Frontend never sees the bare composer UUID — every session id is
 * prefixed with `cursoride-` (see `CURSOR_IDE_SESSION_PREFIX`).
 */
import { invoke } from "@tauri-apps/api/core";

import type { ActivityChunk } from "@src/types/session/session";

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
  background: boolean;
  isActive: boolean;
  repoPath?: string;
  repoName?: string;
  branch?: string;
}

/**
 * Page returned from `cursor_ide_list_sessions`.
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
  return invoke<CursorIdeSessionPage>("cursor_ide_list_sessions", {
    limit: args?.limit,
    offset: args?.offset,
  });
}

/**
 * Read all bubbles for one Cursor IDE composer, returned as `ActivityChunk[]`
 * ready to feed through the standard event pipeline (`processChunksRust` →
 * `eventStoreProxy` → `ChatHistory`).
 */
export async function cursorIdeChunks(
  sessionId: string
): Promise<ActivityChunk[]> {
  return invoke<ActivityChunk[]>("cursor_ide_chunks", { sessionId });
}

export async function cursorIdeInitialWindow(args: {
  sessionId: string;
  recentLimit?: number;
}): Promise<CursorIdeInitialWindow> {
  return invoke<CursorIdeInitialWindow>("cursor_ide_initial_window", {
    sessionId: args.sessionId,
    recentLimit: args.recentLimit,
  });
}

export async function cursorIdeFullRefresh(
  sessionId: string
): Promise<CursorIdeFullRefresh> {
  return invoke<CursorIdeFullRefresh>("cursor_ide_full_refresh", { sessionId });
}

export async function cursorIdeTurnWindow(args: {
  sessionId: string;
  userBubbleId: string;
}): Promise<CursorIdeTurnWindow> {
  return invoke<CursorIdeTurnWindow>("cursor_ide_turn_window", {
    sessionId: args.sessionId,
    userBubbleId: args.userBubbleId,
  });
}
