/**
 * localStorage Cache Utility
 *
 * PERFORMANCE: Batches localStorage reads to avoid blocking startup.
 * All critical settings are read once and cached in memory.
 *
 * Features:
 * - Pre-populated cache during idle time
 * - Fast synchronous access via memory cache
 * - Fallback to direct read if not cached
 * - Write-through cache (writes update both cache and storage)
 */
import { createLogger } from "@src/hooks/logger";

const log = createLogger("localStorageCache");

// ============================================
// Cache State
// ============================================

const cache = new Map<string, string | null>();
let isPreloaded = false;
let preloadPromise: Promise<void> | null = null;

// Keys that should be preloaded at startup (most accessed)
const PRIORITY_KEYS = [
  // Theme & UI
  "theme",
  "orgii_ui_scale",
  "orgii_background_config",

  // User settings
  "orgii_user_display_name",
  "orgii_timezone",

  // Terminal settings
  "orgii_terminal_font_size",
  "orgii_terminal_letter_spacing",

  // Repo & session state
  "orgii_selected_repo_id",
  "orgii_selected_branch",

  // Tab persistence
  "opcode_tabs_v4",
  "opcode_active_tab_v4",
  "opcode_tab_persistence_enabled",

  // Sidebar state
  "orgii_sidebar_width",
  "orgii_sidebar_collapsed",

  // Config
  "orgii_prefer_ide",
  "orgii_auto_commit",
];

// ============================================
// Core API
// ============================================

/**
 * Get a value from cache or localStorage
 * Fast path: returns from memory cache
 * Slow path: falls back to localStorage read
 */
export function getCached(key: string): string | null {
  // Fast path: return from cache
  if (cache.has(key)) {
    return cache.get(key) ?? null;
  }

  // Slow path: read from localStorage and cache
  try {
    const value = localStorage.getItem(key);
    cache.set(key, value);
    return value;
  } catch {
    return null;
  }
}

/**
 * Get a value with JSON parsing
 */
export function getCachedJSON<T>(key: string, defaultValue: T): T {
  const raw = getCached(key);
  if (!raw) return defaultValue;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Set a value in both cache and localStorage (write-through)
 */
export function setCached(key: string, value: string): void {
  cache.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    log.error(`[localStorageCache] Failed to write ${key}:`, error);
  }
}

/**
 * Set a JSON value
 */
export function setCachedJSON<T>(key: string, value: T): void {
  setCached(key, JSON.stringify(value));
}

/**
 * Remove a value from both cache and localStorage
 */
export function removeCached(key: string): void {
  cache.delete(key);
  try {
    localStorage.removeItem(key);
  } catch (error) {
    log.error(`[localStorageCache] Failed to remove ${key}:`, error);
  }
}

/**
 * Check if cache is preloaded
 */
export function isCachePreloaded(): boolean {
  return isPreloaded;
}

// ============================================
// Preloading
// ============================================

/**
 * Preload priority keys into cache
 * Call this during app initialization (after first paint)
 */
export function preloadCache(): Promise<void> {
  if (isPreloaded) return Promise.resolve();
  if (preloadPromise) return preloadPromise;

  preloadPromise = new Promise((resolve) => {
    const preload = () => {
      const _start = performance.now();

      // Batch read all priority keys
      for (const key of PRIORITY_KEYS) {
        try {
          const value = localStorage.getItem(key);
          cache.set(key, value);
        } catch {
          cache.set(key, null);
        }
      }

      isPreloaded = true;
      resolve();
    };

    // Use requestIdleCallback if available for non-blocking preload
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(preload, { timeout: 500 });
    } else {
      setTimeout(preload, 50);
    }
  });

  return preloadPromise;
}

/**
 * Preload specific keys (for components that need specific settings)
 */
export function preloadKeys(keys: string[]): void {
  for (const key of keys) {
    if (!cache.has(key)) {
      try {
        cache.set(key, localStorage.getItem(key));
      } catch {
        cache.set(key, null);
      }
    }
  }
}

// ============================================
// Helpers for Common Patterns
// ============================================

/**
 * Get boolean value with default
 */
export function getCachedBoolean(key: string, defaultValue: boolean): boolean {
  const raw = getCached(key);
  if (raw === null) return defaultValue;
  return raw === "true";
}

/**
 * Get number value with default and optional bounds
 */
export function getCachedNumber(
  key: string,
  defaultValue: number,
  options?: { min?: number; max?: number }
): number {
  const raw = getCached(key);
  if (raw === null) return defaultValue;

  const num = parseFloat(raw);
  if (isNaN(num)) return defaultValue;

  if (options?.min !== undefined && num < options.min) return defaultValue;
  if (options?.max !== undefined && num > options.max) return defaultValue;

  return num;
}

// ============================================
// Debug
// ============================================

/**
 * Get cache statistics (for debugging)
 */
export function getCacheStats(): {
  size: number;
  keys: string[];
  isPreloaded: boolean;
} {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
    isPreloaded,
  };
}

/**
 * Clear the cache (mainly for testing)
 */
export function clearCache(): void {
  cache.clear();
  isPreloaded = false;
  preloadPromise = null;
}
