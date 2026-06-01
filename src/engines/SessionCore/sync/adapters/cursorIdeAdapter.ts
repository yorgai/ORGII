/**
 * Cursor IDE Session Adapter
 *
 * Surfaces Cursor IDE chat history (read from `~/.../state.vscdb`) as
 * sessions in our app **and** lets the user send new prompts back into
 * the live Cursor probe instance through {@link sendMessage}.
 *
 * - `loadHistory` reads bubbles from Cursor's DB via `cursor_ide_chunks`
 *   and pipes them through the same Rust normalizer (`processChunksRust`)
 *   that CLI sessions use, so `ChatHistory` and the simulator render them
 *   without any UI-layer changes.
 * - `createEventHandler` handles `code_session.activity` delta events
 *   delivered via the long-lived CDP watch established by `sendMessage`.
 *   Each `assistant_delta` chunk with `is_delta: true` is accumulated
 *   locally for the typewriter effect. The polling hook
 *   `useCursorIdeFocusPoll` continues to run as fallback for tool-call
 *   bubbles and final state replacement.
 * - `sendMessage` runs the probe flow: `ensureRunning` →
 *   optional `setModel` → optional `setMode` → headless `send`
 *   (composer-targeted, no UI route) → start CDP watch via
 *   `cursorBridgeWatchComposer` → forced reload of the EventStore.
 * - `stopSession` cancels the CDP watch via `cursorBridgeUnwatchComposer`
 *   (no ORGII-side process to stop; Cursor turn cancellation is Cursor's own).
 */
import {
  cursorBridgeComposerLastUpdatedAt,
  cursorBridgeEnsureRealCursorRunning,
  cursorBridgeSend,
  cursorBridgeSetMode,
  cursorBridgeSetModel,
  cursorBridgeUnwatchComposer,
  cursorBridgeWatchComposer,
} from "@src/api/tauri/cursorBridge";
import { promptRestartCursorWithDebugPort } from "@src/api/tauri/cursorBridge/restartDialog";
import {
  cursorIdeFullRefresh,
  cursorIdeInitialWindow,
} from "@src/api/tauri/cursorIde";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { processChunksRust } from "@src/engines/SessionCore/ingestion/rustBridge";
import { makeAssistantEvent } from "@src/engines/SessionCore/sync/adapters/shared/eventBuilders";
import { createStreamMessageId } from "@src/engines/SessionCore/sync/utils/activityIds";
import { createLogger } from "@src/hooks/logger";
import { cursorIdeTurnSummariesAtomFamily } from "@src/store/session/cursorIdeTurnSummariesAtom";
import { cursorModeOverrideAtomFamily } from "@src/store/session/cursorModeOverrideAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import {
  composerIdFromSessionId,
  isCursorIdeSession,
} from "@src/util/session/sessionDispatch";

import type {
  AdapterSendInput,
  EventHandlerCallbacks,
  RawSessionEvent,
  SessionAdapter,
  SessionEventHandler,
} from "../types";

const logger = createLogger("CursorIdeAdapter");

const CURSOR_IDE_CATEGORY = "cursor_ide";
const CURSOR_IDE_INITIAL_RECENT_BUBBLE_LIMIT = 100;

/**
 * In-flight `sendMessage` calls keyed by sessionId. A second prompt for the
 * same Cursor composer must not race the first: both would tear down and
 * replace each other's CDP watch (`cursorBridgeWatchComposer` "replaces any
 * existing watch automatically"), orphaning the first prompt's delta stream.
 * The guard serializes per-session sends so each prompt's watch outlives
 * its own dispatch.
 */
const _inFlightSends = new Map<string, Promise<void>>();

const cursorIdeSnapshotLastUpdatedAtBySession = new Map<string, number>();

export function getCursorIdeSnapshotLastUpdatedAt(
  sessionId: string
): number | null {
  return cursorIdeSnapshotLastUpdatedAtBySession.get(sessionId) ?? null;
}

async function refreshCursorIdeSnapshotLastUpdatedAt(
  sessionId: string
): Promise<void> {
  const composerId = composerIdFromSessionId(sessionId);
  if (!composerId) return;
  const lastUpdatedAt = await cursorBridgeComposerLastUpdatedAt(composerId);
  if (lastUpdatedAt !== null) {
    cursorIdeSnapshotLastUpdatedAtBySession.set(sessionId, lastUpdatedAt);
  }
}

interface CursorIdeReloadState {
  inFlight: Promise<void> | null;
  needsReloadAfterCurrent: boolean;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  debouncedPromise: Promise<void> | null;
  resolveDebounced: (() => void) | null;
  rejectDebounced: ((error: unknown) => void) | null;
}

const cursorIdeReloadStates = new Map<string, CursorIdeReloadState>();
const CURSOR_IDE_FORCED_RELOAD_DEBOUNCE_MS = 250;

function getCursorIdeReloadState(sessionId: string): CursorIdeReloadState {
  let state = cursorIdeReloadStates.get(sessionId);
  if (!state) {
    state = {
      inFlight: null,
      needsReloadAfterCurrent: false,
      debounceTimer: null,
      debouncedPromise: null,
      resolveDebounced: null,
      rejectDebounced: null,
    };
    cursorIdeReloadStates.set(sessionId, state);
  }
  return state;
}

/**
 * Lazy-load a Cursor IDE session's events into the EventStore so any
 * `useSessionEvents(sessionId)` consumer (notably nested SubagentBlocks
 * expanded inside a parent Cursor history view) can replay them.
 *
 * Idempotent and safe to call repeatedly:
 * - returns immediately if the session id is not a `cursoride-*` id
 * - returns immediately if the EventStore already has events for this id
 * - coalesces concurrent in-flight loads on the same id
 *
 * The EventStore push uses `set` (not `mergeEvents`) because cursor history
 * is immutable on disk — there is nothing to merge with, and `set` is
 * cheaper. The events live alongside CLI/agent sessions in the same Rust
 * LRU; eviction is fine because we can always reload from `state.vscdb`.
 */
export async function ensureCursorIdeEventsInStore(
  sessionId: string,
  options?: { forceReload?: boolean }
): Promise<void> {
  if (!isCursorIdeSession(sessionId)) return;

  const force = options?.forceReload === true;
  if (!force) {
    const existing = eventStoreProxy.getLatestSessionSnapshot(sessionId);
    if (existing && existing.eventCount > 0) return;
  }

  const state = getCursorIdeReloadState(sessionId);
  if (!force && state.inFlight) return state.inFlight;
  if (!force) return runCursorIdeScheduledReload(sessionId, state, false);
  return scheduleCursorIdeForcedReload(sessionId, state);
}

function scheduleCursorIdeForcedReload(
  sessionId: string,
  state: CursorIdeReloadState
): Promise<void> {
  if (state.inFlight) {
    state.needsReloadAfterCurrent = true;
    return state.inFlight;
  }

  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }

  if (!state.debouncedPromise) {
    state.debouncedPromise = new Promise<void>((resolve, reject) => {
      state.resolveDebounced = resolve;
      state.rejectDebounced = reject;
    });
  }

  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null;
    const promiseToResolve = state.resolveDebounced;
    const promiseToReject = state.rejectDebounced;
    state.debouncedPromise = null;
    state.resolveDebounced = null;
    state.rejectDebounced = null;

    void runCursorIdeScheduledReload(sessionId, state, true).then(
      () => promiseToResolve?.(),
      (error: unknown) => promiseToReject?.(error)
    );
  }, CURSOR_IDE_FORCED_RELOAD_DEBOUNCE_MS);

  return state.debouncedPromise;
}

function runCursorIdeScheduledReload(
  sessionId: string,
  state: CursorIdeReloadState,
  force: boolean
): Promise<void> {
  if (state.inFlight) {
    if (force) state.needsReloadAfterCurrent = true;
    return state.inFlight;
  }

  const work = (async () => {
    try {
      await loadCursorIdeEventsIntoStore(sessionId, force);
      while (state.needsReloadAfterCurrent) {
        state.needsReloadAfterCurrent = false;
        await loadCursorIdeEventsIntoStore(sessionId, true);
      }
    } finally {
      state.inFlight = null;
      if (!state.debounceTimer && !state.debouncedPromise) {
        cursorIdeReloadStates.delete(sessionId);
      }
    }
  })();
  state.inFlight = work;
  return work;
}

async function loadCursorIdeEventsIntoStore(
  sessionId: string,
  force: boolean
): Promise<void> {
  const loadResult = force
    ? await cursorIdeFullRefresh(sessionId)
    : await cursorIdeInitialWindow({
        sessionId,
        recentLimit: CURSOR_IDE_INITIAL_RECENT_BUBBLE_LIMIT,
      });

  getInstrumentedStore().set(
    cursorIdeTurnSummariesAtomFamily(sessionId),
    loadResult.turns
  );

  if (!Array.isArray(loadResult.chunks) || loadResult.chunks.length === 0) {
    return;
  }
  const events = await processChunksRust(loadResult.chunks, sessionId);
  if (events.length === 0) return;
  await eventStoreProxy.set(events, sessionId);
  await refreshCursorIdeSnapshotLastUpdatedAt(sessionId);
}

function buildCursorDeltaEvent(
  streamId: string,
  sessionId: string,
  content: string,
  startedAt: string
): SessionEvent {
  const base = makeAssistantEvent(streamId, sessionId, content, true);
  return {
    ...base,
    createdAt: startedAt,
    result: {
      content,
      observation: content,
      role: "assistant",
      is_delta: true,
    },
  };
}

export const cursorIdeAdapter: SessionAdapter = {
  category: CURSOR_IDE_CATEGORY,

  async loadHistory(sessionId, signal) {
    const initialWindow = await cursorIdeInitialWindow({
      sessionId,
      recentLimit: CURSOR_IDE_INITIAL_RECENT_BUBBLE_LIMIT,
    });
    if (signal.aborted) return [];
    getInstrumentedStore().set(
      cursorIdeTurnSummariesAtomFamily(sessionId),
      initialWindow.turns
    );
    const { chunks } = initialWindow;
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return [];
    }
    const events = await processChunksRust(chunks, sessionId);
    if (signal.aborted) return [];
    await refreshCursorIdeSnapshotLastUpdatedAt(sessionId);
    return events;
  },

  async postLoad() {
    return {};
  },

  createEventHandler(
    sessionId: string,
    callbacks: EventHandlerCallbacks
  ): SessionEventHandler {
    let _streaming = false;
    let msgContent = "";
    let msgStreamId = "";
    let msgStartedAt = "";

    function setStreamingMode(active: boolean): void {
      if (_streaming !== active) {
        _streaming = active;
        eventStoreProxy.setStreaming(active, sessionId);
      }
    }

    // NOTE: this adapter deliberately does NOT drive `onStatusChange`.
    // The CDP delta stream has no terminal "answer finished" event — the
    // deltas simply stop — so the adapter cannot emit a balanced
    // running → completed pair. Cursor IDE session runtime status is
    // owned by the polling fallback (`useCursorIdeFocusPoll`), which reads
    // the authoritative final state from Cursor's own DB.

    function clearMessageStream(): void {
      msgContent = "";
      msgStreamId = "";
      msgStartedAt = "";
    }

    return {
      handleEvent(raw: RawSessionEvent): void {
        const msgSessionId =
          (raw.session_id as string) || (raw.sessionId as string);
        if (msgSessionId !== sessionId) return;

        // Only handle streaming delta chunks from the CDP watch
        if (raw.type !== "code_session.activity" || !raw.chunk) return;

        const chunk = raw.chunk as Record<string, unknown>;
        const actionType = chunk.action_type as string | undefined;
        const result = chunk.result as Record<string, unknown> | undefined;
        const isDelta = result?.is_delta === true;

        if (
          isDelta &&
          (actionType === "assistant_delta" ||
            actionType === "assistant" ||
            actionType === "message_delta" ||
            actionType === "message")
        ) {
          setStreamingMode(true);
          const deltaText =
            (result?.content as string) ||
            (result?.observation as string) ||
            "";
          if (!deltaText) return;

          if (!msgStreamId) {
            msgStreamId = createStreamMessageId(sessionId);
            msgStartedAt = new Date().toISOString();
          }
          msgContent += deltaText;
          eventStoreProxy.upsert(
            buildCursorDeltaEvent(
              msgStreamId,
              sessionId,
              msgContent,
              msgStartedAt
            ),
            sessionId
          );
          // Feed the partial-recovery cache so a mid-stream crash/reload
          // can replay the in-flight Cursor answer.
          callbacks.onStreamingDelta?.({
            isStreaming: true,
            isThinking: false,
            content: msgContent,
          });
        }
      },

      reset(): void {
        clearMessageStream();
        _streaming = false;
        eventStoreProxy.setStreaming(false, sessionId);
      },

      get isStreaming(): boolean {
        return _streaming;
      },

      dispose(): void {
        this.reset();
      },
    };
  },

  async sendMessage(input: AdapterSendInput): Promise<void> {
    const { sessionId, content } = input;
    if (!content.trim()) return;

    // Serialize per-session sends. A double-click or queue-flush firing a
    // second prompt while the first is mid-flight would otherwise let each
    // call replace the other's CDP watch, orphaning the first delta stream.
    const inflight = _inFlightSends.get(sessionId);
    if (inflight) {
      logger.warn(
        `sendMessage already in-flight for ${sessionId}; chaining after it`
      );
      await inflight.catch(() => {
        // Swallow the prior send's failure here — it was already surfaced
        // to its own caller; this call gets a clean attempt.
      });
    }

    const work = runCursorIdeSend(input);
    _inFlightSends.set(sessionId, work);
    try {
      await work;
    } finally {
      if (_inFlightSends.get(sessionId) === work) {
        _inFlightSends.delete(sessionId);
      }
    }
  },

  async stopSession(sessionId: string): Promise<void> {
    // Cancel the long-lived CDP watch for this session (if any).
    // Cursor turn cancellation is owned by Cursor itself.
    cursorBridgeUnwatchComposer({ sessionId }).catch((err: unknown) => {
      logger.warn("cursorBridgeUnwatchComposer failed:", err);
    });
  },
};

/**
 * Core send sequence for a Cursor IDE prompt. Extracted from
 * `sendMessage` so the public method can wrap it in the per-session
 * in-flight guard.
 *
 * Ordering matters: the CDP delta watch MUST be installed (awaited)
 * before the EventStore force-reload. The watch installs a
 * MutationObserver in the Cursor renderer; if the reload completes
 * first, any token deltas emitted in the gap are lost and the first
 * chunk of the answer never animates.
 */
async function runCursorIdeSend(input: AdapterSendInput): Promise<void> {
  const { sessionId, content, model } = input;
  const text = content.trim();
  if (!text) return;
  const composerId = composerIdFromSessionId(sessionId);

  // Follow-ups must target the real Cursor DB that owns the composer.
  // If the user's real Cursor is running without the debug port, ask
  // before restarting it hidden so the same DB stays authoritative.
  try {
    await cursorBridgeEnsureRealCursorRunning();
  } catch (cursorError) {
    const restarted = await promptRestartCursorWithDebugPort(cursorError);
    if (!restarted) throw cursorError;
    await cursorBridgeEnsureRealCursorRunning();
  }

  // Apply per-send model override before dispatching the prompt.
  // Failure here is non-fatal: we fall through to send with whatever
  // Cursor already has selected — but it MUST be logged so a silently
  // ignored model pick is diagnosable.
  if (model && composerId) {
    try {
      await cursorBridgeSetModel({ agentId: composerId, modelName: model });
    } catch (modelErr: unknown) {
      logger.warn(
        `setModel(${model}) failed for ${composerId}; sending with Cursor's current model:`,
        modelErr
      );
    }
  }

  // Apply per-send unified mode override from the per-session atom that
  // `CursorModePill` writes into. Same lazy-commit posture as the model setter.
  if (composerId) {
    const pickedMode = getInstrumentedStore().get(
      cursorModeOverrideAtomFamily(sessionId)
    );
    if (pickedMode) {
      try {
        await cursorBridgeSetMode({ agentId: composerId, modeId: pickedMode });
      } catch (modeErr: unknown) {
        logger.warn(
          `setMode(${pickedMode}) failed for ${composerId}; sending with Cursor's current mode:`,
          modeErr
        );
      }
    }
  }

  await cursorBridgeSend({ text, targetAgentId: composerId ?? undefined });

  // Start streaming delta watch BEFORE the force-reload. The watch injects
  // a MutationObserver into the Cursor renderer and forwards each token
  // delta to `createEventHandler` via the `code_session.activity` event.
  // Any existing watch for this session is replaced automatically.
  //
  // This is awaited (unlike the historical fire-and-forget version) so the
  // observer is guaranteed live before the reload completes — otherwise the
  // first deltas race the reload and the typewriter effect skips them.
  if (composerId) {
    try {
      await cursorBridgeWatchComposer({ sessionId, composerId });
    } catch (watchErr: unknown) {
      // Non-fatal: the polling fallback (`useCursorIdeFocusPoll`) still
      // surfaces the final state. Log so the missing typewriter is traceable.
      logger.warn(
        `cursorBridgeWatchComposer failed for ${sessionId}; falling back to poll:`,
        watchErr
      );
    }
  }

  // Force-reload the EventStore so the user message and any pre-stream
  // bubbles surface immediately without waiting for the next poll tick.
  await ensureCursorIdeEventsInStore(sessionId, { forceReload: true });
}
