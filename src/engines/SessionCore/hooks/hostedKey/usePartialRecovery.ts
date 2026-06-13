/**
 * usePartialRecovery Hook
 *
 * Manages the partial stream state lifecycle for crash recovery:
 *
 * 1. **During streaming**: Call `trackStreamingDelta()` to persist accumulated
 *    content to disk (throttled to 500ms). This is called from the WebSocket
 *    message handler whenever a thinking or message delta arrives.
 *
 * 2. **On stream completion**: Call `commitAndCleanup()` to delete the partial
 *    file. The final events are already in the session store and cache.
 *
 * 3. **On session load**: Call `checkAndRecover()` to detect a crash recovery
 *    scenario. If a partial file exists, it returns the accumulated content
 *    so the caller can inject recovered events into the session store.
 *
 * Inspired by mux's PartialService + StreamManager pattern.
 */
import { useCallback, useRef } from "react";

import { createLogger } from "@src/hooks/logger";

import type { SessionEvent } from "../../core/types";
import {
  type PartialStreamState,
  type PartialUpdateOptions,
  createPartialState,
  partialCache,
  updatePartialState,
} from "../../storage/partialCache";

const log = createLogger("PartialRecovery");

// ============================================
// Types
// ============================================

export interface PartialRecoveryResult {
  /** Whether a partial file was found */
  found: boolean;
  /** Recovered events to inject into the session store */
  recoveredEvents: SessionEvent[];
  /** The raw partial state (for debugging/logging) */
  partialState: PartialStreamState | null;
}

export interface UsePartialRecoveryOptions {
  /** Enable debug logging */
  debug?: boolean;
}

export interface UsePartialRecoveryReturn {
  /**
   * Track a streaming delta (thinking or message).
   * Persists accumulated content to disk with throttling (500ms).
   *
   * Call this from the WebSocket message handler on each delta.
   */
  trackStreamingDelta: (
    sessionId: string,
    updates: PartialUpdateOptions
  ) => void;

  /**
   * Mark the stream as started. Creates the initial partial file.
   */
  startTracking: (sessionId: string, options?: PartialUpdateOptions) => void;

  /**
   * Clean up the partial file after stream completes normally.
   * Flushes any pending throttled writes before deleting.
   */
  commitAndCleanup: (sessionId: string) => Promise<void>;

  /**
   * Check for crash recovery on session load.
   * Returns recovered events if a partial file is found.
   *
   * After recovery, the partial file is automatically deleted.
   */
  checkAndRecover: (sessionId: string) => Promise<PartialRecoveryResult>;

  /**
   * Check all sessions for partial files (startup recovery scan).
   * Returns session IDs that have partial files.
   */
  listRecoverableSessions: () => Promise<string[]>;

  /**
   * Clean up stale partial files older than maxAgeHours.
   */
  cleanupStale: (maxAgeHours?: number) => Promise<number>;
}

// ============================================
// Module-level helpers (no hook state needed)
// ============================================

const listRecoverableSessions = (): Promise<string[]> => partialCache.listAll();

const cleanupStale = (maxAgeHours?: number): Promise<number> =>
  partialCache.cleanupStale(maxAgeHours);

/**
 * Pure transform: build the recovered `SessionEvent[]` from a loaded
 * `PartialStreamState`. Module-level + non-async so it can be unit
 * tested without mocking `partialCache` or React.
 *
 * The function deliberately does NOT touch disk, does NOT consult any
 * external state, and does NOT throw on missing optional fields. If
 * everything in `state` is empty, an empty array is returned — which is
 * a valid "no events to recover, but the partial file itself is fine"
 * outcome and is intentionally NOT a failure.
 *
 * This split is the heart of the bug fix for `checkAndRecover`: the
 * previous implementation wrapped both `partialCache.load(...)` AND
 * the transform in a single try/catch and deleted the on-disk partial
 * file on ANY exception. If `buildRecoveredEvents` ever threw — for
 * example because a future field was non-string in the result — the
 * user's accumulated content would be erased from disk even though
 * the load itself succeeded. Now the delete only fires once both
 * phases have completed cleanly.
 */
export function buildRecoveredEvents(
  sessionId: string,
  state: PartialStreamState
): SessionEvent[] {
  const recoveredEvents: SessionEvent[] = [];
  const now = new Date().toISOString();

  if (state.accumulatedThinking?.trim()) {
    const thinkingEvent: SessionEvent = {
      chunk_id: state.thinkingEventId ?? null,
      id:
        state.thinkingEventId ??
        `recovered:thinking:${sessionId}:${Date.now()}`,
      sessionId,
      createdAt: state.lastUpdatedAt || now,
      functionName: "thinking",
      uiCanonical: "",
      actionType: "llm_thinking",
      args: {},
      result: {
        thought: state.accumulatedThinking,
        content: state.accumulatedThinking,
        observation: state.accumulatedThinking,
        recovered: true,
      },
      source: "assistant",
      displayText: state.accumulatedThinking,
      displayStatus: "completed",
      displayVariant: "thinking",
      activityStatus: "agent",
      // Not a delta anymore — this is the final recovered content.
      isDelta: false,
    };
    recoveredEvents.push(thinkingEvent);
  }

  if (state.accumulatedMessage?.trim()) {
    const messageEvent: SessionEvent = {
      chunk_id: state.messageEventId ?? null,
      id:
        state.messageEventId ?? `recovered:message:${sessionId}:${Date.now()}`,
      sessionId,
      createdAt: state.lastUpdatedAt || now,
      functionName: "assistant_message",
      uiCanonical: "",
      actionType: "assistant",
      args: {},
      result: {
        content: state.accumulatedMessage,
        observation: state.accumulatedMessage,
        role: "assistant",
        recovered: true,
      },
      source: "assistant",
      displayText: state.accumulatedMessage,
      displayStatus: "completed",
      displayVariant: "message",
      activityStatus: "agent",
      isDelta: false,
    };
    recoveredEvents.push(messageEvent);
  }

  return recoveredEvents;
}

// ============================================
// Hook Implementation
// ============================================

export function usePartialRecovery(
  _options: UsePartialRecoveryOptions = {}
): UsePartialRecoveryReturn {
  // In-memory cache of current partial states per session
  const stateMapRef = useRef<Map<string, PartialStreamState>>(new Map());

  /**
   * Start tracking a new streaming session.
   */
  const startTracking = useCallback(
    (sessionId: string, initialOptions: PartialUpdateOptions = {}) => {
      const state = createPartialState(sessionId, initialOptions);
      stateMapRef.current.set(sessionId, state);

      // Write initial state immediately (not throttled)
      partialCache.save(sessionId, state).catch(() => {
        // Best effort
      });
    },
    []
  );

  /**
   * Track a streaming delta. Updates the in-memory state and persists
   * to disk with throttling.
   */
  const trackStreamingDelta = useCallback(
    (sessionId: string, updates: PartialUpdateOptions) => {
      let currentState = stateMapRef.current.get(sessionId);

      if (!currentState) {
        // Auto-start tracking if not already started
        currentState = createPartialState(sessionId, updates);
        stateMapRef.current.set(sessionId, currentState);
      } else {
        // Update existing state
        currentState = updatePartialState(currentState, updates);
        stateMapRef.current.set(sessionId, currentState);
      }

      // Persist with throttling (500ms)
      partialCache.saveThrottled(sessionId, currentState);
    },
    []
  );

  /**
   * Clean up after stream completes.
   */
  const commitAndCleanup = useCallback(async (sessionId: string) => {
    await partialCache.flushThrottled(sessionId);
    stateMapRef.current.delete(sessionId);
    await partialCache.delete(sessionId);
  }, []);

  /**
   * Check for crash recovery and return recovered events.
   */
  const checkAndRecover = useCallback(
    async (sessionId: string): Promise<PartialRecoveryResult> => {
      const noRecovery: PartialRecoveryResult = {
        found: false,
        recoveredEvents: [],
        partialState: null,
      };

      // Phase 1: load the partial file from disk. If THIS phase fails we
      // can't tell if the file is genuinely unrecoverable (corrupt /
      // malformed) or if the failure is transient (IPC blip, disk
      // contention).  Treat a load failure as "no recovery yet" and
      // PRESERVE the file — deleting it eagerly would magnify a transient
      // failure into permanent data loss of the recovered stream content.
      let state: PartialStreamState | null;
      try {
        state = await partialCache.load(sessionId);
      } catch (loadErr) {
        log.warn(
          "[PartialRecovery] Failed to load partial file (will retry on next load):",
          loadErr
        );
        return noRecovery;
      }

      if (!state) {
        return noRecovery;
      }

      // Phase 2: transform the loaded state into SessionEvents.  This
      // section is pure — it does NOT touch disk and so it cannot fail
      // due to I/O.  Even so, we wrap it in a try/catch so a future
      // change that introduces a throw won't accidentally widen the
      // file-deletion blast radius.
      let recoveredEvents: SessionEvent[];
      try {
        recoveredEvents = buildRecoveredEvents(sessionId, state);
      } catch (transformErr) {
        log.warn(
          "[PartialRecovery] Failed to transform partial state into events:",
          transformErr
        );
        // The on-disk file is still valid; do NOT delete it. Surface
        // a no-recovery result so the caller falls back to its normal
        // empty-state UI, and the user can retry by reloading the
        // session (which will hit this code path again).
        return noRecovery;
      }

      // Phase 3: only now — after a clean load AND a clean transform —
      // delete the on-disk file. A failure here is non-fatal: the next
      // session load will re-detect the partial, re-recover, and the
      // duplicate recovered events will be deduped by the events store
      // via `id`. This is strictly safer than the previous behavior
      // which deleted the file on ANY exception from anywhere in the
      // function body.
      try {
        await partialCache.delete(sessionId);
      } catch (deleteErr) {
        log.warn(
          "[PartialRecovery] Failed to delete partial after successful recovery " +
            "(will be re-recovered on next load):",
          deleteErr
        );
      }

      return {
        found: true,
        recoveredEvents,
        partialState: state,
      };
    },
    []
  );

  return {
    trackStreamingDelta,
    startTracking,
    commitAndCleanup,
    checkAndRecover,
    listRecoverableSessions,
    cleanupStale,
  };
}

export default usePartialRecovery;
