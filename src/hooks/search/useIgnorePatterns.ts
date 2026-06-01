/**
 * useIgnorePatterns Hook
 *
 * Loads and manages .orgiiignore patterns for a repository.
 * Caches patterns per repository and reloads when repository changes.
 */
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import {
  type IgnorePattern,
  type ParsedIgnoreFile,
  getDefaultPatterns,
  parseIgnoreFile,
} from "@src/config/ignorePatterns";
import {
  cacheIgnorePatternsAtom,
  getCachedIgnorePatternsAtom,
  ignorePatternsAtom,
  ignorePatternsLoadingAtom,
  setIgnoreErrorAtom,
  setIgnoreLoadingAtom,
  setIgnorePatternsAtom,
} from "@src/store/workstation/codeEditor/search/ignoreAtom";

// ============================================
// Constants
// ============================================

const ORGII_IGNORE_FILE = ".orgiiignore";

// ============================================
// Types
// ============================================

export interface UseIgnorePatternsOptions {
  /** Repository root path */
  repoPath: string | null;
  /** Auto-load on mount/change (default: true) */
  autoLoad?: boolean;
}

export interface UseIgnorePatternsReturn {
  /** Current ignore patterns */
  patterns: IgnorePattern[];
  /** Whether patterns are loading */
  loading: boolean;
  /** Reload patterns from file */
  reload: () => Promise<void>;
  /** Check if a path should be ignored */
  shouldIgnore: (path: string) => boolean;
}

// ============================================
// Hook
// ============================================

export function useIgnorePatterns(
  options: UseIgnorePatternsOptions
): UseIgnorePatternsReturn {
  const { repoPath, autoLoad = true } = options;

  // State
  const patterns = useAtomValue(ignorePatternsAtom);
  const loading = useAtomValue(ignorePatternsLoadingAtom);
  const getCached = useAtomValue(getCachedIgnorePatternsAtom);

  // Actions
  const setLoading = useSetAtom(setIgnoreLoadingAtom);
  const setPatterns = useSetAtom(setIgnorePatternsAtom);
  const setError = useSetAtom(setIgnoreErrorAtom);
  const cachePatterns = useSetAtom(cacheIgnorePatternsAtom);

  // Track current repo to avoid stale updates
  const currentRepoRef = useRef<string | null>(null);

  /**
   * Load patterns from .orgiiignore file or use defaults
   */
  const loadPatterns = useCallback(async () => {
    if (!repoPath) {
      // No repo, use defaults
      setPatterns({
        patterns: getDefaultPatterns(),
        source: "default",
      });
      return;
    }

    // Check cache first
    const cached = getCached(repoPath);
    if (cached) {
      setPatterns(cached);
      return;
    }

    // Mark loading
    setLoading(true);
    currentRepoRef.current = repoPath;

    try {
      const ignoreFilePath = `${repoPath}/${ORGII_IGNORE_FILE}`;

      // Check if file exists
      const fileExists = await exists(ignoreFilePath);

      let parsed: ParsedIgnoreFile;

      if (fileExists) {
        // Read and parse file
        const content = await readTextFile(ignoreFilePath);
        const filePatterns = parseIgnoreFile(content);

        // Merge with defaults (file patterns take precedence)
        const defaultPatterns = getDefaultPatterns();
        const merged = [...defaultPatterns, ...filePatterns];

        parsed = {
          patterns: merged,
          source: "file",
          filePath: ignoreFilePath,
        };
      } else {
        // Use defaults
        parsed = {
          patterns: getDefaultPatterns(),
          source: "default",
        };
      }

      // Only update if still on same repo
      if (currentRepoRef.current === repoPath) {
        setPatterns(parsed);
        cachePatterns(repoPath, parsed);
      }
    } catch (error) {
      // Only update if still on same repo
      if (currentRepoRef.current === repoPath) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to load ignore patterns";
        setError(message);

        // Fall back to defaults on error
        setPatterns({
          patterns: getDefaultPatterns(),
          source: "default",
        });
      }
    }
  }, [repoPath, getCached, setLoading, setPatterns, setError, cachePatterns]);

  /**
   * Check if a path should be ignored
   */
  const checkShouldIgnore = useCallback(
    (path: string): boolean => {
      let ignored = false;

      for (const pattern of patterns) {
        if (matchesPattern(path, pattern)) {
          ignored = !pattern.negated;
        }
      }

      return ignored;
    },
    [patterns]
  );

  // Auto-load on repo change
  useEffect(() => {
    if (autoLoad) {
      loadPatterns();
    }
  }, [autoLoad, loadPatterns]);

  return {
    patterns,
    loading,
    reload: loadPatterns,
    shouldIgnore: checkShouldIgnore,
  };
}

// ============================================
// Pattern Matching (with compiled regex cache)
// ============================================

const MAX_REGEX_CACHE = 200;
const compiledRegexCache = new Map<string, RegExp>();

function patternToRegex(pattern: string): RegExp {
  const cached = compiledRegexCache.get(pattern);
  if (cached) return cached;

  let regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{DOUBLE_STAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{DOUBLE_STAR}}/g, ".*")
    .replace(/\?/g, "[^/]");

  if (!pattern.startsWith("/")) {
    regexStr = "(^|/)" + regexStr;
  } else {
    regexStr = "^" + regexStr.slice(1);
  }

  if (pattern.endsWith("/")) {
    regexStr = regexStr.slice(0, -1) + "(/.*)?$";
  } else {
    regexStr += "(/.*)?$";
  }

  const regex = new RegExp(regexStr);

  if (compiledRegexCache.size >= MAX_REGEX_CACHE) {
    const firstKey = compiledRegexCache.keys().next().value;
    if (firstKey !== undefined) compiledRegexCache.delete(firstKey);
  }
  compiledRegexCache.set(pattern, regex);

  return regex;
}

function matchesPattern(path: string, pattern: IgnorePattern): boolean {
  const regex = patternToRegex(pattern.pattern);
  return regex.test(path);
}

export default useIgnorePatterns;
