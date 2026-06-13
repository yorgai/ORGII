/**
 * useCursorModes
 *
 * Drives the Cursor-IDE unified-mode picker. Mirrors `useCursorModels`
 * one-for-one: per-composer seed read once on mount, picked-mode
 * scratch space, shared cache for the available list. Differences:
 *
 *  - No `globalDefaultMode`. Cursor doesn't expose a "default mode
 *    for new chats" surface — modes are always per-composer — so the
 *    fallback when a composer has no recorded mode is the literal
 *    `"agent"` id (Cursor's first-launch default).
 *  - Bundled fallback for the list. Cursor's mode set is small and
 *    stable across versions, so when CDP is unreachable we serve a
 *    hard-coded copy (six modes) rather than going to disk. The
 *    cache hides that distinction from callers; `modeSource` just
 *    flips to `bundled` instead of `live`.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { cursorBridgeGetComposerMode } from "@src/api/tauri/cursorBridge";
import type {
  CursorModeEntry,
  CursorModeSource,
} from "@src/api/tauri/cursorBridge";
import { createLogger } from "@src/hooks/logger";

import {
  type CursorModeCacheState,
  fetchCursorModeCache,
  getCursorModeCacheState,
  subscribeCursorModeCache,
} from "./cursorModeCache";

const log = createLogger("useCursorModes");

/** Cursor's first-launch default mode id when nothing is recorded. */
const DEFAULT_MODE_ID = "agent";

export interface UseCursorModesResult {
  /**
   * Effective seed for the pill: the composer's last-used mode, or
   * `"agent"` when the composer has none recorded. Distinct from
   * `effectiveMode` because callers (e.g. SessionCreator) may want
   * to know whether the user has *actually* picked something vs.
   * inheriting the default.
   */
  seedMode: string | null;
  /** User's explicit pick this draft, or `null` if untouched. */
  pickedMode: string | null;
  /** What the pill should show (picked > seed). */
  effectiveMode: string | null;
  /** All modes the probe knows about. */
  modes: CursorModeEntry[];
  /** Source the mode list came from (`live` | `bundled`). */
  modeSource: CursorModeSource;
  /** Spinner flag for the dropdown body. */
  loading: boolean;
  /** Most recent fetch error, or `null`. */
  error: string | null;
  /** Trigger a fresh `listModes()` round-trip (bypass cache). */
  refresh: () => Promise<void>;
  /** Stash the user's picked mode. */
  selectMode: (modeId: string) => void;
}

function useCursorModeCache(): CursorModeCacheState {
  return useSyncExternalStore(
    subscribeCursorModeCache,
    getCursorModeCacheState,
    getCursorModeCacheState
  );
}

/**
 * Bundled per-composer state. Same React-prop-derived-state pattern
 * as `useCursorModels.SeedState`: reset together during render when
 * `composerId` flips so we never trip `react-hooks/set-state-in-effect`.
 */
interface SeedState {
  composerId: string | null;
  perComposerMode: string | null;
  /**
   * `true` once the per-composer SELECT has resolved (or the
   * composer-less creator path). Gates the agent-default fallback
   * so the pill doesn't briefly flash "Agent" before settling on
   * the real per-composer value.
   */
  seedResolved: boolean;
}

const NEUTRAL_SEED: SeedState = {
  composerId: null,
  perComposerMode: null,
  seedResolved: true,
};

export function useCursorModes(
  composerId: string | null
): UseCursorModesResult {
  const cache = useCursorModeCache();
  const [pickedMode, setPickedMode] = useState<string | null>(null);
  const [seedState, setSeedState] = useState<SeedState>(NEUTRAL_SEED);

  if (seedState.composerId !== composerId) {
    setSeedState({
      composerId,
      perComposerMode: null,
      seedResolved: composerId === null,
    });
    setPickedMode(null);
  }

  useEffect(() => {
    if (!composerId) return;
    let cancelled = false;
    void (async () => {
      try {
        const mode = await cursorBridgeGetComposerMode(composerId);
        if (cancelled) return;
        setSeedState((prev) =>
          prev.composerId === composerId
            ? { ...prev, perComposerMode: mode, seedResolved: true }
            : prev
        );
      } catch (err) {
        log.warn(
          "[useCursorModes] getComposerMode failed",
          err instanceof Error ? err.message : String(err)
        );
        if (cancelled) return;
        setSeedState((prev) =>
          prev.composerId === composerId
            ? { ...prev, perComposerMode: null, seedResolved: true }
            : prev
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [composerId]);

  useEffect(() => {
    void fetchCursorModeCache();
  }, []);

  const refresh = useCallback(async () => {
    await fetchCursorModeCache({ force: true });
  }, []);

  const selectMode = useCallback((modeId: string) => {
    setPickedMode(modeId);
  }, []);

  // Final seed = per-composer mode when present, else Cursor's
  // built-in `agent` default — once the SELECT has resolved.
  const seedMode = seedState.seedResolved
    ? (seedState.perComposerMode ?? DEFAULT_MODE_ID)
    : null;
  const effectiveMode = pickedMode ?? seedMode;

  return {
    seedMode,
    pickedMode,
    effectiveMode,
    modes: cache.modes,
    modeSource: cache.source,
    loading: cache.loading,
    error: cache.error,
    refresh,
    selectMode,
  };
}
