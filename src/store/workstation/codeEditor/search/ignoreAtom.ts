/**
 * Ignore Patterns State
 *
 * Jotai atoms for managing .orgiiignore patterns.
 * Patterns are loaded per-repository and cached.
 */
import { atom } from "jotai";

import {
  type IgnorePattern,
  type ParsedIgnoreFile,
  getDefaultPatterns,
} from "@src/config/ignorePatterns";

// ============================================
// Types
// ============================================

export interface IgnoreState {
  /** Patterns for the current repository */
  patterns: IgnorePattern[];
  /** Source of patterns (default or file) */
  source: "default" | "file";
  /** Path to .orgiiignore file if loaded from file */
  filePath?: string;
  /** Whether patterns are currently loading */
  loading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Last time patterns were loaded */
  lastLoaded: number | null;
}

/** Cache of patterns per repository path */
export type IgnorePatternsCache = Map<string, ParsedIgnoreFile>;

// ============================================
// Default State
// ============================================

const DEFAULT_STATE: IgnoreState = {
  patterns: getDefaultPatterns(),
  source: "default",
  loading: false,
  error: null,
  lastLoaded: null,
};

// ============================================
// Atoms
// ============================================

/**
 * Current ignore state for active repository
 */
export const ignoreStateAtom = atom<IgnoreState>(DEFAULT_STATE);
ignoreStateAtom.debugLabel = "ignoreStateAtom";

/**
 * Cache of loaded patterns per repository
 * Key: repository path, Value: parsed patterns
 */
export const ignoreCacheAtom = atom<IgnorePatternsCache>(new Map());
ignoreCacheAtom.debugLabel = "ignoreCacheAtom";

/**
 * Whether custom .orgiiignore file exists for current repo
 */
export const hasCustomIgnoreFileAtom = atom((get) => {
  const state = get(ignoreStateAtom);
  return state.source === "file";
});
hasCustomIgnoreFileAtom.debugLabel = "hasCustomIgnoreFileAtom";

/**
 * Get just the patterns (convenience accessor)
 */
export const ignorePatternsAtom = atom((get) => {
  return get(ignoreStateAtom).patterns;
});
ignorePatternsAtom.debugLabel = "ignorePatternsAtom";

/**
 * Check if patterns are loading
 */
export const ignorePatternsLoadingAtom = atom((get) => {
  return get(ignoreStateAtom).loading;
});
ignorePatternsLoadingAtom.debugLabel = "ignorePatternsLoadingAtom";

// ============================================
// Actions
// ============================================

/**
 * Set loading state
 */
export const setIgnoreLoadingAtom = atom(null, (get, set, loading: boolean) => {
  const current = get(ignoreStateAtom);
  set(ignoreStateAtom, { ...current, loading });
});

/**
 * Set patterns from parsed file
 */
export const setIgnorePatternsAtom = atom(
  null,
  (get, set, parsed: ParsedIgnoreFile) => {
    set(ignoreStateAtom, {
      patterns: parsed.patterns,
      source: parsed.source,
      filePath: parsed.filePath,
      loading: false,
      error: null,
      lastLoaded: Date.now(),
    });
  }
);

/**
 * Set error state
 */
export const setIgnoreErrorAtom = atom(null, (get, set, error: string) => {
  const current = get(ignoreStateAtom);
  set(ignoreStateAtom, {
    ...current,
    loading: false,
    error,
  });
});

/**
 * Reset to default patterns
 */
export const resetIgnorePatternsAtom = atom(null, (_get, set) => {
  set(ignoreStateAtom, DEFAULT_STATE);
});

/**
 * Cache patterns for a repository
 */
export const cacheIgnorePatternsAtom = atom(
  null,
  (get, set, repoPath: string, parsed: ParsedIgnoreFile) => {
    const cache = get(ignoreCacheAtom);
    const updated = new Map(cache);
    updated.set(repoPath, parsed);
    set(ignoreCacheAtom, updated);
  }
);

/**
 * Get cached patterns for a repository
 */
export const getCachedIgnorePatternsAtom = atom((get) => (repoPath: string) => {
  const cache = get(ignoreCacheAtom);
  return cache.get(repoPath) || null;
});

/**
 * Clear cache for a specific repository
 */
export const clearIgnoreCacheAtom = atom(
  null,
  (get, set, repoPath?: string) => {
    if (repoPath) {
      const cache = get(ignoreCacheAtom);
      const updated = new Map(cache);
      updated.delete(repoPath);
      set(ignoreCacheAtom, updated);
    } else {
      set(ignoreCacheAtom, new Map());
    }
  }
);
