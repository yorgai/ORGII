/**
 * Region Material Cache
 *
 * FIFO-evicting cache for resolved glass materials per region.
 * Keyed by "imageUrl-region" or "color:cssColor-region".
 */
import type { CachedRegionMaterial } from "./types";

const MAX_REGION_CACHE_SIZE = 50;
const regionCache = new Map<string, CachedRegionMaterial>();

/** Evict oldest entries by timestamp when cache exceeds max size */
function evictRegionCache() {
  if (regionCache.size <= MAX_REGION_CACHE_SIZE) return;
  const entries = [...regionCache.entries()].sort(
    (entryA, entryB) => entryA[1].timestamp - entryB[1].timestamp
  );
  const removeCount = regionCache.size - MAX_REGION_CACHE_SIZE;
  for (let idx = 0; idx < removeCount; idx++) {
    regionCache.delete(entries[idx][0]);
  }
}

/** Get a cached entry by key */
export function getCached(key: string): CachedRegionMaterial | undefined {
  return regionCache.get(key);
}

/** Store a cache entry (with auto-eviction) */
export function setCached(key: string, entry: CachedRegionMaterial): void {
  regionCache.set(key, entry);
  evictRegionCache();
}

/** Clear all cached materials */
export function clearCache(): void {
  regionCache.clear();
}

/** Clear cache entries for a specific image URL */
export function clearCacheForImage(imageUrl: string): void {
  for (const key of regionCache.keys()) {
    if (key.startsWith(imageUrl)) {
      regionCache.delete(key);
    }
  }
}
