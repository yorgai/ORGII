/**
 * Cursor model-list cache (module-level, app-wide).
 *
 * Cursor's available-LLM list is an entitlement fact — what models
 * the user's Cursor account is allowed to use right now — identical
 * for every Cursor IDE pill we render. Hitting `cursor_bridge_list_models`
 * on every pill mount is wasteful; the live CDP path can take 1–3 s
 * when the probe isn't fully warm.
 *
 * The cache is kept outside React (no atom, no provider) so any pill
 * mounting after the first fetch immediately sees the cached list.
 * Subscribers are notified on every mutation via Set<Listener> fan-out.
 *
 * Cache TTL: model availability changes infrequently enough that a
 * 30-minute window is acceptable. Explicit `refresh({ force: true })`
 * bypasses TTL and dedup (the user hit the refresh button).
 *
 * Implementation delegates the boilerplate to `createPillCache` and
 * keeps only the model-specific fetch logic here.
 */
import {
  type CursorModelEntry,
  type CursorModelSource,
  cursorBridgeGetDefaultModel,
  cursorBridgeListModels,
} from "@src/api/tauri/cursorBridge";

import { createPillCache } from "../createPillCache";

export interface CursorModelCacheState {
  models: CursorModelEntry[];
  source: CursorModelSource;
  /**
   * Cursor's global default composer model — what a brand-new chat
   * would inherit. Cached alongside the model list because both come
   * from the same on-disk blob in Rust.
   */
  globalDefaultModel: string | null;
  loading: boolean;
  error: string | null;
  fetchedAt: number | null;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const cache = createPillCache<CursorModelCacheState>({
  initialState: {
    models: [],
    source: "empty",
    globalDefaultModel: null,
    loading: false,
    error: null,
    fetchedAt: null,
  },
  ttlMs: CACHE_TTL_MS,
  async doFetch() {
    // Both reads land on the same `state.vscdb` blob in Rust; fire in
    // parallel so the slower one doesn't gate the pill update.
    const [list, defaultModel] = await Promise.all([
      cursorBridgeListModels(),
      cursorBridgeGetDefaultModel().catch((err) => {
        // Default-model lookup is a soft-fail: if the global setting is
        // unreadable we can still render the picker; the pill just falls
        // back to the empty seed.
        // eslint-disable-next-line no-console
        console.warn(
          "[cursorModelCache] getDefaultModel failed",
          err instanceof Error ? err.message : String(err)
        );
        return null;
      }),
    ]);
    return {
      models: list.models,
      source: list.source,
      globalDefaultModel: defaultModel,
    };
  },
});

export const getCursorModelCacheState = cache.getState;
export const subscribeCursorModelCache = cache.subscribe;
export const fetchCursorModelCache = cache.fetch;
export const resetCursorModelCacheForTests = cache.resetForTests;
