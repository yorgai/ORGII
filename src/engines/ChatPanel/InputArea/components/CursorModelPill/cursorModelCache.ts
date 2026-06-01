/**
 * Cursor model-list cache (module-level, app-wide).
 *
 * Cursor's available-LLM list is an *entitlement* fact — what models
 * the user's Cursor account is allowed to use right now — and is
 * therefore identical for every Cursor IDE pill we render: focused
 * session, SessionCreator, and any future surface. Hitting the
 * `cursor_bridge_list_models` Tauri command on every pill mount
 * is wasteful — the live CDP path can take 1–3 s when the probe
 * Cursor isn't fully warm, and the user pays that latency every time
 * they switch sidebar rows.
 *
 * The cache here is intentionally a *single* mutable record kept
 * outside React (no atom, no provider) so:
 *   - any pill mounting after the first fetch immediately sees the
 *     cached list — no flicker, no second `listModels` call.
 *   - concurrent fetches dedupe on the in-flight promise instead of
 *     racing two CDP round-trips.
 *   - explicit refresh (the footer button) bypasses the dedupe and
 *     replaces the cached value.
 *
 * Subscribers register a listener and get pinged on every cache
 * mutation (initial load, refresh, error). Listeners are weakly held
 * via `Set<Listener>`; pills clean up on unmount.
 *
 * Cache TTL: there is no automatic expiry. Cursor pushes new model
 * availability through its server but the changes are infrequent
 * enough that a stale list for the lifetime of the app session is
 * acceptable; if something *does* go stale the user can hit refresh.
 * The cache is wiped only on explicit `refresh({ force: true })`.
 */
import {
  type CursorModelEntry,
  type CursorModelSource,
  cursorBridgeGetDefaultModel,
  cursorBridgeListModels,
} from "@src/api/tauri/cursorBridge";

export interface CursorModelCacheState {
  /** Cached list. Empty array before first successful fetch. */
  models: CursorModelEntry[];
  /** Source the last successful fetch came from. */
  source: CursorModelSource;
  /**
   * Cursor's *global* default composer model — what a brand-new
   * chat would inherit. Lives alongside the model list because it's
   * also entitlement-scoped (one value for the whole user, not per
   * composer) and the two values are read from the same on-disk
   * blob in Rust. Cached together so we never have to fire a second
   * Tauri command for the seed.
   */
  globalDefaultModel: string | null;
  /** True while a fetch is in flight (initial or refresh). */
  loading: boolean;
  /** Last error message, or `null`. Cleared on the next success. */
  error: string | null;
  /** ms-epoch of the last successful fetch, or `null`. */
  fetchedAt: number | null;
}

type Listener = (state: CursorModelCacheState) => void;

/**
 * Model lists can change when the user upgrades/downgrades their Cursor
 * subscription or when Cursor pushes a server-side entitlement update.
 * Re-fetch automatically after this interval so the pill doesn't show a
 * permanently stale list if the app runs for many hours.
 */
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

let state: CursorModelCacheState = {
  models: [],
  source: "empty",
  globalDefaultModel: null,
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

function setState(patch: Partial<CursorModelCacheState>): void {
  state = { ...state, ...patch };
  notify();
}

export function getCursorModelCacheState(): CursorModelCacheState {
  return state;
}

export function subscribeCursorModelCache(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Trigger a `listModels` round-trip. Concurrent callers share the
 * same in-flight promise so we never fire two CDP evals at once.
 *
 * - Without `force` (the default): skip when a successful fetch is
 *   already cached AND it is still within the TTL window.
 * - With `force: true`: always hits the backend (footer refresh).
 *   Force calls do NOT coalesce onto an existing in-flight request —
 *   the in-flight request may have been started before the entitlement
 *   change that prompted the refresh, so its result would be stale.
 */
export async function fetchCursorModelCache(
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
      // Both reads land on the same `state.vscdb` blob in Rust, but
      // the Tauri commands themselves are independent — fire in
      // parallel so the slower one doesn't gate the pill update.
      const [list, defaultModel] = await Promise.all([
        cursorBridgeListModels(),
        cursorBridgeGetDefaultModel().catch((err) => {
          // Default-model lookup is a soft-fail signal: if the
          // global setting is unreadable we can still render the
          // picker; the pill just falls back to the empty seed.
          // eslint-disable-next-line no-console
          console.warn(
            "[cursorModelCache] getDefaultModel failed",
            err instanceof Error ? err.message : String(err)
          );
          return null;
        }),
      ]);
      setState({
        models: list.models,
        source: list.source,
        globalDefaultModel: defaultModel,
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
 * should prefer `fetchCursorModelCache({ force: true })`.
 */
export function resetCursorModelCacheForTests(): void {
  state = {
    models: [],
    source: "empty",
    globalDefaultModel: null,
    loading: false,
    error: null,
    fetchedAt: null,
  };
  inflight = null;
  notify();
}
