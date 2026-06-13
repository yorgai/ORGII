/**
 * useCursorModels
 *
 * Drives the Cursor-IDE model picker. Three pieces of state, each
 * with its own lifecycle:
 *
 * 1. **Seed model** — `getComposerModel(composerId)` is one cheap
 *    SELECT against `cursorDiskKV` and tells us which model the
 *    composer last *used*. Loaded once on mount per composer; gives
 *    the pill a real label before the user ever opens the dropdown.
 *    Falls back to the global default (see below) when the per-
 *    composer row has no `modelConfig` recorded yet.
 * 2. **Picked model** — what the user explicitly chose during the
 *    current draft. Layered on top of the seed when present; mid-
 *    draft selection is local until they hit send.
 * 3. **Available models** — `listModels()` is heavier (live CDP path
 *    plus disk fallback) so the result is cached app-wide via
 *    `cursorModelCache` — every pill instance shares the same in-
 *    memory snapshot. First mount triggers the fetch; subsequent
 *    mounts hit the cache instantly. The footer Refresh button
 *    bypasses the cache via `force: true`.
 *
 * The actual `setModel` CDP call is *not* fired on selection — we
 * let the adapter's `sendMessage` do it (composer-targeted) right
 * before the prompt is submitted. That way picking a model and then
 * changing your mind doesn't churn through CDP eval round-trips.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { cursorBridgeGetComposerModel } from "@src/api/tauri/cursorBridge";
import type {
  CursorModelEntry,
  CursorModelSource,
} from "@src/api/tauri/cursorBridge";
import { createLogger } from "@src/hooks/logger";

import {
  type CursorModelCacheState,
  fetchCursorModelCache,
  getCursorModelCacheState,
  subscribeCursorModelCache,
} from "./cursorModelCache";

const log = createLogger("useCursorModels");

export interface UseCursorModelsResult {
  /**
   * Effective seed for the pill: the composer's last-used model if
   * we have one, otherwise Cursor's global default composer model.
   * Distinct from `effectiveModel` because callers (e.g. the
   * SessionCreator launch path) may want to know whether the user
   * has *actually* picked something vs. inheriting the default.
   */
  seedModel: string | null;
  /** User's explicit pick this draft, or `null` if untouched. */
  pickedModel: string | null;
  /** What the pill should show (picked > seed). */
  effectiveModel: string | null;
  /** All models the probe knows about, after dropdown is opened. */
  models: CursorModelEntry[];
  /** Source the model list came from (`live` | `disk` | `empty`). */
  modelSource: CursorModelSource;
  /** Spinner flag for the dropdown body. */
  loading: boolean;
  /** Most recent fetch error, or `null`. */
  error: string | null;
  /** Trigger a fresh `listModels()` round-trip (bypass cache). */
  refresh: () => Promise<void>;
  /** Stash the user's picked model. */
  selectModel: (modelName: string) => void;
}

function useCursorModelCache(): CursorModelCacheState {
  return useSyncExternalStore(
    subscribeCursorModelCache,
    getCursorModelCacheState,
    getCursorModelCacheState
  );
}

/**
 * Bundled per-composer state. Co-locating the three values lets us
 * reset them in a single `setSeedState({...})` during render when
 * `composerId` flips — the React-docs-blessed pattern for
 * "derive state from a prop change" without a useEffect that lints
 * as `react-hooks/set-state-in-effect`.
 */
interface SeedState {
  /** Composer this state belongs to. `null` for the creator path. */
  composerId: string | null;
  /** Composer's last-used model from `state.vscdb`, or `null`. */
  perComposerModel: string | null;
  /**
   * `true` once the per-composer SELECT has resolved (or the
   * composer-less creator path — there's nothing to wait for there).
   * Gates the global-default fallback so the pill doesn't briefly
   * flash "Auto" before settling on the real per-composer value.
   */
  seedResolved: boolean;
}

const NEUTRAL_SEED: SeedState = {
  composerId: null,
  perComposerModel: null,
  seedResolved: true,
};

export function useCursorModels(
  composerId: string | null
): UseCursorModelsResult {
  const cache = useCursorModelCache();
  const [pickedModel, setPickedModel] = useState<string | null>(null);
  const [seedState, setSeedState] = useState<SeedState>(NEUTRAL_SEED);

  // Reset bundle when `composerId` changes — set during render, not
  // in an effect, so we stay on React's recommended path for
  // prop-derived state. With a `composerId`, `seedResolved` flips
  // back to `false` so the pill waits for the SELECT below; without
  // one (creator path) it stays `true` since there's nothing to wait
  // for. Picked-model also resets — picking "Sonnet 4.5" in one
  // chat shouldn't bleed into another.
  if (seedState.composerId !== composerId) {
    setSeedState({
      composerId,
      perComposerModel: null,
      seedResolved: composerId === null,
    });
    setPickedModel(null);
  }

  // Seed the per-composer last-used model. One SELECT, no CDP.
  // The setState calls happen inside the async IIFE (post-await),
  // not synchronously in the effect body — that's why this effect
  // doesn't trip `react-hooks/set-state-in-effect`.
  useEffect(() => {
    if (!composerId) return;
    let cancelled = false;
    void (async () => {
      try {
        const name = await cursorBridgeGetComposerModel(composerId);
        if (cancelled) return;
        setSeedState((prev) =>
          prev.composerId === composerId
            ? { ...prev, perComposerModel: name, seedResolved: true }
            : prev
        );
      } catch (err) {
        // Non-fatal — pill falls back to the global default and the
        // picker still works.
        log.warn(
          "[useCursorModels] getComposerModel failed",
          err instanceof Error ? err.message : String(err)
        );
        if (cancelled) return;
        setSeedState((prev) =>
          prev.composerId === composerId
            ? { ...prev, perComposerModel: null, seedResolved: true }
            : prev
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [composerId]);

  // Prime the shared cache on first mount of *any* pill instance.
  // `fetchCursorModelCache` short-circuits when a successful fetch
  // is already cached, so subsequent mounts pay zero cost.
  useEffect(() => {
    void fetchCursorModelCache();
  }, []);

  const refresh = useCallback(async () => {
    await fetchCursorModelCache({ force: true });
  }, []);

  const selectModel = useCallback((modelName: string) => {
    setPickedModel(modelName);
  }, []);

  // Final seed = per-composer model when present, else Cursor's
  // global default — once the SELECT has resolved.
  const seedModel = seedState.seedResolved
    ? (seedState.perComposerModel ?? cache.globalDefaultModel)
    : null;
  const effectiveModel = pickedModel ?? seedModel;

  return {
    seedModel,
    pickedModel,
    effectiveModel,
    models: cache.models,
    modelSource: cache.source,
    loading: cache.loading,
    error: cache.error,
    refresh,
    selectModel,
  };
}
