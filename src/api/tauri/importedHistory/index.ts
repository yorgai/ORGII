import type { ActivityChunk } from "@src/types/session/session";

import {
  type BrickHistorySessionPage,
  type BrickHistorySessionRow,
  type BrickHistorySourceId,
  type BrickHistorySourceRow,
  brickHistoryChunks,
  brickHistoryQuerySessions,
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

const ICON_ID_BY_SOURCE: Record<ImportedHistorySourceId, string> = {
  codex_app: "codex",
  claude_code: "claude_code",
  cursor_agent: "cursor",
  opencode: "opencode",
  windsurf: "windsurf",
  workbuddy: "workbuddy",
  gemini: "gemini",
};

const BRICK_IMPORTED_SOURCE_CATALOG: readonly BrickHistorySourceRow[] = [
  {
    sourceId: "codex_app",
    displayName: "Codex",
    sessionIdPrefix: "codexapp-",
    category: "external_history",
    capabilities: ["sessions", "chunks", "plans", "recent_paths", "artifacts"],
    available: true,
    paths: [],
  },
  {
    sourceId: "claude_code",
    displayName: "Claude Code",
    sessionIdPrefix: "claudecodeapp-",
    category: "external_history",
    capabilities: ["sessions", "chunks", "plans", "recent_paths", "artifacts"],
    available: true,
    paths: [],
  },
  {
    sourceId: "cursor_agent",
    displayName: "Cursor Agent",
    sessionIdPrefix: "cursoragentapp-",
    category: "external_history",
    capabilities: ["sessions", "chunks", "plans", "recent_paths", "artifacts"],
    available: true,
    paths: [],
  },
  {
    sourceId: "opencode",
    displayName: "OpenCode",
    sessionIdPrefix: "opencodeapp-",
    category: "external_history",
    capabilities: ["sessions", "chunks", "plans", "recent_paths", "artifacts"],
    available: true,
    paths: [],
  },
  {
    sourceId: "windsurf",
    displayName: "Windsurf",
    sessionIdPrefix: "windsurfapp-",
    category: "external_history",
    capabilities: ["sessions", "chunks", "plans", "recent_paths", "artifacts"],
    available: true,
    paths: [],
  },
  {
    sourceId: "workbuddy",
    displayName: "WorkBuddy",
    sessionIdPrefix: "workbuddyapp-",
    category: "external_history",
    capabilities: ["sessions", "chunks", "plans", "recent_paths", "artifacts"],
    available: true,
    paths: [],
  },
  {
    sourceId: "gemini",
    displayName: "Gemini",
    sessionIdPrefix: "geminiapp-",
    category: "external_history",
    capabilities: ["sessions", "chunks", "plans", "recent_paths", "artifacts"],
    available: true,
    paths: [],
  },
];

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

function createBrickImportedSource(
  catalogRow: BrickHistorySourceRow
): ImportedHistorySource {
  const sourceId = catalogRow.sourceId as ImportedHistorySourceId;
  return {
    sourceId,
    prefix: catalogRow.sessionIdPrefix,
    iconId: ICON_ID_BY_SOURCE[sourceId],
    displayName: catalogRow.displayName,
    groupLabel: catalogRow.displayName,
    listCategory: `external_history:${sourceId}`,
    dispatchCategory: "external_history",
    async listSessions(args) {
      return asImportedPage(
        await brickHistoryQuerySessions({
          sourceId,
          limit: args?.limit,
          offset: args?.offset,
        })
      );
    },
    loadChunks(sessionId) {
      return brickHistoryChunks({ sourceId, sessionId });
    },
  };
}

export const IMPORTED_HISTORY_SOURCES: readonly ImportedHistorySource[] =
  BRICK_IMPORTED_SOURCE_CATALOG.map(createBrickImportedSource);

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
