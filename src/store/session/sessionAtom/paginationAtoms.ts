/**
 * Per-category pagination state for the sidebar's session list.
 *
 * The sidebar fetches each category in its own page (top N per category, see
 * `SESSION_SIDEBAR_PAGE_SIZE`) so a power user with 5000 CLI sessions doesn't
 * make us pull all of them just to render the "Today" bucket. The state below
 * remembers, per category:
 *  - `loaded`  — how many rows we've fetched so far (offset for the next page)
 *  - `hasMore` — backend signaled that more rows exist beyond `loaded`
 *  - `loading` — a fetch is currently in flight (so the sidebar can disable
 *                the "Load more" row to prevent duplicate calls)
 *
 * The `cursor_ide` category is special because Cursor IDE history rows come
 * from a different RPC (`cursor_ide_list_sessions`) than the OS Agent / SDE
 * Agent / CLI rows (`session_aggregate_list`). They share the same atom shape
 * because the sidebar treats them uniformly.
 */
import { atom } from "jotai";

export type SessionListCategory = "cli_agent" | "rust_agent" | "cursor_ide";

export const SESSION_LIST_CATEGORIES: readonly SessionListCategory[] = [
  "cli_agent",
  "rust_agent",
  "cursor_ide",
];

/**
 * Default page size per category. 10 rows is enough to cover the most-recent
 * "Today" / "Yesterday" buckets for an average user; the "Load more" row
 * fetches another page on demand.
 */
export const SESSION_SIDEBAR_PAGE_SIZE = 10;

export interface CategoryPaginationState {
  loaded: number;
  hasMore: boolean;
  loading: boolean;
}

const DEFAULT_STATE: CategoryPaginationState = {
  loaded: 0,
  hasMore: false,
  loading: false,
};

export type SessionPaginationMap = Readonly<
  Record<SessionListCategory, CategoryPaginationState>
>;

function makeInitialMap(): SessionPaginationMap {
  return {
    cli_agent: { ...DEFAULT_STATE },
    rust_agent: { ...DEFAULT_STATE },
    cursor_ide: { ...DEFAULT_STATE },
  };
}

export const sessionPaginationAtom =
  atom<SessionPaginationMap>(makeInitialMap());
sessionPaginationAtom.debugLabel = "sessionPaginationAtom";

export function resetPaginationState(): SessionPaginationMap {
  return makeInitialMap();
}
