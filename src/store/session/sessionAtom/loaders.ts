/**
 * Session Loaders
 *
 * Two complementary loading paths:
 *
 *  - `loadSessions()` — legacy "load everything (with limit/offset)" entry
 *    used by panels that want a single flat list across all categories
 *    (Chat history panel, Simulator panel, useSessionManager).
 *
 *  - `loadSidebarSessions()` / `loadMoreCategory()` — sidebar-specific
 *    paginated loaders. Each category/source fetches its own top-N page so a
 *    heavy user with thousands of CLI/imported sessions doesn't pay for the
 *    long tail just to render the most-recent rows.
 */
import {
  type CursorIdeSessionRow,
  cursorIdeListSessions,
} from "@src/api/tauri/cursorIde";
import {
  IMPORTED_HISTORY_SOURCES,
  type ImportedHistorySessionRow,
  type ImportedHistorySource,
  getImportedHistorySourceByListCategory,
  isImportedHistoryListCategory,
  isImportedHistorySourceSession,
} from "@src/api/tauri/importedHistory";
import {
  type SessionFilter,
  type SessionListResponse,
  sessionAggregateList,
  toFrontendSessions,
} from "@src/api/tauri/session";
import { createLogger } from "@src/hooks/logger";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { isCursorIdeSession } from "@src/util/session/sessionDispatch";
import { isPrimarySessionListSession } from "@src/util/session/sessionVisibility";

import {
  sessionErrorAtom,
  sessionLastLoadedAtom,
  sessionLoadingAtom,
  sessionsAtom,
} from "./atoms";
import {
  SESSION_LIST_CATEGORIES,
  SESSION_SIDEBAR_PAGE_SIZE,
  type SessionListCategory,
  type SessionPaginationMap,
  resetPaginationState,
  sessionPaginationAtom,
} from "./paginationAtoms";
import { persistSessions } from "./persistence";
import type { Session, SessionStatus } from "./types";

const log = createLogger("SessionAtom");

function normalizeCursorIdeStatus(isActive: boolean): SessionStatus {
  return isActive ? "running" : "completed";
}

function cursorIdeRowToSession(row: CursorIdeSessionRow): Session {
  return {
    session_id: row.sessionId,
    status: normalizeCursorIdeStatus(row.isActive),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    created_time: row.createdAt,
    updated_time: row.updatedAt,
    name: row.name,
    is_active: row.isActive,
    category: row.category,
    model: row.model,
    background: row.background,
    repoPath: row.repoPath,
    repo_name: row.repoName || "",
    branch: row.branch || "",
    agentIconId: "cursor",
  };
}

function importedHistoryRowToSession(
  row: ImportedHistorySessionRow,
  source: ImportedHistorySource
): Session {
  return {
    session_id: row.sessionId,
    status: row.status || "completed",
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    created_time: row.createdAt,
    updated_time: row.updatedAt,
    name: row.name,
    is_active: row.isActive,
    category: row.category,
    model: row.model,
    background: row.background,
    repoPath: row.repoPath,
    repo_name: row.repoName || "",
    branch: row.branch || "",
    agentIconId: source.iconId,
    agentDisplayName: source.displayName,
  };
}

const getStore = () => getInstrumentedStore();
const CURSOR_IDE_SIDEBAR_PAGE_SIZE = 50;
const BULK_CACHE_DURATION_MS = 5 * 60 * 1000;

function mergeSessions(
  prev: readonly Session[],
  incoming: readonly Session[]
): Session[] {
  if (incoming.length === 0) return prev.slice();
  const incomingMap = new Map(
    incoming.map((session) => [session.session_id, session])
  );
  const merged: Session[] = prev.map(
    (session) => incomingMap.get(session.session_id) ?? session
  );
  const seen = new Set(merged.map((session) => session.session_id));
  for (const session of incoming) {
    if (!seen.has(session.session_id)) {
      merged.push(session);
      seen.add(session.session_id);
    }
  }
  merged.sort((sessionA, sessionB) =>
    (sessionB.updated_at || "").localeCompare(sessionA.updated_at || "")
  );
  return merged;
}

function replaceImportedFirstPage(
  prev: readonly Session[],
  incoming: readonly Session[],
  predicate: (sessionId: string) => boolean
): Session[] {
  const retained = prev.filter((session) => !predicate(session.session_id));
  return mergeSessions(retained, incoming);
}

function replaceCursorIdeFirstPage(
  prev: readonly Session[],
  incoming: readonly Session[]
): Session[] {
  return replaceImportedFirstPage(prev, incoming, isCursorIdeSession);
}

function replaceExternalHistorySourceFirstPage(
  prev: readonly Session[],
  incoming: readonly Session[],
  source: ImportedHistorySource
): Session[] {
  return replaceImportedFirstPage(prev, incoming, (sessionId) =>
    isImportedHistorySourceSession(sessionId, source)
  );
}

function setPaginationFor(
  category: SessionListCategory,
  patch: Partial<SessionPaginationMap[SessionListCategory]>
) {
  const store = getStore();
  store.set(sessionPaginationAtom, (prev) => ({
    ...prev,
    [category]: { ...prev[category], ...patch },
  }));
}

async function loadImportedHistorySourcePage(
  source: ImportedHistorySource,
  offset: number,
  pageSize: number
): Promise<FetchPageResult> {
  const page = await source.listSessions({
    limit: source.sidebarPageSize
      ? Math.max(pageSize, source.sidebarPageSize)
      : pageSize,
    offset,
  });
  return {
    sessions: page.sessions.map((row) =>
      importedHistoryRowToSession(row, source)
    ),
    hasMore: page.hasMore,
  };
}

export const loadSessions = async (options?: {
  repoPath?: string;
  status?: SessionStatus;
  limit?: number;
  offset?: number;
  forceRefresh?: boolean;
}) => {
  const store = getStore();
  const { forceRefresh = false } = options || {};

  const lastLoaded = store.get(sessionLastLoadedAtom);
  const now = Date.now();

  if (
    !forceRefresh &&
    lastLoaded &&
    now - lastLoaded < BULK_CACHE_DURATION_MS
  ) {
    return;
  }

  store.set(sessionLoadingAtom, true);
  store.set(sessionErrorAtom, null);

  try {
    const filter: SessionFilter | undefined =
      options?.repoPath || options?.status || options?.limit || options?.offset
        ? {
            repoPath: options?.repoPath,
            status: options?.status,
            limit: options?.limit,
            offset: options?.offset,
          }
        : undefined;

    const importedPagePromises = IMPORTED_HISTORY_SOURCES.map((source) =>
      source.listSessions({}).then(
        (page) => ({ status: "fulfilled" as const, source, value: page }),
        (reason: unknown) => ({ status: "rejected" as const, source, reason })
      )
    );

    const [response, cursorPageResult, ...importedPageResults] =
      await Promise.all([
        sessionAggregateList(filter),
        cursorIdeListSessions({}).then(
          (page) => ({ status: "fulfilled" as const, value: page }),
          (reason: unknown) => ({ status: "rejected" as const, reason })
        ),
        ...importedPagePromises,
      ]);

    const fetched: Session[] = toFrontendSessions(
      (response as SessionListResponse).sessions
    );

    if (cursorPageResult.status === "fulfilled") {
      fetched.push(
        ...cursorPageResult.value.sessions.map(cursorIdeRowToSession)
      );
    } else {
      log.warn(
        "[SessionAtom] Cursor IDE history load failed (continuing without it):",
        cursorPageResult.reason
      );
    }

    for (const result of importedPageResults) {
      if (result.status === "fulfilled") {
        fetched.push(
          ...result.value.sessions.map((row) =>
            importedHistoryRowToSession(row, result.source)
          )
        );
      } else {
        log.warn(
          `[SessionAtom] ${result.source.displayName} event load failed (continuing without it):`,
          result.reason
        );
      }
    }

    fetched.sort((sessionA, sessionB) =>
      (sessionB.updated_at || "").localeCompare(sessionA.updated_at || "")
    );

    store.set(sessionsAtom, fetched);
    persistSessions(fetched);
    store.set(sessionLastLoadedAtom, now);
  } catch (error) {
    log.error("[SessionAtom] Failed to load sessions:", error);
    store.set(
      sessionErrorAtom,
      error instanceof Error ? error.message : "Failed to load sessions"
    );
  } finally {
    store.set(sessionLoadingAtom, false);
  }
};

interface FetchPageResult {
  sessions: Session[];
  hasMore: boolean;
}

async function fetchAggregatePage(
  wireCategory: "cli" | "agent",
  offset: number,
  pageSize: number
): Promise<FetchPageResult> {
  const response = await sessionAggregateList({
    category: wireCategory,
    limit: pageSize + 1,
    offset,
    sortBy: "updated_at",
    sortOrder: "desc",
  });
  const primarySessions = toFrontendSessions(response.sessions).filter(
    isPrimarySessionListSession
  );
  return {
    sessions: primarySessions,
    hasMore: response.sessions.length > pageSize,
  };
}

async function fetchCursorIdePage(
  offset: number,
  pageSize: number
): Promise<FetchPageResult> {
  const effectivePageSize = Math.max(pageSize, CURSOR_IDE_SIDEBAR_PAGE_SIZE);
  const page = await cursorIdeListSessions({
    limit: effectivePageSize,
    offset,
  });
  return {
    sessions: page.sessions.map(cursorIdeRowToSession),
    hasMore: page.hasMore,
  };
}

async function loadCategoryPage(
  category: SessionListCategory,
  offset: number,
  pageSize: number
): Promise<FetchPageResult> {
  if (isImportedHistoryListCategory(category)) {
    const source = getImportedHistorySourceByListCategory(category);
    if (!source) return { sessions: [], hasMore: false };
    return loadImportedHistorySourcePage(source, offset, pageSize);
  }

  switch (category) {
    case "cli_agent":
      return fetchAggregatePage("cli", offset, pageSize);
    case "rust_agent":
      return fetchAggregatePage("agent", offset, pageSize);
    case "cursor_ide":
      return fetchCursorIdePage(offset, pageSize);
  }
}

function replaceFirstPageForCategory(
  category: SessionListCategory,
  prev: readonly Session[],
  incoming: readonly Session[]
): Session[] {
  if (category === "cursor_ide") {
    return replaceCursorIdeFirstPage(prev, incoming);
  }
  if (isImportedHistoryListCategory(category)) {
    const source = getImportedHistorySourceByListCategory(category);
    return source
      ? replaceExternalHistorySourceFirstPage(prev, incoming, source)
      : mergeSessions(prev, incoming);
  }
  return mergeSessions(prev, incoming);
}

export const loadSidebarSessions = async (options?: {
  pageSize?: number;
  forceRefresh?: boolean;
}) => {
  const store = getStore();
  const pageSize = options?.pageSize ?? SESSION_SIDEBAR_PAGE_SIZE;
  const { forceRefresh = false } = options ?? {};

  const lastLoaded = store.get(sessionLastLoadedAtom);
  const now = Date.now();

  if (
    !forceRefresh &&
    lastLoaded &&
    now - lastLoaded < BULK_CACHE_DURATION_MS
  ) {
    return;
  }

  store.set(sessionLoadingAtom, true);
  store.set(sessionErrorAtom, null);
  store.set(sessionPaginationAtom, resetPaginationState());

  for (const category of SESSION_LIST_CATEGORIES) {
    setPaginationFor(category, { loading: true });
  }

  await Promise.allSettled(
    SESSION_LIST_CATEGORIES.map(async (category) => {
      try {
        const { sessions, hasMore } = await loadCategoryPage(
          category,
          0,
          pageSize
        );
        store.set(sessionsAtom, (prev) =>
          replaceFirstPageForCategory(category, prev, sessions)
        );
        setPaginationFor(category, {
          loaded: sessions.length,
          hasMore,
          loading: false,
        });
      } catch (error) {
        log.warn(`[SessionAtom] ${category} initial page failed:`, error);
        setPaginationFor(category, { loading: false });
      }
    })
  );

  const merged = store.get(sessionsAtom);
  persistSessions(merged);
  store.set(sessionLastLoadedAtom, now);
  store.set(sessionLoadingAtom, false);
};

export const refreshCursorIdeSidebarSessions = async (
  pageSize: number = SESSION_SIDEBAR_PAGE_SIZE
) => {
  const store = getStore();
  const category: SessionListCategory = "cursor_ide";
  const current = store.get(sessionPaginationAtom)[category];
  if (current.loading) return;

  setPaginationFor(category, { loading: true });

  try {
    const refreshPageSize = Math.max(pageSize, current.loaded);
    const { sessions, hasMore } = await loadCategoryPage(
      category,
      0,
      refreshPageSize
    );
    store.set(sessionsAtom, (prev) =>
      replaceCursorIdeFirstPage(prev, sessions)
    );
    const loaded =
      current.loaded > sessions.length ? current.loaded : sessions.length;
    setPaginationFor(category, {
      loaded,
      hasMore:
        current.loaded > sessions.length ? current.hasMore || hasMore : hasMore,
      loading: false,
    });
    persistSessions(store.get(sessionsAtom));
  } catch (error) {
    log.warn("[SessionAtom] Cursor IDE refresh failed:", error);
    setPaginationFor(category, { loading: false });
  }
};

export const loadMoreCategory = async (
  category: SessionListCategory,
  pageSize: number = SESSION_SIDEBAR_PAGE_SIZE
) => {
  const store = getStore();
  const current = store.get(sessionPaginationAtom)[category];
  if (current.loading || !current.hasMore) return;

  setPaginationFor(category, { loading: true });

  try {
    const { sessions, hasMore } = await loadCategoryPage(
      category,
      current.loaded,
      pageSize
    );
    store.set(sessionsAtom, (prev) => mergeSessions(prev, sessions));
    setPaginationFor(category, {
      loaded: current.loaded + sessions.length,
      hasMore,
      loading: false,
    });
    persistSessions(store.get(sessionsAtom));
  } catch (error) {
    log.warn(`[SessionAtom] loadMoreCategory(${category}) failed:`, error);
    setPaginationFor(category, { loading: false });
  }
};

export const __TESTS_ONLY = {
  mergeSessions,
  replaceExternalHistorySourceFirstPage,
};
