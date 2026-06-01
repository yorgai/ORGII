/**
 * Editor Cache Atom
 *
 * Caches FILE tabs per repo (max 20 files per repo, max 5 repos).
 *
 * IMPORTANT: Only FILE tabs are cached per-repo.
 * Terminal and Browser tabs are GLOBAL and NOT affected by repo switching.
 *
 * When switching repos:
 * - File tabs are saved to cache and swapped
 * - Terminal/Browser tabs stay in place (not touched)
 *
 * Moved from: src/store/tabs/editorCacheAtom.ts
 */
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

import type { EditorCacheMap, EditorRepoCache } from "./types";

// ============================================
// Constants
// ============================================

/** Maximum repos to cache in editor cache */
export const MAX_EDITOR_CACHE_REPOS = 5;

/** Maximum file tabs to cache per repo */
export const MAX_FILE_TABS_PER_REPO = 20;

// ============================================
// Storage Keys
// ============================================

const STORAGE_KEY_CACHE = "orgii-v2-editor-cache";
const STORAGE_KEY_ACTIVE_REPO = "orgii-v2-active-repo";

// ============================================
// Atoms
// ============================================

/**
 * Per-repo editor state cache
 */
export const editorCacheAtom = atomWithStorage<EditorCacheMap>(
  STORAGE_KEY_CACHE,
  {},
  {
    getItem: (key) => {
      try {
        const stored = localStorage.getItem(key);
        if (!stored) return {};
        return JSON.parse(stored) as EditorCacheMap;
      } catch {
        return {};
      }
    },
    setItem: (key, value) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
    removeItem: (key) => {
      localStorage.removeItem(key);
    },
  }
);
editorCacheAtom.debugLabel = "editorCacheAtom";

/**
 * Currently active repo path in code view
 */
export const activeEditorRepoAtom = atomWithStorage<string | null>(
  STORAGE_KEY_ACTIVE_REPO,
  null,
  {
    getItem: (key) => {
      try {
        const stored = localStorage.getItem(key);
        if (!stored) return null;
        return JSON.parse(stored) as string | null;
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
    removeItem: (key) => {
      localStorage.removeItem(key);
    },
  }
);
activeEditorRepoAtom.debugLabel = "activeEditorRepoAtom";

// ============================================
// Derived Atoms
// ============================================

/**
 * Get cached state for a specific repo
 */
export const getRepoCacheAtom = atom((get) => {
  const cache = get(editorCacheAtom);
  return (repoPath: string): EditorRepoCache | undefined => cache[repoPath];
});
getRepoCacheAtom.debugLabel = "getRepoCacheAtom";

/**
 * Get cached state for current active repo
 */
export const activeRepoCacheAtom = atom((get) => {
  const cache = get(editorCacheAtom);
  const activeRepo = get(activeEditorRepoAtom);
  if (!activeRepo) return undefined;
  return cache[activeRepo];
});
activeRepoCacheAtom.debugLabel = "activeRepoCacheAtom";

/**
 * Number of cached repos
 */
export const editorCacheSizeAtom = atom(
  (get) => Object.keys(get(editorCacheAtom)).length
);
editorCacheSizeAtom.debugLabel = "editorCacheSizeAtom";

// ============================================
// Action Atoms
// ============================================

/**
 * Save file tabs for a repo
 * Limits to MAX_FILE_TABS_PER_REPO (20) most recent tabs
 */
export const saveRepoCacheAtom = atom(
  null,
  (get, set, cacheEntry: EditorRepoCache) => {
    const cache = { ...get(editorCacheAtom) };

    // Limit file tabs to max per repo (keep most recent)
    const limitedFileTabs = cacheEntry.fileTabs.slice(-MAX_FILE_TABS_PER_REPO);

    // Add/update entry
    cache[cacheEntry.repoPath] = {
      ...cacheEntry,
      fileTabs: limitedFileTabs,
      lastAccessedAt: Date.now(),
    };

    // Prune repos if over limit (remove oldest repos)
    const entries = Object.entries(cache);
    if (entries.length > MAX_EDITOR_CACHE_REPOS) {
      const sorted = entries.sort(
        ([, a], [, b]) => a.lastAccessedAt - b.lastAccessedAt
      );
      const toRemove = sorted.slice(0, entries.length - MAX_EDITOR_CACHE_REPOS);
      for (const [path] of toRemove) {
        delete cache[path];
      }
    }

    set(editorCacheAtom, cache);
  }
);
saveRepoCacheAtom.debugLabel = "saveRepoCacheAtom";

/**
 * Clear cache for a specific repo
 */
export const clearRepoCacheAtom = atom(null, (get, set, repoPath: string) => {
  const cache = { ...get(editorCacheAtom) };
  delete cache[repoPath];
  set(editorCacheAtom, cache);
});
clearRepoCacheAtom.debugLabel = "clearRepoCacheAtom";

/**
 * Clear all editor cache
 */
export const clearAllEditorCacheAtom = atom(null, (_get, set) => {
  set(editorCacheAtom, {});
});
clearAllEditorCacheAtom.debugLabel = "clearAllEditorCacheAtom";

/**
 * Switch active repo (saves current, loads target)
 *
 * NOTE: The actual layout swap is handled by useEditorTabs hook.
 * This just updates which repo is considered "active".
 */
export const switchActiveRepoAtom = atom(
  null,
  (_get, set, repoPath: string | null) => {
    set(activeEditorRepoAtom, repoPath);
  }
);
switchActiveRepoAtom.debugLabel = "switchActiveRepoAtom";
