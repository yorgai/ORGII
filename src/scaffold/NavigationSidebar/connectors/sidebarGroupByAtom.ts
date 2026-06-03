/**
 * Sidebar group-by preference atoms
 *
 * Persists sidebar grouping choices to localStorage so the user's
 * sort/grouping choice survives reloads. Used only by
 * `WorkstationSidebarConnector` — keep colocated rather than promoting to
 * `src/store/`.
 */
import { atomWithStorage } from "jotai/utils";

import {
  GROUP_BY_MODES,
  type GroupByMode,
  PROJECTS_GROUP_BY_MODES,
  type ProjectsGroupByMode,
} from "./types";

const STORAGE_KEY = "orgii:sidebarGroupBy";
const PROJECTS_STORAGE_KEY = "orgii:projectsSidebarGroupBy";
const DEFAULT_MODE: GroupByMode = "byTime";
const DEFAULT_PROJECTS_MODE: ProjectsGroupByMode = "byOrg";

const KNOWN_MODES = new Set<GroupByMode>(GROUP_BY_MODES);
const KNOWN_PROJECTS_MODES = new Set<ProjectsGroupByMode>(
  PROJECTS_GROUP_BY_MODES
);

function parseStored(raw: unknown): GroupByMode {
  if (typeof raw !== "string") return DEFAULT_MODE;
  if (KNOWN_MODES.has(raw as GroupByMode)) return raw as GroupByMode;
  return DEFAULT_MODE;
}

function parseStoredProjects(raw: unknown): ProjectsGroupByMode {
  if (typeof raw !== "string") return DEFAULT_PROJECTS_MODE;
  if (KNOWN_PROJECTS_MODES.has(raw as ProjectsGroupByMode)) {
    return raw as ProjectsGroupByMode;
  }
  return DEFAULT_PROJECTS_MODE;
}

function createStorage<T>(parseValue: (raw: unknown) => T) {
  return {
    getItem(key: string, initialValue: T): T {
      if (typeof window === "undefined") return initialValue;
      try {
        const stored = window.localStorage.getItem(key);
        if (stored == null) return initialValue;
        return parseValue(JSON.parse(stored) as unknown);
      } catch {
        return initialValue;
      }
    },
    setItem(key: string, value: T) {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    removeItem(key: string) {
      if (typeof window === "undefined") return;
      window.localStorage.removeItem(key);
    },
  };
}

export const sidebarGroupByAtom = atomWithStorage<GroupByMode>(
  STORAGE_KEY,
  DEFAULT_MODE,
  createStorage(parseStored),
  { getOnInit: true }
);
sidebarGroupByAtom.debugLabel = "sidebarGroupByAtom";

export const projectsSidebarGroupByAtom = atomWithStorage<ProjectsGroupByMode>(
  PROJECTS_STORAGE_KEY,
  DEFAULT_PROJECTS_MODE,
  createStorage(parseStoredProjects),
  { getOnInit: true }
);
projectsSidebarGroupByAtom.debugLabel = "projectsSidebarGroupByAtom";
