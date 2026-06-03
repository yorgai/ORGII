/**
 * Cursor mode-list cache (module-level, app-wide).
 *
 * Cursor's unified-mode set (Agent / Plan / Debug / Ask / Multitask /
 * Project) is essentially static — the same six entries across Cursor
 * builds that support unified modes. Even more skewed toward "fetch
 * once, share everywhere" than the model-list cache.
 *
 * No `globalDefault` field. Mode is per-composer in Cursor — there's
 * no "default mode for new chats" surface to read — so the pill shows
 * the per-composer last mode (or `agent` when there's nothing recorded).
 *
 * Implementation delegates boilerplate to `createPillCache` and keeps
 * only the mode-specific fetch logic here.
 */
import {
  type CursorModeEntry,
  type CursorModeSource,
  cursorBridgeListModes,
} from "@src/api/tauri/cursorBridge";

import { createPillCache } from "../createPillCache";

export interface CursorModeCacheState {
  modes: CursorModeEntry[];
  source: CursorModeSource;
  loading: boolean;
  error: string | null;
  fetchedAt: number | null;
}

/** Cursor's mode set is small and stable; re-fetch every 4 hours. */
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

const cache = createPillCache<CursorModeCacheState>({
  initialState: {
    modes: [],
    source: "bundled",
    loading: false,
    error: null,
    fetchedAt: null,
  },
  ttlMs: CACHE_TTL_MS,
  async doFetch() {
    const list = await cursorBridgeListModes();
    return {
      modes: list.modes,
      source: list.source,
    };
  },
});

export const getCursorModeCacheState = cache.getState;
export const subscribeCursorModeCache = cache.subscribe;
export const fetchCursorModeCache = cache.fetch;
export const resetCursorModeCacheForTests = cache.resetForTests;
