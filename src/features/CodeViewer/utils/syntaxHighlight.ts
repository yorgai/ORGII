/**
 * Syntax highlighting utilities with caching
 */
import hljs from "highlight.js";

import { MAX_CACHE_SIZE } from "../config";

/** Cache for highlighted lines to prevent re-computation */
const highlightCache = new Map<string, string>();

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * Highlight a single line of code with caching
 */
export function highlightLine(content: string, language?: string): string {
  if (!content.trim() || !language) {
    return escapeHtml(content);
  }

  // Create cache key
  const cacheKey = `${language}:${content}`;

  // Check cache
  const cached = highlightCache.get(cacheKey);
  if (cached) return cached;

  try {
    const result = hljs.highlight(content, {
      language,
      ignoreIllegals: true,
    });

    // Store in cache (with size limit)
    if (highlightCache.size >= MAX_CACHE_SIZE) {
      // Clear oldest entries (simple strategy: clear half)
      const entries = Array.from(highlightCache.keys());
      entries
        .slice(0, MAX_CACHE_SIZE / 2)
        .forEach((cacheKey) => highlightCache.delete(cacheKey));
    }
    highlightCache.set(cacheKey, result.value);

    return result.value;
  } catch {
    // Fallback to escaped HTML if highlighting fails
    return escapeHtml(content);
  }
}
