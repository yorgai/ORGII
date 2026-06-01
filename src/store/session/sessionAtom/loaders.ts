/**
 * Session Loaders
 *
 * Two complementary loading paths:
 *
 *  - `loadSessions()` — legacy "load everything (with limit/offset)" entry
 *    used by panels that want a single flat list across all categories
 *    (Chat history panel, Simulator panel, useSessionManager). Behavior
 *    preserved verbatim except for two non-breaking improvements:
 *      1. The atom is **not blanked** while a refresh is in flight — fresh
 *         results swap in atomically only on success. Failure keeps the
 *         previous list so a transient RPC error never empties the sidebar.
 *      2. After a successful merge we persist the result via
 *         `persistSessions()` so the next cold start renders instantly.
 *
 *  - `loadSidebarSessions()` / `loadMoreCategory()` — sidebar-specific
 *    paginated loaders. Each category fetches its own top-N page so a heavy
 *    user with thousands of CLI sessions doesn't pay for the long tail just
 *    to render the most-recent rows. Per-category `hasMore` state lives in
 *    `sessionPaginationAtom` so the sidebar can render a "Load more" row
 *    only when more rows are actually available.
 */
import {
  type CursorIdeSessionRow,
  cursorIdeListSessions,
} from "@src/api/tauri/cursorIde";
import {
  type SessionFilter,
  type SessionListResponse,
  sessionAggregateList,
  toFrontendSessions,
} from "@src/api/tauri/session";
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
  SESSION_SIDEBAR_PAGE_SIZE,
  type SessionListCategory,
  type SessionPaginationMap,
  resetPaginationState,
  sessionPaginationAtom,
} from "./paginationAtoms";
import { persistSessions } from "./persistence";
import type { Session, SessionStatus } from "./types";

// ============================================
// Helpers
// ============================================

/**
 * Normalize Cursor's free-form composer status into our canonical
 * `SessionStatus` enum. Cursor IDE history rows are read-only artifacts and
 * always come back with `is_active === false`; we only emit `running` for
 * the live composer (excluded by the Rust layer in this list).
 */
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
    // Stamp the Cursor brand icon so sidebar / Ops Control /
    // Kanban resolvers all pick up "cursor" instead of falling
    // through to the generic Bot + "Other" pair.
    agentIconId: "cursor",
  };
}

const getStore = () => getInstrumentedStore();

// Cursor IDE history is the only category grouped primarily by time in the
// sidebar. A 10-row category page can be entirely "Today", hiding valid older
// rows and making the time buckets look incomplete.
const CURSOR_IDE_SIDEBAR_PAGE_SIZE = 50;

/**
 * Replace any previously-known rows for `incoming.session_id`s with the
 * incoming versions, then re-sort by recency. Rows whose ids are not in
 * `incoming` are kept untouched — this is what makes `loadMoreCategory()`
 * additive instead of destructive.
 */
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

function replaceCursorIdeFirstPage(
  prev: readonly Session[],
  incoming: readonly Session[]
): Session[] {
  const retained = prev.filter(
    (session) => !isCursorIdeSession(session.session_id)
  );
  return mergeSessions(retained, incoming);
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

// ============================================
// Legacy bulk loader (kept for non-sidebar callers)
// ============================================

const BULK_CACHE_DURATION_MS = 5 * 60 * 1000;

/**
 * Load a flat session list across all categories. This is the legacy entry
 * used by panels that don't need per-category pagination (Chat history panel,
 * Simulator, useSessionManager, etc.). The sidebar uses `loadSidebarSessions`
 * instead.
 *
 * Behavior:
 * - Honors a 5-minute soft cache via `sessionLastLoadedAtom` unless
 *   `forceRefresh: true`.
 * - Sets `sessionLoadingAtom` to `true` while the fetch is in flight; the
 *   atom value is left untouched (no blank flash).
 * - On success, merges results into `sessionsAtom` and persists.
 * - On failure, sets `sessionErrorAtom` and leaves `sessionsAtom` alone.
 */
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

    const [response, cursorPageResult]: [
      SessionListResponse,
      PromiseSettledResult<{ sessions: CursorIdeSessionRow[] }>,
    ] = await Promise.all([
      sessionAggregateList(filter),
      cursorIdeListSessions({
        // The legacy bulk path doesn't carry a UI cap, so request the
        // backend default (200). The new sidebar path is paginated and
        // will request smaller pages.
      }).then(
        (page) => ({ status: "fulfilled" as const, value: page }),
        (reason: unknown) => ({ status: "rejected" as const, reason })
      ),
    ]);

    const fetched: Session[] = toFrontendSessions(response.sessions);

    if (cursorPageResult.status === "fulfilled") {
      fetched.push(
        ...cursorPageResult.value.sessions.map(cursorIdeRowToSession)
      );
    } else {
      console.warn(
        "[SessionAtom] Cursor IDE history load failed (continuing without it):",
        cursorPageResult.reason
      );
    }

    fetched.sort((sessionA, sessionB) =>
      (sessionB.updated_at || "").localeCompare(sessionA.updated_at || "")
    );

    store.set(sessionsAtom, fetched);
    persistSessions(fetched);
    store.set(sessionLastLoadedAtom, now);
  } catch (error) {
    console.error("[SessionAtom] Failed to load sessions:", error);
    store.set(
      sessionErrorAtom,
      error instanceof Error ? error.message : "Failed to load sessions"
    );
  } finally {
    store.set(sessionLoadingAtom, false);
  }
};

// ============================================
// Sidebar paginated loaders
// ============================================

interface FetchPageResult {
  sessions: Session[];
  hasMore: boolean;
}

async function fetchAggregatePage(
  wireCategory: "cli" | "agent",
  offset: number,
  pageSize: number
): Promise<FetchPageResult> {
  // Ask for `pageSize + 1`; if we get the extra row, more pages exist.
  // OS Agent + SDE Agent both live under the wire category "agent" so a
  // single fetch covers both for the purposes of `rust_agent` pagination.
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
  switch (category) {
    case "cli_agent":
      return fetchAggregatePage("cli", offset, pageSize);
    case "rust_agent":
      return fetchAggregatePage("agent", offset, pageSize);
    case "cursor_ide":
      return fetchCursorIdePage(offset, pageSize);
  }
}

/**
 * Load the first page for every category. Used on sidebar mount.
 *
 * Each category is fetched in parallel; whichever resolves first updates the
 * atom incrementally so the UI doesn't wait for the slowest one. Failures of
 * individual categories are logged but never throw — the sidebar will still
 * render whatever did load.
 */
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

  const categories: readonly SessionListCategory[] = [
    "cli_agent",
    "rust_agent",
    "cursor_ide",
  ];

  // Mark all categories as loading up front so the sidebar can render one
  // unified spinner state instead of three independent ones.
  for (const category of categories) {
    setPaginationFor(category, { loading: true });
  }

  await Promise.allSettled(
    categories.map(async (category) => {
      try {
        const { sessions, hasMore } = await loadCategoryPage(
          category,
          0,
          pageSize
        );
        store.set(sessionsAtom, (prev) =>
          category === "cursor_ide"
            ? replaceCursorIdeFirstPage(prev, sessions)
            : mergeSessions(prev, sessions)
        );
        setPaginationFor(category, {
          loaded: sessions.length,
          hasMore,
          loading: false,
        });
      } catch (error) {
        console.warn(`[SessionAtom] ${category} initial page failed:`, error);
        setPaginationFor(category, { loading: false });
      }
    })
  );

  // Persist the merged result once all categories have settled.
  const merged = store.get(sessionsAtom);
  persistSessions(merged);
  store.set(sessionLastLoadedAtom, now);
  store.set(sessionLoadingAtom, false);
};

/**
 * Refresh only the first Cursor IDE sidebar page. This lets the sidebar pick up
 * Cursor `state.vscdb` activity without polling CLI/Rust session lists.
 */
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
    console.warn(
      "[SessionAtom] refreshCursorIdeSidebarSessions failed:",
      error
    );
    setPaginationFor(category, { loading: false });
  }
};

/**
 * Fetch the next page for a single category. No-op if a fetch is already in
 * flight for this category or the backend has signaled `hasMore: false`.
 */
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
    console.warn(`[SessionAtom] loadMoreCategory(${category}) failed:`, error);
    setPaginationFor(category, { loading: false });
  }
};

// Internal helpers exported for unit tests.
export const __TESTS_ONLY = { mergeSessions };
