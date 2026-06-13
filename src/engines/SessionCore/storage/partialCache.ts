/**
 * Partial Stream Cache - Crash Recovery for Streaming Messages
 *
 * Inspired by mux's partial.json pattern. During streaming, the accumulated
 * message content is persisted to disk via Tauri's Rust backend. If the app
 * crashes mid-stream, the partial file is detected on next load and the
 * accumulated content is recovered.
 *
 * ## Key Features
 * - Atomic writes (temp file + rename) prevent corruption
 * - Throttled saves (500ms) reduce disk I/O during rapid streaming
 * - Self-healing: malformed files are auto-cleaned
 * - Per-session isolation
 *
 * @example
 * ```typescript
 * // During streaming - save accumulated content (throttled)
 * partialCache.saveThrottled(sessionId, {
 *   accumulatedMessage: "Hello, I can help with...",
 *   accumulatedThinking: "Let me analyze the code...",
 * });
 *
 * // On stream completion - cleanup
 * await partialCache.delete(sessionId);
 *
 * // On session load - check for crash recovery
 * const partial = await partialCache.load(sessionId);
 * if (partial) {
 *   // Recover accumulated content
 *   recoverFromPartial(partial);
 *   await partialCache.delete(sessionId);
 * }
 * ```
 */
import { rpc } from "@src/api/tauri/rpc";
import { createLogger } from "@src/hooks/logger";
import { BoundedMap } from "@src/util/collections/BoundedMap";

const log = createLogger("PartialCache");

// ============================================
// Types
// ============================================

/**
 * Partial stream state persisted to disk during streaming.
 * Contains the accumulated message/thinking content at the time of the last save.
 */
export interface PartialStreamState {
  /** Session ID this partial belongs to */
  sessionId: string;
  /** Streaming event ID for the accumulated message (e.g., "stream-msg-{sessionId}") */
  messageEventId?: string;
  /** Streaming event ID for the accumulated thinking (e.g., "stream-think-{sessionId}") */
  thinkingEventId?: string;
  /** Accumulated assistant message content */
  accumulatedMessage?: string;
  /** Accumulated thinking/reasoning content */
  accumulatedThinking?: string;
  /** ISO timestamp when streaming started */
  startedAt: string;
  /** ISO timestamp of the last update */
  lastUpdatedAt: string;
  /** Model name if available */
  model?: string;
  /** Whether the stream was interrupted (error/cancel) */
  wasInterrupted?: boolean;
}

/**
 * Options for updating partial state during streaming.
 * Only provided fields are updated; others keep their previous values.
 */
export interface PartialUpdateOptions {
  accumulatedMessage?: string;
  accumulatedThinking?: string;
  messageEventId?: string;
  thinkingEventId?: string;
  model?: string;
  wasInterrupted?: boolean;
}

// ============================================
// Throttle State (per-session)
// ============================================

/** Minimum interval between partial writes (ms) */
const THROTTLE_MS = 500;

/**
 * Upper bound on the throttle map size. When the map grows past this
 * value the oldest-touched entry is evicted (its pending state, if any,
 * is flushed to disk synchronously to avoid losing user content).
 *
 * Rationale:
 *   The throttle map keeps a per-session record for every streaming
 *   session the app has ever seen. Entries are only removed when the
 *   session calls `remove(sessionId)` (after stream completion) or
 *   `flushThrottled(sessionId)`. If a session crashes mid-stream, is
 *   force-closed by the user, or otherwise never reaches commit, its
 *   entry stays forever — and on a long-lived app process this map
 *   grows without bound. The cap turns that latent leak into a hard
 *   ceiling.
 *
 * The value is intentionally generous: a single user with 100 streaming
 * sessions open is already pathological. Setting it lower would risk
 * evicting active sessions on power-users; setting it higher would
 * delay the leak guard. 256 is the sweet spot — well above realistic
 * concurrent usage, low enough that the LRU sweep is cheap.
 */
const MAX_THROTTLE_ENTRIES = 256;

/**
 * Per-session throttle tracking.
 *
 * Stored in a {@link BoundedMap} so the LRU bookkeeping and cap
 * enforcement are wired in by construction — there is no chance for a
 * future caller to bypass the bound by reaching the underlying `Map`
 * directly. The `onEvict` callback handles "best-effort flush before
 * we forget you" so a user's accumulated stream content isn't lost on
 * the floor when the cap kicks in.
 */
interface ThrottleEntry {
  /** Last write timestamp */
  lastWriteTime: number;
  /** Pending write timer */
  timer: ReturnType<typeof setTimeout> | null;
  /** Latest state to write (buffered during throttle) */
  pendingState: PartialStreamState | null;
}

const throttleMap = new BoundedMap<string, ThrottleEntry>({
  maxSize: MAX_THROTTLE_ENTRIES,
  name: "partialCache.throttleMap",
  onEvict: (sessionId, victim) => {
    if (victim.timer) {
      clearTimeout(victim.timer);
      victim.timer = null;
    }
    if (victim.pendingState) {
      // Fire-and-forget — callers of throttle operations don't expect
      // synchronous I/O. Losing this flush is the same as the app
      // crashing one tick earlier, which the partial recovery flow
      // is already designed to handle.
      save(sessionId, victim.pendingState).catch(() => {
        // Ignore - best effort
      });
    }
  },
});

/**
 * Get-or-create a throttle entry, marking it as most-recently-used.
 * `BoundedMap.get` itself updates the LRU position, so we don't need
 * a separate `lastTouched` field — the map's iteration order IS the
 * LRU order.
 */
function getOrCreateEntry(sessionId: string): ThrottleEntry {
  const existing = throttleMap.get(sessionId);
  if (existing) return existing;
  const entry: ThrottleEntry = {
    lastWriteTime: 0,
    timer: null,
    pendingState: null,
  };
  throttleMap.set(sessionId, entry);
  return entry;
}

/**
 * Drop the least-recently-touched throttle entry. Thin wrapper around
 * `BoundedMap.evictOldest()` retained for test ergonomics.
 *
 * Not part of the public `partialCache` API.
 */
export function evictOldestEntry(): boolean {
  return throttleMap.evictOldest();
}

/**
 * Expose the current throttle map size for tests / diagnostics. Not
 * part of the public `partialCache` API.
 */
export function getThrottleMapSize(): number {
  return throttleMap.size;
}

/** Hard cap used by `getOrCreateEntry` — exported for tests. */
export const THROTTLE_MAP_MAX_ENTRIES = MAX_THROTTLE_ENTRIES;

// ============================================
// Availability Check
// ============================================

let availabilityChecked = false;
let isAvailable = false;

/**
 * Check if partial cache is available (Tauri environment).
 *
 * Only marks `availabilityChecked = true` on success. A failure during early
 * startup (e.g. Tauri not yet ready) leaves the flag unset so the next call
 * retries — preventing the crash-recovery feature from being permanently
 * disabled due to a transient init-time error.
 */
async function checkAvailability(): Promise<boolean> {
  if (availabilityChecked) return isAvailable;

  try {
    // Try a lightweight command to verify Tauri is available
    await rpc.sessionCore.partial.listAll();
    isAvailable = true;
    availabilityChecked = true;
  } catch {
    // Do NOT set availabilityChecked on failure so the next call retries.
    isAvailable = false;
  }

  return isAvailable;
}

// ============================================
// Core Operations
// ============================================

/**
 * Save partial stream state to disk (direct, no throttling).
 * Use `saveThrottled()` during streaming for better performance.
 */
async function save(
  sessionId: string,
  state: PartialStreamState
): Promise<void> {
  if (!(await checkAvailability())) return;

  try {
    await rpc.sessionCore.partial.save({ sessionId, state });
  } catch (error) {
    log.warn("[PartialCache] Failed to save partial:", error);
  }
}

/**
 * Save partial stream state with throttling (500ms).
 *
 * If called more frequently than the throttle interval, the latest state
 * is buffered and written after the interval expires. This reduces disk I/O
 * during rapid streaming while ensuring the latest content is always saved.
 */
function saveThrottled(sessionId: string, state: PartialStreamState): void {
  // Route through `getOrCreateEntry` so the LRU bookkeeping AND the
  // size cap are enforced on every write. Without this, the previous
  // direct `throttleMap.set` path could grow the map indefinitely for
  // sessions that streamed once and never reached `flushThrottled` /
  // `remove` (crash, force-close, eviction by Rust cleanup, ...).
  const entry = getOrCreateEntry(sessionId);

  const now = Date.now();
  const timeSinceLastWrite = now - entry.lastWriteTime;

  if (timeSinceLastWrite >= THROTTLE_MS) {
    // Enough time has passed - write immediately
    entry.lastWriteTime = now;
    entry.pendingState = null;

    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }

    // Fire and forget
    save(sessionId, state).catch(() => {
      // Ignore - best effort
    });
  } else {
    // Buffer the latest state and schedule a write
    entry.pendingState = state;

    if (!entry.timer) {
      const remainingTime = THROTTLE_MS - timeSinceLastWrite;
      entry.timer = setTimeout(() => {
        const currentEntry = throttleMap.get(sessionId);
        if (currentEntry?.pendingState) {
          currentEntry.lastWriteTime = Date.now();
          const stateToWrite = currentEntry.pendingState;
          currentEntry.pendingState = null;
          currentEntry.timer = null;

          save(sessionId, stateToWrite).catch(() => {
            // Ignore - best effort
          });
        }
      }, remainingTime);
    }
  }
}

/**
 * Flush any pending throttled write for a session immediately.
 * Call this before stream completion to ensure the latest state is persisted.
 */
async function flushThrottled(sessionId: string): Promise<void> {
  // `throttleMap.get` itself bumps LRU recency (BoundedMap is
  // read-aware), so we don't need a separate `lastTouched` bump.
  const entry = throttleMap.get(sessionId);
  if (!entry) return;

  // Cancel pending timer
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }

  // Write pending state if any
  if (entry.pendingState) {
    const stateToWrite = entry.pendingState;
    entry.pendingState = null;
    entry.lastWriteTime = Date.now();
    await save(sessionId, stateToWrite);
  }
}

/**
 * Load partial stream state from disk.
 * Returns null if no partial file exists or if it's malformed.
 */
function isPartialStreamState(value: unknown): value is PartialStreamState {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.sessionId === "string" &&
    typeof obj.startedAt === "string" &&
    typeof obj.lastUpdatedAt === "string"
  );
}

async function load(sessionId: string): Promise<PartialStreamState | null> {
  if (!(await checkAvailability())) return null;

  try {
    const raw = await rpc.sessionCore.partial.load({ sessionId });
    if (raw === null || raw === undefined) return null;
    if (!isPartialStreamState(raw)) {
      log.warn(
        "[PartialCache] Partial file for session",
        sessionId,
        "failed schema check — discarding to prevent corrupt recovery.",
        raw
      );
      return null;
    }
    return raw;
  } catch (error) {
    log.warn("[PartialCache] Failed to load partial:", error);
    return null;
  }
}

/**
 * Delete partial stream state file.
 * Call after stream completes or after recovery is done.
 */
async function remove(sessionId: string): Promise<void> {
  if (!(await checkAvailability())) return;

  // Clean up throttle state
  const entry = throttleMap.get(sessionId);
  if (entry) {
    if (entry.timer) clearTimeout(entry.timer);
    throttleMap.delete(sessionId);
  }

  try {
    await rpc.sessionCore.partial.delete({ sessionId });
  } catch (error) {
    log.warn("[PartialCache] Failed to delete partial:", error);
  }
}

/**
 * Check if a partial file exists for a session (fast, no parsing).
 */
async function exists(sessionId: string): Promise<boolean> {
  if (!(await checkAvailability())) return false;

  try {
    return await rpc.sessionCore.partial.exists({ sessionId });
  } catch {
    return false;
  }
}

/**
 * List all session IDs that have partial files (for startup recovery scan).
 */
async function listAll(): Promise<string[]> {
  if (!(await checkAvailability())) return [];

  try {
    return await rpc.sessionCore.partial.listAll();
  } catch (error) {
    log.warn("[PartialCache] Failed to list partials:", error);
    return [];
  }
}

/**
 * Clean up stale partial files older than the given threshold.
 * @param maxAgeHours - Maximum age in hours (default: 24)
 * @returns Number of files cleaned up
 */
async function cleanupStale(maxAgeHours?: number): Promise<number> {
  if (!(await checkAvailability())) return 0;

  try {
    return await rpc.sessionCore.partial.cleanupStale({
      maxAgeHours: maxAgeHours ?? 24,
    });
  } catch (error) {
    log.warn("[PartialCache] Failed to cleanup stale partials:", error);
    return 0;
  }
}

// ============================================
// Helper: Create/Update PartialStreamState
// ============================================

/**
 * Create a new PartialStreamState for a streaming session.
 */
export function createPartialState(
  sessionId: string,
  options: PartialUpdateOptions = {}
): PartialStreamState {
  const now = new Date().toISOString();
  return {
    sessionId,
    messageEventId: options.messageEventId,
    thinkingEventId: options.thinkingEventId,
    accumulatedMessage: options.accumulatedMessage,
    accumulatedThinking: options.accumulatedThinking,
    startedAt: now,
    lastUpdatedAt: now,
    model: options.model,
    wasInterrupted: options.wasInterrupted,
  };
}

/**
 * Update an existing PartialStreamState with new values.
 * Only updates fields that are explicitly provided.
 */
export function updatePartialState(
  existing: PartialStreamState,
  updates: PartialUpdateOptions
): PartialStreamState {
  return {
    ...existing,
    lastUpdatedAt: new Date().toISOString(),
    ...(updates.accumulatedMessage !== undefined && {
      accumulatedMessage: updates.accumulatedMessage,
    }),
    ...(updates.accumulatedThinking !== undefined && {
      accumulatedThinking: updates.accumulatedThinking,
    }),
    ...(updates.messageEventId !== undefined && {
      messageEventId: updates.messageEventId,
    }),
    ...(updates.thinkingEventId !== undefined && {
      thinkingEventId: updates.thinkingEventId,
    }),
    ...(updates.model !== undefined && { model: updates.model }),
    ...(updates.wasInterrupted !== undefined && {
      wasInterrupted: updates.wasInterrupted,
    }),
  };
}

// ============================================
// Public API
// ============================================

export const partialCache = {
  /** Save partial state (direct, no throttle) */
  save,
  /** Save partial state (throttled 500ms) - use during streaming */
  saveThrottled,
  /** Flush any pending throttled write immediately */
  flushThrottled,
  /** Load partial state from disk */
  load,
  /** Delete partial file */
  delete: remove,
  /** Check if partial file exists */
  exists,
  /** List all sessions with partial files */
  listAll,
  /** Clean up stale partial files */
  cleanupStale,
  /** Check if partial cache is available */
  isAvailable: checkAvailability,
};
