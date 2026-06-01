/**
 * Shared Shiki Syntax Highlighting Hook
 *
 * Centralized hook for syntax highlighting with:
 * - Shared cache across all components (memory optimization)
 * - Cancellation handling for rapid updates
 * - Graceful fallback on errors
 *
 * Replaces duplicate implementations in:
 * - EventSystem/events/RunCommand/index.tsx
 * - EventBlocks/TerminalBlock/index.tsx
 * - WorkspaceCenter/Content/Planner/TimelineTab/TerminalCommandView.tsx
 */
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { createJavaScriptRegexEngine, getSingletonHighlighter } from "shiki";

import { isDarkThemeAtom } from "@src/store/ui/uiAtom";

// Resolve the highlighter once with the JS regex engine (no WASM) so webpack
// production builds don't fail on `import('shiki/wasm')` dynamic imports that
// the default bundle-full shorthands rely on.
const highlighterPromise = getSingletonHighlighter({
  langs: [],
  themes: [],
  engine: createJavaScriptRegexEngine(),
});

// ============================================
// Shared Cache
// ============================================

/**
 * Global cache for highlighted code
 * Key format: `${lang}:${theme}:${code}`
 */
const highlightCache = new Map<string, string>();

// Cache size limit to prevent memory issues
const MAX_CACHE_SIZE = 500;

/**
 * Generate cache key from parameters
 */
function getCacheKey(code: string, lang: string, theme: string): string {
  return `${lang}:${theme}:${code}`;
}

/**
 * Add to cache with size management
 */
function addToCache(key: string, value: string): void {
  // Evict oldest entries if cache is full
  if (highlightCache.size >= MAX_CACHE_SIZE) {
    const firstKey = highlightCache.keys().next().value;
    if (firstKey) {
      highlightCache.delete(firstKey);
    }
  }
  highlightCache.set(key, value);
}

// ============================================
// Hook
// ============================================

export interface UseShikiHighlightOptions {
  /** Programming language for syntax highlighting */
  lang?: string;
  /** Color theme */
  theme?: string;
  /** Whether highlighting is enabled (for conditional use) */
  enabled?: boolean;
}

/**
 * Hook for syntax highlighting code with Shiki
 *
 * @param code - Code string to highlight
 * @param options - Configuration options
 * @returns HTML string with syntax highlighting
 *
 * @example
 * ```tsx
 * const highlightedHtml = useShikiHighlight(command, { lang: 'shellscript' });
 *
 * return (
 *   <div dangerouslySetInnerHTML={{ __html: highlightedHtml || command }} />
 * );
 * ```
 */
export function useShikiHighlight(
  code: string,
  options: UseShikiHighlightOptions = {}
): string {
  const isDark = useAtomValue(isDarkThemeAtom);
  const defaultTheme = isDark ? "one-dark-pro" : "github-light";

  const {
    lang = "shellscript",
    theme = defaultTheme,
    enabled = true,
  } = options;

  // Store the resolved result as { key, html } so that stale HTML from a
  // previous theme/code/lang is never returned: if the stored key does not
  // match the current key, we treat the result as empty and wait for the
  // next async resolution.
  const [result, setResult] = useState<{ key: string; html: string } | null>(
    null
  );

  const cacheKey = !code || !enabled ? "" : getCacheKey(code, lang, theme);

  useEffect(() => {
    if (!cacheKey) return;

    const cached = highlightCache.get(cacheKey);
    if (cached) {
      queueMicrotask(() =>
        setResult((prev) =>
          prev?.key === cacheKey && prev.html === cached
            ? prev
            : { key: cacheKey, html: cached }
        )
      );
      return;
    }

    let cancelled = false;

    highlighterPromise
      .then(async (hl) => {
        await hl.loadLanguage(lang as Parameters<typeof hl.loadLanguage>[0]);
        await hl.loadTheme(theme as Parameters<typeof hl.loadTheme>[0]);
        return hl.codeToHtml(code, { lang, theme });
      })
      .then((html) => {
        if (!cancelled) {
          addToCache(cacheKey, html);
          setResult({ key: cacheKey, html });
        }
      })
      .catch((err) => {
        console.warn("[useShikiHighlight] Error:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, code, lang, theme]);

  if (!code || !enabled) return "";
  // Only return HTML when the key matches; otherwise fall back to plain text
  // so stale dark-theme colors are never painted on a light background.
  return result?.key === cacheKey ? result.html : "";
}

// ============================================
// Cache Management Utilities
// ============================================

/**
 * Clear the entire highlight cache
 * Useful for theme changes or memory management
 */
export function clearHighlightCache(): void {
  highlightCache.clear();
}

/**
 * Get current cache size
 */
export function getHighlightCacheSize(): number {
  return highlightCache.size;
}

/**
 * Pre-warm cache with common code snippets
 * Call during idle time for better UX
 */
export async function preWarmCache(
  snippets: Array<{ code: string; lang?: string; theme?: string }>
): Promise<void> {
  const defaultTheme = "one-dark-pro";
  const hl = await highlighterPromise;

  for (const snippet of snippets) {
    const lang = snippet.lang || "shellscript";
    const resolvedTheme = snippet.theme || defaultTheme;
    const cacheKey = getCacheKey(snippet.code, lang, resolvedTheme);

    if (!highlightCache.has(cacheKey)) {
      try {
        await hl.loadLanguage(lang as Parameters<typeof hl.loadLanguage>[0]);
        await hl.loadTheme(resolvedTheme as Parameters<typeof hl.loadTheme>[0]);
        const result = hl.codeToHtml(snippet.code, {
          lang,
          theme: resolvedTheme,
        });
        addToCache(cacheKey, result);
      } catch {
        // Ignore errors during pre-warming
      }
    }
  }
}

export default useShikiHighlight;
