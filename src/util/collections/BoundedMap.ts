/**
 * BoundedMap — a `Map<K, V>` with a hard size cap and LRU eviction.
 *
 * Designed to replace ad-hoc "Map plus a `lastTouched` field plus a manual
 * `evictOldest` scan" patterns scattered across the codebase. Those patterns
 * are correct but they:
 *   - Reinvent the LRU bookkeeping for every site (drift target #1).
 *   - Are easy to bypass: a stray `myMap.set(k, v)` that doesn't route
 *     through the helper grows the map past the cap.
 *   - Don't fire a hook when an entry is forced out, so any "save pending
 *     state before drop" logic has to be open-coded too.
 *
 * `BoundedMap` exposes a small, Map-shaped surface (`get` / `set` / `has`
 * / `delete` / `peek` / `entries` / etc.) plus the bookkeeping wired in
 * by construction: every `get` / `set` / `touch` updates LRU recency,
 * and exceeding `maxSize` triggers `onEvict(key, value)` for the
 * least-recently-touched entry before the new key is inserted.
 *
 * ## Recency semantics
 *
 *   - `set(k, v)` — counts as a touch.
 *   - `get(k)`    — counts as a touch (LRU is read-aware).
 *   - `peek(k)`   — does NOT count as a touch. Use this for diagnostics
 *                   and conditional logic that should not influence
 *                   eviction.
 *   - `has(k)`    — does NOT touch. (Consistent with `Map.has` and avoids
 *                   the common bug where existence checks during iteration
 *                   reshuffle LRU order.)
 *   - `touch(k)`  — explicit bump; returns `true` if the key was present.
 *   - `delete(k)` — removes the entry; does NOT fire `onEvict`. Eviction
 *                   is only for cap-driven drops, mirroring how the
 *                   pattern is used in callers (`onEvict` is "best-effort
 *                   persist before we forget you", not "you've been
 *                   removed").
 *
 * ## Iteration order
 *
 * `keys() / values() / entries()` iterate from **least-recently-touched
 * to most-recently-touched** — i.e. the next victim is always at the
 * head. This matches `Map`'s insertion-order iteration semantics for
 * the common case (no `get` reshuffle) and gives O(1) eviction.
 *
 * ## Why not `LRUCache` (in `@src/util/cache/lruCache.ts`)?
 *
 *   - `LRUCache` is opinionated about TTL and stores a `fetchedAt` /
 *     `lastAccessed` envelope around each value, doubling the per-entry
 *     allocation.
 *   - It does not expose an `onEvict` callback, which is the whole point
 *     of using a bounded map for write-buffer caches (we MUST flush
 *     pending state to disk before forgetting a session).
 *   - Its `set` evicts AFTER inserting (using `>=`), which means the
 *     transient size is `maxSize + 1`. For caches that have to satisfy a
 *     strict invariant (`size <= maxSize` at all times), that's awkward.
 *
 * `BoundedMap` is the focused primitive; `LRUCache` stays for the
 * fetched-data + TTL use case.
 *
 * @example Basic usage
 * ```typescript
 * const map = new BoundedMap<string, Item>({ maxSize: 100 });
 * map.set("a", item);
 * map.get("a");           // marks "a" recently used
 * map.size;               // 1
 * ```
 *
 * @example With eviction callback (write-buffer pattern)
 * ```typescript
 * const buffer = new BoundedMap<string, PendingWrite>({
 *   maxSize: 256,
 *   onEvict: (sessionId, pending) => {
 *     // Best-effort flush before we forget this session.
 *     persistToDisk(sessionId, pending).catch(() => {});
 *   },
 * });
 * ```
 */
export interface BoundedMapOptions<K, V> {
  /**
   * Hard upper bound on the number of entries the map can hold. Must
   * be a positive integer. Setting this to 0 is explicitly rejected
   * because it would make every `set()` immediately evict its own input.
   */
  maxSize: number;
  /**
   * Optional hook invoked when the cap forces an entry out. Receives
   * the evicted key and value. Errors thrown from `onEvict` are caught
   * and reported via `console.warn` — the map state is always
   * consistent regardless of callback behaviour.
   *
   * Not called for explicit `delete(k)` / `clear()` paths; those are
   * caller-intentional removals.
   */
  onEvict?: (key: K, value: V) => void;
  /**
   * Optional name used in `console.warn` messages when `onEvict`
   * throws. Helps disambiguate when many BoundedMaps coexist.
   * Default: `"BoundedMap"`.
   */
  name?: string;
}

export class BoundedMap<K, V> {
  private readonly inner: Map<K, V>;
  private readonly maxSize: number;
  private readonly onEvict: ((key: K, value: V) => void) | undefined;
  private readonly name: string;

  constructor(options: BoundedMapOptions<K, V>) {
    if (
      !Number.isFinite(options.maxSize) ||
      options.maxSize <= 0 ||
      Math.floor(options.maxSize) !== options.maxSize
    ) {
      throw new RangeError(
        `BoundedMap: maxSize must be a positive integer, got ${String(
          options.maxSize
        )}`
      );
    }
    this.inner = new Map();
    this.maxSize = options.maxSize;
    this.onEvict = options.onEvict;
    this.name = options.name ?? "BoundedMap";
  }

  /**
   * Retrieve a value and mark the key as most-recently-used. Returns
   * `undefined` if the key is absent.
   */
  get(key: K): V | undefined {
    const value = this.inner.get(key);
    if (value === undefined && !this.inner.has(key)) {
      return undefined;
    }
    this.inner.delete(key);
    this.inner.set(key, value as V);
    return value as V;
  }

  /**
   * Insert / overwrite a value and mark the key as most-recently-used.
   * Evicts the least-recently-touched entry if the insertion would
   * push the map past `maxSize`. Eviction never fires for the key
   * being set in the same call: if the key was already present, it is
   * simply updated.
   */
  set(key: K, value: V): this {
    if (this.inner.has(key)) {
      this.inner.delete(key);
      this.inner.set(key, value);
      return this;
    }
    if (this.inner.size >= this.maxSize) {
      this.evictOldest();
    }
    this.inner.set(key, value);
    return this;
  }

  /**
   * Check whether a key is present. Does NOT mark the key as recently
   * used (consistent with `Map.has`).
   */
  has(key: K): boolean {
    return this.inner.has(key);
  }

  /**
   * Retrieve a value without affecting LRU order. Useful for
   * diagnostic reads or short-circuit checks that must not perturb
   * the eviction queue.
   */
  peek(key: K): V | undefined {
    return this.inner.get(key);
  }

  /**
   * Bump recency for `key` if it is present. Returns `true` if a
   * touch occurred, `false` if the key was absent. Equivalent to
   * `get(key) !== undefined` for the side effect, but
   *   1. doesn't allocate the return value, and
   *   2. doesn't get confused by `undefined` values explicitly stored
   *      in the map.
   */
  touch(key: K): boolean {
    if (!this.inner.has(key)) return false;
    const value = this.inner.get(key) as V;
    this.inner.delete(key);
    this.inner.set(key, value);
    return true;
  }

  /**
   * Remove a key. Returns `true` if the key existed. Does NOT call
   * `onEvict`: the eviction callback is reserved for cap-driven drops
   * (i.e. "we had to forget this, please persist it first"), not for
   * caller-intentional removals.
   */
  delete(key: K): boolean {
    return this.inner.delete(key);
  }

  /**
   * Remove every entry. Does NOT call `onEvict`.
   */
  clear(): void {
    this.inner.clear();
  }

  /**
   * Current number of entries (always `<= maxSize`).
   */
  get size(): number {
    return this.inner.size;
  }

  /**
   * Configured maximum number of entries. Read-only.
   */
  get capacity(): number {
    return this.maxSize;
  }

  /**
   * Identify the least-recently-touched key without modifying the
   * map. Returns `undefined` if the map is empty.
   *
   * This is the key that the next cap-driven eviction would target.
   * Exported so callers can flush pending state preemptively without
   * waiting for a cap-exceeding `set()`.
   */
  oldestKey(): K | undefined {
    const it = this.inner.keys();
    const first = it.next();
    return first.done ? undefined : first.value;
  }

  /**
   * Drop the least-recently-touched entry and invoke `onEvict` for
   * it. Returns `true` if an entry was evicted, `false` if the map
   * was empty.
   *
   * Most callers should not need to call this directly — `set()`
   * does it automatically when the cap is exceeded. It is exported
   * for the rare "I want to make room for N new entries up front"
   * batching case.
   */
  evictOldest(): boolean {
    const it = this.inner.keys();
    const first = it.next();
    if (first.done) return false;
    const oldKey = first.value;
    const oldValue = this.inner.get(oldKey) as V;
    this.inner.delete(oldKey);
    if (this.onEvict) {
      try {
        this.onEvict(oldKey, oldValue);
      } catch (err) {
        // Raw console.warn kept intentionally: asserted by BoundedMap.test.ts
        // and this is a dependency-free low-level collection utility.
        console.warn(
          `[${this.name}] onEvict callback threw for evicted entry:`,
          err
        );
      }
    }
    return true;
  }

  /**
   * Iterate over keys from oldest to newest (next victim first).
   */
  keys(): IterableIterator<K> {
    return this.inner.keys();
  }

  /**
   * Iterate over values from oldest to newest.
   */
  values(): IterableIterator<V> {
    return this.inner.values();
  }

  /**
   * Iterate over `[key, value]` pairs from oldest to newest.
   */
  entries(): IterableIterator<[K, V]> {
    return this.inner.entries();
  }

  /**
   * Convenience: iterate `[key, value]` pairs in the same default
   * order as `Map` for `for-of` consumers.
   */
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.inner.entries();
  }

  /**
   * Snapshot of the map as an array of `[key, value]` pairs, oldest
   * first. Useful for tests and diagnostics where iteration would
   * otherwise be at risk of being mutated mid-stream.
   */
  toArray(): Array<[K, V]> {
    return Array.from(this.inner.entries());
  }
}

export default BoundedMap;
