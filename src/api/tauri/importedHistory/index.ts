import type { ActivityChunk } from "@src/types/session/session";

import {
  type BrickHistorySessionPage,
  type BrickHistorySessionRow,
  type BrickHistorySourceId,
  brickHistoryChunks,
  brickHistorySessions,
} from "../brickHistory";
import type { DispatchCategory } from "../session";

export type ImportedHistorySourceId = Extract<
  BrickHistorySourceId,
  | "codex_app"
  | "claude_code"
  | "cursor_agent"
  | "opencode"
  | "windsurf"
  | "workbuddy"
  | "gemini"
>;

export type ImportedHistoryListCategory =
  `external_history:${ImportedHistorySourceId}`;

export interface ImportedHistorySessionRow {
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

export interface ImportedHistorySessionPage {
  sessions: ImportedHistorySessionRow[];
  hasMore: boolean;
}

export interface ImportedHistorySource {
  sourceId: ImportedHistorySourceId;
  listCategory: ImportedHistoryListCategory;
  dispatchCategory: Extract<DispatchCategory, "external_history">;
  prefix: string;
  iconId: string;
  displayName: string;
  groupLabel: string;
  sidebarPageSize?: number;
  listSessions(args?: {
    limit?: number;
    offset?: number;
  }): Promise<ImportedHistorySessionPage>;
  loadChunks(sessionId: string): Promise<ActivityChunk[]>;
}

function asImportedPage(
  page: BrickHistorySessionPage
): ImportedHistorySessionPage {
  return {
    sessions: page.sessions.map((row) => ({
      ...row,
      category: "external_history",
    })),
    hasMore: page.hasMore,
  };
}

function createBrickImportedSource(config: {
  sourceId: ImportedHistorySourceId;
  prefix: string;
  iconId: string;
  displayName: string;
  groupLabel: string;
}): ImportedHistorySource {
  return {
    ...config,
    listCategory: `external_history:${config.sourceId}`,
    dispatchCategory: "external_history",
    async listSessions(args) {
      return asImportedPage(
        await brickHistorySessions({
          sourceId: config.sourceId,
          limit: args?.limit,
          offset: args?.offset,
        })
      );
    },
    loadChunks(sessionId) {
      return brickHistoryChunks({ sourceId: config.sourceId, sessionId });
    },
  };
}

export const IMPORTED_HISTORY_SOURCES: readonly ImportedHistorySource[] = [
  createBrickImportedSource({
    sourceId: "codex_app",
    prefix: "codexapp-",
    iconId: "codex",
    displayName: "Codex",
    groupLabel: "Codex App",
  }),
  createBrickImportedSource({
    sourceId: "claude_code",
    prefix: "claudecodeapp-",
    iconId: "claude_code",
    displayName: "Claude Code",
    groupLabel: "Claude Code",
  }),
  createBrickImportedSource({
    sourceId: "cursor_agent",
    prefix: "cursoragentapp-",
    iconId: "cursor",
    displayName: "Cursor Agent",
    groupLabel: "Cursor Agent",
  }),
  createBrickImportedSource({
    sourceId: "opencode",
    prefix: "opencodeapp-",
    iconId: "opencode",
    displayName: "OpenCode",
    groupLabel: "OpenCode",
  }),
  createBrickImportedSource({
    sourceId: "windsurf",
    prefix: "windsurfapp-",
    iconId: "windsurf",
    displayName: "Windsurf",
    groupLabel: "Windsurf",
  }),
  createBrickImportedSource({
    sourceId: "workbuddy",
    prefix: "workbuddyapp-",
    iconId: "workbuddy",
    displayName: "WorkBuddy",
    groupLabel: "WorkBuddy",
  }),
  createBrickImportedSource({
    sourceId: "gemini",
    prefix: "geminiapp-",
    iconId: "gemini",
    displayName: "Gemini",
    groupLabel: "Gemini",
  }),
];

export function getImportedHistorySourceBySessionId(
  sessionId: string | null | undefined
): ImportedHistorySource | undefined {
  if (!sessionId) return undefined;
  return IMPORTED_HISTORY_SOURCES.find((source) =>
    sessionId.startsWith(source.prefix)
  );
}

export function getImportedHistorySourceByListCategory(
  category: ImportedHistoryListCategory
): ImportedHistorySource | undefined {
  return IMPORTED_HISTORY_SOURCES.find(
    (source) => source.listCategory === category
  );
}

export function isImportedHistoryListCategory(
  category: string
): category is ImportedHistoryListCategory {
  return IMPORTED_HISTORY_SOURCES.some(
    (source) => source.listCategory === category
  );
}

export function isImportedHistorySourceSession(
  sessionId: string,
  source: ImportedHistorySource
): boolean {
  return sessionId.startsWith(source.prefix);
}

export type CodexAppSessionRow = ImportedHistorySessionRow;
export type ClaudeCodeHistorySessionRow = ImportedHistorySessionRow;
export type OpenCodeHistorySessionRow = ImportedHistorySessionRow;
export type WindsurfHistorySessionRow = ImportedHistorySessionRow;
export type WorkBuddyHistorySessionRow = ImportedHistorySessionRow;

export type CodexAppSessionPage = ImportedHistorySessionPage;
export type ClaudeCodeHistorySessionPage = ImportedHistorySessionPage;
export type OpenCodeHistorySessionPage = ImportedHistorySessionPage;
export type WindsurfHistorySessionPage = ImportedHistorySessionPage;
export type WorkBuddyHistorySessionPage = ImportedHistorySessionPage;

export type { BrickHistorySessionRow };
