/**
 * Debounced Storage Adapter
 *
 * Custom storage adapter for `atomWithStorage` that debounces writes to
 * prevent localStorage from blocking the main thread.
 *
 * Storage layout (single key `workstation:layout-v2`):
 *
 *   {
 *     mainPane: { tabs: WorkStationTab[]; activeTabId: string | null },
 *   }
 *
 * Tauri-only app + clean-break upgrade from `workstation:layout-v1`
 * (which carried a split-pane tree and per-host pane buckets that no
 * longer exist). Old keys are ignored — the user's open-tab list will
 * reset once on first launch after the upgrade.
 */
import type { PanelState, WorkStationLayoutState } from "./types";

export const LAYOUT_STORAGE_KEY = "workstation:layout-v2";

function validatePanelState(value: unknown): PanelState {
  if (!value || typeof value !== "object") {
    return { tabs: [], activeTabId: null };
  }
  const candidate = value as Record<string, unknown>;
  return {
    tabs: Array.isArray(candidate.tabs)
      ? (candidate.tabs as PanelState["tabs"])
      : [],
    activeTabId:
      typeof candidate.activeTabId === "string" ? candidate.activeTabId : null,
  };
}

/**
 * Creates a debounced localStorage storage adapter for `atomWithStorage`.
 *
 * PERFORMANCE: prevents synchronous localStorage writes from blocking the
 * main thread. Reads stay synchronous (needed for hydration); writes are
 * debounced.
 */
export function createDebouncedStorage<T>(delay = 100) {
  const pendingWrites = new Map<
    string,
    { value: T; timeoutId: ReturnType<typeof setTimeout> }
  >();

  return {
    getItem: (key: string, initialValue: T): T => {
      try {
        const stored = localStorage.getItem(key);
        if (!stored) return initialValue;

        const parsed = JSON.parse(stored);
        if (!parsed || typeof parsed !== "object" || !("mainPane" in parsed)) {
          return initialValue;
        }
        return {
          mainPane: validatePanelState(
            (parsed as Record<string, unknown>).mainPane
          ),
        } as T;
      } catch {
        return initialValue;
      }
    },
    setItem: (key: string, value: T): void => {
      const pending = pendingWrites.get(key);
      if (pending) clearTimeout(pending.timeoutId);

      const timeoutId = setTimeout(() => {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch (err) {
          console.error(
            "[workStationTabs] Failed to persist to localStorage:",
            err
          );
        }
        pendingWrites.delete(key);
      }, delay);

      pendingWrites.set(key, { value, timeoutId });
    },
    removeItem: (key: string): void => {
      const pending = pendingWrites.get(key);
      if (pending) {
        clearTimeout(pending.timeoutId);
        pendingWrites.delete(key);
      }
      localStorage.removeItem(key);
    },
  };
}

export const debouncedLayoutStorage =
  createDebouncedStorage<WorkStationLayoutState>(100);
