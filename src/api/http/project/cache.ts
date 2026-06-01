/**
 * Short-lived read cache for `project_*` Tauri calls.
 *
 * Cache keys are slug-scoped (the project store is global, so there's
 * no `repoPath` namespace to worry about). The cache exists to
 * deduplicate the burst of reads that fire when multiple hooks mount
 * on the same tick (e.g. `useProjectData` + `useWorkItemsSource` both
 * pulling labels and members for the same project) — anything past
 * the 2s TTL goes back over IPC.
 *
 * - Entries expire after `CACHE_TTL_MS` (2 seconds).
 * - In-flight promises are shared (request deduplication).
 * - `invalidateCache(slug)` drops every key starting with `${slug}:`;
 *   `invalidateCache()` flushes the whole cache (used by the global
 *   `orgii-data-changed` listener since the event doesn't carry a slug).
 * - Max 50 entries with FIFO eviction.
 */

const CACHE_TTL_MS = 2_000;
const MAX_ENTRIES = 50;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function evictIfNeeded(): void {
  if (cache.size < MAX_ENTRIES) return;
  const firstKey = cache.keys().next().value;
  if (firstKey) cache.delete(firstKey);
}

export async function cachedRead<T>(
  cacheKey: string,
  fetcher: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const existing = cache.get(cacheKey);
  if (existing && now - existing.timestamp < CACHE_TTL_MS) {
    return existing.data as T;
  }

  const pending = inflight.get(cacheKey);
  if (pending) {
    return pending as Promise<T>;
  }

  const promise = fetcher()
    .then((result) => {
      evictIfNeeded();
      cache.set(cacheKey, { data: result, timestamp: Date.now() });
      inflight.delete(cacheKey);
      return result;
    })
    .catch((err: unknown) => {
      inflight.delete(cacheKey);
      throw err;
    });

  inflight.set(cacheKey, promise);
  return promise;
}

/**
 * Drop cached entries scoped to `slug`. Pass no argument to flush the
 * whole cache (used by the project-data-changed event listener).
 */
export function invalidateCache(slug?: string): void {
  if (!slug) {
    cache.clear();
    inflight.clear();
    return;
  }
  const prefix = `${slug}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) {
      inflight.delete(key);
    }
  }
}
