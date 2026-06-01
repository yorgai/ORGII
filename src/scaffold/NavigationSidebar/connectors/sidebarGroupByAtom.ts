/**
 * Sidebar group-by preference atom
 *
 * Persists the workstation sidebar's `GroupByMode` to localStorage so the user's
 * sort/grouping choice survives reloads. Used only by `WorkstationSidebarConnector`
 * — keep colocated rather than promoting to `src/store/`.
 */
import { atomWithStorage } from "jotai/utils";

import { GROUP_BY_MODES, type GroupByMode } from "./types";

const STORAGE_KEY = "orgii:sidebarGroupBy";
const DEFAULT_MODE: GroupByMode = "byTime";

const KNOWN_MODES = new Set<GroupByMode>(GROUP_BY_MODES);

function parseStored(raw: unknown): GroupByMode {
  if (typeof raw !== "string") return DEFAULT_MODE;
  if (KNOWN_MODES.has(raw as GroupByMode)) return raw as GroupByMode;
  return DEFAULT_MODE;
}

const storage = {
  getItem(key: string, initialValue: GroupByMode): GroupByMode {
    if (typeof window === "undefined") return initialValue;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored == null) return initialValue;
      return parseStored(JSON.parse(stored) as unknown);
    } catch {
      return initialValue;
    }
  },
  setItem(key: string, value: GroupByMode) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, JSON.stringify(value));
  },
  removeItem(key: string) {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
  },
};

export const sidebarGroupByAtom = atomWithStorage<GroupByMode>(
  STORAGE_KEY,
  DEFAULT_MODE,
  storage,
  { getOnInit: true }
);
sidebarGroupByAtom.debugLabel = "sidebarGroupByAtom";
