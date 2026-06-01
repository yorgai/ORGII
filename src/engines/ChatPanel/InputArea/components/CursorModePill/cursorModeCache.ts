/**
 * Cursor mode-list cache (module-level, app-wide).
 *
 * Cursor's unified-mode set (Agent / Plan / Debug / Ask / Multitask /
 * Project) is essentially static — the live `composerModesService`
 * picker is the same six entries on every Cursor build that supports
 * unified modes — so the cache here is even more skewed toward
 * "fetch once, share everywhere" than the model-list cache. Same
 * shape as `cursorModelCache`: a single mutable record kept outside
 * React, listener fan-out via `Set<Listener>`, and dedupe of
 * concurrent fetches on the in-flight promise.
 *
 * No `globalDefault` field. Mode is per-composer in Cursor — there's
 * no "default mode for new chats" surface to read — so the pill
 * just shows the per-composer last mode (or `agent` when the
 * composer doesn't have one yet).
 */
import {
  type CursorModeEntry,
  type CursorModeSource,
  cursorBridgeListModes,
} from "@src/api/tauri/cursorBridge";

export interface CursorModeCacheState {
  /** Cached list. Empty array before first successful fetch. */
  modes: CursorModeEntry[];
  /** Source the last successful fetch came from. */
  source: CursorModeSource;
  /** True while a fetch is in flight (initial or refresh). */
  loading: boolean;
  /** Last error message, or `null`. Cleared on the next success. */
  error: string | null;
  /** ms-epoch of the last successful fetch, or `null`. */
  fetchedAt: number | null;
}

type Listener = (state: CursorModeCacheState) => void;

/**
 * Cursor's mode set is small and stable, but can change between Cursor
 * releases. Re-fetch once per session (after 4 hours of uptime) so the
 * bundled fallback doesn't permanently mask a new mode that Cursor added.
 */
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

let state: CursorModeCacheState = {
  modes: [],
  source: "bundled",
  loading: false,
  error: null,
  fetchedAt: null,
};

const listeners = new Set<Listener>();
let inflight: Promise<void> | null = null;

function notify(): void {
  for (const listener of listeners) {
    listener(state);
  }
}

function setState(patch: Partial<CursorModeCacheState>): void {
  state = { ...state, ...patch };
  notify();
}

export function getCursorModeCacheState(): CursorModeCacheState {
  return state;
}

export function subscribeCursorModeCache(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Trigger a `listModes` round-trip. Concurrent callers share the
 * same in-flight promise so we never fire two CDP evals at once.
 *
 * - Without `force` (the default): skip when a successful fetch is
 *   already cached AND it is still within the TTL window.
 * - With `force: true`: always hits the backend (footer refresh).
 *   Force calls do NOT coalesce onto an existing in-flight request.
 */
export async function fetchCursorModeCache(
  options: { force?: boolean } = {}
): Promise<void> {
  const { force = false } = options;

  const isFresh =
    state.fetchedAt !== null &&
    state.error === null &&
    Date.now() - state.fetchedAt < CACHE_TTL_MS;

  if (!force && isFresh) {
    return;
  }

  // Non-forced calls coalesce; forced calls start a fresh request.
  if (inflight && !force) {
    return inflight;
  }

  setState({ loading: true, error: null });

  inflight = (async () => {
    try {
      const list = await cursorBridgeListModes();
      setState({
        modes: list.modes,
        source: list.source,
        loading: false,
        error: null,
        fetchedAt: Date.now(),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setState({ loading: false, error: reason });
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Wipe the cache without re-fetching. Used by tests; production code
 * should prefer `fetchCursorModeCache({ force: true })`.
 */
export function resetCursorModeCacheForTests(): void {
  state = {
    modes: [],
    source: "bundled",
    loading: false,
    error: null,
    fetchedAt: null,
  };
  inflight = null;
  notify();
}
