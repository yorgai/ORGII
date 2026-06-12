/**
 * EventStoreProxy — Thin frontend wrapper for the Rust EventStore.
 *
 * All event storage, indexing, merging, derived computation, and session
 * caching now live in Rust. This proxy:
 *
 * 1. Calls typed Tauri RPC procedures for writes (set, append, upsert, merge, etc.)
 * 2. Listens to `es:changed` Tauri events for read notifications
 * 3. Routes snapshots by `sessionId` so per-session subscribers (e.g.
 *    subagent nested blocks) only receive updates for their session.
 *
 * Components continue using Jotai atoms (eventsAtom, chatEventsAtom, etc.)
 * which are fed from the derived snapshot pushed by Rust.
 */
import { type UnlistenFn, listen } from "@tauri-apps/api/event";

import { rpc } from "@src/api/tauri/rpc";

import type { EventPayloadBody, SessionEvent } from "../types";
import type {
  DerivedSnapshot,
  EventStoreMemoryStats,
  GlobalListener,
  NormalizedSnapshotCache,
  SessionListener,
  Snapshot,
  SnapshotEnvelope,
  SnapshotPayload,
} from "./EventStoreProxyTypes";
import { inferSessionId, isRealUserEvent } from "./eventStoreEvents";
import { estimateObjectBytes } from "./memoryEstimation";
import { rememberSnapshot, resolveSnapshotPayload } from "./snapshotCache";

export type {
  DerivedSnapshot,
  EventStoreMemoryStats,
  Snapshot,
  SnapshotDelta,
  SnapshotEnvelope,
  SnapshotPayload,
  StreamingSnapshot,
} from "./EventStoreProxyTypes";
export { isStreamingSnapshot } from "./snapshotMaterialization";

const SNAPSHOT_CACHE_MAX = 20;

class EventStoreProxyImpl {
  private _globalListeners = new Set<GlobalListener>();
  private _sessionListeners = new Map<string, Set<SessionListener>>();
  private _latestSnapshots = new Map<string, Snapshot>();
  private _normalizedSnapshots = new Map<string, NormalizedSnapshotCache>();
  private _unlistenTauri: UnlistenFn | null = null;
  private _initialized = false;
  private _initGeneration = 0;
  /**
   * Per-session promise chains serializing envelope processing.
   * `_handleSnapshotEnvelope` awaits `getSnapshot` for delta-base misses;
   * without serialization, two envelopes for the same session can interleave
   * and apply out of order (older snapshot remembered after a newer one).
   */
  private _envelopeChains = new Map<string, Promise<void>>();

  /**
   * Initialize the Tauri event listener. Call once at app startup.
   * Idempotent — safe to call multiple times.
   */
  async init(): Promise<void> {
    // Only short-circuit if a listener is actually registered; otherwise allow
    // re-init after a prior destroy().
    if (this._initialized && this._unlistenTauri !== null) return;
    this._initialized = true;

    // Generation token: if destroy() bumps the counter while we await
    // listen(...), the resumed init() must drop the orphaned unlisten handle
    // instead of stashing it on top of a fresh one.
    const myGen = ++this._initGeneration;

    const unlisten = await listen<SnapshotEnvelope>("es:changed", (event) => {
      void this._handleSnapshotEnvelope(event.payload);
    });

    if (myGen !== this._initGeneration) {
      unlisten();
      return;
    }
    this._unlistenTauri = unlisten;
  }

  private async _handleSnapshotEnvelope(
    envelope: SnapshotEnvelope
  ): Promise<void> {
    const { sessionId } = envelope;
    // Serialize per session: chain this envelope after the previous one so
    // async delta resolution can't interleave snapshots out of order.
    const previous = this._envelopeChains.get(sessionId) ?? Promise.resolve();
    const current = previous
      .catch(() => {
        // Previous envelope failures must not poison the chain.
      })
      .then(() => this._processSnapshotEnvelope(envelope));
    this._envelopeChains.set(sessionId, current);
    try {
      await current;
    } finally {
      // Drop the chain entry once the tail settles to avoid leaking sessions.
      if (this._envelopeChains.get(sessionId) === current) {
        this._envelopeChains.delete(sessionId);
      }
    }
  }

  private async _processSnapshotEnvelope(
    envelope: SnapshotEnvelope
  ): Promise<void> {
    const { sessionId, ...payload } = envelope;
    const snapshot = await this._resolveSnapshotPayload(
      sessionId,
      payload as SnapshotPayload
    );
    const rememberedSnapshot = this._rememberSnapshot(sessionId, snapshot);
    this._notifyListeners(rememberedSnapshot, sessionId);
  }

  private async _resolveSnapshotPayload(
    sessionId: string,
    payload: SnapshotPayload
  ): Promise<Snapshot> {
    return resolveSnapshotPayload(
      sessionId,
      payload,
      this._latestSnapshots,
      this._normalizedSnapshots,
      (snapshotSessionId) => this.getSnapshot(snapshotSessionId)
    );
  }

  private _rememberSnapshot(sessionId: string, snapshot: Snapshot): Snapshot {
    return rememberSnapshot(
      sessionId,
      snapshot,
      this._latestSnapshots,
      this._normalizedSnapshots,
      SNAPSHOT_CACHE_MAX
    );
  }

  /**
   * Detach only the Tauri `es:changed` listener.
   *
   * Used by the bridge hook's unmount cleanup (StrictMode double-mount, fast
   * navigation, HMR): the IPC listener must be torn down so it isn't
   * orphaned, but per-session subscribers (`_sessionListeners`) and the
   * snapshot caches (`_latestSnapshots` / `_normalizedSnapshots`) must
   * survive so other live consumers (e.g. subagent grids) keep their data
   * and the next `init()` can resume without a cold cache.
   */
  detachTauri(): void {
    this._initGeneration++;
    if (this._unlistenTauri) {
      this._unlistenTauri();
      this._unlistenTauri = null;
    }
    this._initialized = false;
  }

  /** Full clean-up: Tauri listener, all listeners, and all snapshot caches.
   * Use on app exit or in tests; bridge unmounts should call detachTauri(). */
  destroy(): void {
    this.detachTauri();
    this._globalListeners.clear();
    this._sessionListeners.clear();
    this._latestSnapshots.clear();
    this._normalizedSnapshots.clear();
  }

  // =========================================================================
  // Subscribe / Read
  // =========================================================================

  /**
   * Subscribe to ALL snapshot changes (any session).
   * Callback receives the snapshot and the sessionId it belongs to.
   * Returns an unsubscribe function.
   */
  subscribe(listener: GlobalListener): () => void {
    this._globalListeners.add(listener);
    return () => {
      this._globalListeners.delete(listener);
    };
  }

  /**
   * Subscribe to snapshot changes for a specific session only.
   * Used by `useSessionEvents` for subagent nested block rendering.
   * Returns an unsubscribe function.
   */
  subscribeSession(sessionId: string, listener: SessionListener): () => void {
    let listeners = this._sessionListeners.get(sessionId);
    if (!listeners) {
      listeners = new Set();
      this._sessionListeners.set(sessionId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners!.delete(listener);
      if (listeners!.size === 0) {
        this._sessionListeners.delete(sessionId);
      }
    };
  }

  /** Get the latest snapshot for a specific session (may be null). */
  getLatestSessionSnapshot(sessionId: string): Snapshot | null {
    return this._latestSnapshots.get(sessionId) ?? null;
  }

  /**
   * Evict a session's cached snapshot and per-session listeners.
   *
   * Call this when Rust evicts a session from its LRU store so the JS-side
   * cache stays in sync and doesn't hold large event arrays for idle sessions.
   */
  evictSessionCache(sessionId: string): void {
    this._latestSnapshots.delete(sessionId);
    this._normalizedSnapshots.delete(sessionId);
    this._sessionListeners.delete(sessionId);
  }

  getMemoryStats(): EventStoreMemoryStats {
    let cachedEvents = 0;
    let bytes = 0;
    for (const snapshot of this._latestSnapshots.values()) {
      bytes += estimateObjectBytes(snapshot);
    }
    for (const cache of this._normalizedSnapshots.values()) {
      cachedEvents += cache.eventsById.size;
      bytes += estimateObjectBytes(cache);
    }
    return {
      cachedSessions: this._latestSnapshots.size,
      normalizedSessions: this._normalizedSnapshots.size,
      cachedEvents,
      bytes,
    };
  }

  /** Get the latest snapshot (any session — last received). */
  get latestSnapshot(): Snapshot | null {
    if (this._latestSnapshots.size === 0) return null;
    let latest: Snapshot | null = null;
    for (const snap of this._latestSnapshots.values()) {
      if (!latest || snap.version > latest.version) {
        latest = snap;
      }
    }
    return latest;
  }

  // =========================================================================
  // Write Operations (delegate to Rust)
  // =========================================================================

  private async evictSyntheticUserEventsForRealUserEvents(
    events: SessionEvent[],
    sessionId?: string | null
  ): Promise<void> {
    if (!events.some(isRealUserEvent)) return;
    await this.removeSyntheticUserInputEvents(
      sessionId ?? inferSessionId(events)
    );
  }

  /** Replace all events (session load / clear). */
  async set(events: SessionEvent[], sessionId?: string): Promise<void> {
    await rpc.sessionCore.eventStore.set({
      events,
      sessionId: sessionId ?? inferSessionId(events),
    });
  }

  /** Append events (deduped by ID). */
  async append(events: SessionEvent[], sessionId?: string): Promise<void> {
    if (events.length === 0) return;
    const resolvedSessionId = sessionId ?? inferSessionId(events);
    await this.evictSyntheticUserEventsForRealUserEvents(
      events,
      resolvedSessionId
    );
    await rpc.sessionCore.eventStore.append({
      events,
      sessionId: resolvedSessionId,
    });
  }

  /** Upsert a single event. */
  async upsert(event: SessionEvent, sessionId?: string): Promise<void> {
    const resolvedSessionId = sessionId ?? event.sessionId ?? null;
    await this.evictSyntheticUserEventsForRealUserEvents(
      [event],
      resolvedSessionId
    );
    await rpc.sessionCore.eventStore.upsert({
      event,
      sessionId: resolvedSessionId,
    });
  }

  /** Update a single event by ID with a partial patch. */
  async updateById(
    id: string,
    patch: Partial<SessionEvent>,
    sessionId?: string
  ): Promise<boolean> {
    return rpc.sessionCore.eventStore.updateById({
      id,
      patch,
      sessionId: sessionId ?? null,
    });
  }

  /** Merge incoming events (tool_result → tool_call, dedup, append). */
  async mergeEvents(events: SessionEvent[], sessionId?: string): Promise<void> {
    if (events.length === 0) return;
    const resolvedSessionId = sessionId ?? inferSessionId(events);
    await this.evictSyntheticUserEventsForRealUserEvents(
      events,
      resolvedSessionId
    );
    await rpc.sessionCore.eventStore.mergeEvents({
      events,
      sessionId: resolvedSessionId,
    });
  }

  /** Merge lazy-loaded round body events without changing hydration mode to live. */
  async mergeRoundWindowEvents(
    events: SessionEvent[],
    sessionId?: string
  ): Promise<void> {
    if (events.length === 0) return;
    await rpc.sessionCore.eventStore.mergeRoundWindowEvents({
      events,
      sessionId: sessionId ?? inferSessionId(events),
    });
  }

  /** Set streaming mode on/off. */
  async setStreaming(streaming: boolean, sessionId?: string): Promise<void> {
    await rpc.sessionCore.eventStore.setStreaming({
      streaming,
      sessionId: sessionId ?? null,
    });
  }

  /** Clear all events from the active store. */
  async clear(sessionId?: string): Promise<void> {
    await rpc.sessionCore.eventStore.clear({ sessionId: sessionId ?? null });
  }

  /**
   * Keep only events strictly before the event with the given ID.
   */
  async truncateBeforeId(
    eventId: string,
    sessionId?: string
  ): Promise<boolean> {
    return rpc.sessionCore.eventStore.truncateBeforeId({
      eventId,
      sessionId: sessionId ?? null,
    });
  }

  // =========================================================================
  // Session Manager Operations
  // =========================================================================

  /** Switch the active session. Returns true if cache hit. */
  async switchSession(sessionId: string): Promise<boolean> {
    return rpc.sessionCore.eventStore.switchSession({ sessionId });
  }

  /** Pin a session (agent running). */
  async pinSession(sessionId: string): Promise<void> {
    await rpc.sessionCore.eventStore.pinSession({ sessionId });
  }

  /** Unpin a session (agent finished). */
  async unpinSession(sessionId: string): Promise<void> {
    await rpc.sessionCore.eventStore.unpinSession({ sessionId });
  }

  /** Evict a session from the in-memory Rust cache and purge JS-side caches. */
  async evictSession(sessionId: string): Promise<void> {
    await rpc.sessionCore.eventStore.evictSession({ sessionId });
    // Mirror the Rust-side eviction in the JS snapshot cache so large event
    // arrays are freed on the JS heap as well.
    this.evictSessionCache(sessionId);
  }

  /** Buffer events for a background session. */
  async bufferEvents(sessionId: string, events: SessionEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.evictSyntheticUserEventsForRealUserEvents(events, sessionId);
    await rpc.sessionCore.eventStore.bufferEvents({ sessionId, events });
  }

  // =========================================================================
  // Snapshot / Query
  // =========================================================================

  /** Fetch the full derived snapshot from Rust. */
  async getSnapshot(sessionId?: string): Promise<DerivedSnapshot> {
    const snapshot = (await rpc.sessionCore.eventStore.getSnapshot({
      sessionId: sessionId ?? null,
    })) as DerivedSnapshot;
    if (sessionId) {
      return this._rememberSnapshot(sessionId, snapshot) as DerivedSnapshot;
    }
    return snapshot;
  }

  /** Fetch raw events array from Rust. */
  async getEvents(sessionId?: string): Promise<SessionEvent[]> {
    return rpc.sessionCore.eventStore.getEvents({
      sessionId: sessionId ?? null,
    }) as Promise<SessionEvent[]>;
  }

  // =========================================================================
  // SQLite Bridge
  // =========================================================================

  /** Load events from SQLite cache into the Rust store. Returns count loaded. */
  async loadFromCache(sessionId: string): Promise<number> {
    return rpc.sessionCore.eventStore.loadFromCache({ sessionId });
  }

  /** Load a round-windowed cache view into the Rust store. */
  async loadInitialTurnWindow(
    sessionId: string,
    recentTurnCount?: number
  ): Promise<number> {
    return rpc.sessionCore.eventStore.loadInitialTurnWindow({
      sessionId,
      recentTurnCount,
    });
  }

  /** Remove one loaded turn body from the in-memory store and restore its placeholder. */
  async unloadTurnBody(sessionId: string, turnId: string): Promise<number> {
    return rpc.sessionCore.eventStore.unloadTurnBody({ sessionId, turnId });
  }

  async loadEventPayload(
    sessionId: string,
    eventId: string,
    fieldPath: string
  ): Promise<EventPayloadBody | null> {
    return rpc.sessionCore.cache.loadEventPayload({
      sessionId,
      eventId,
      fieldPath,
    });
  }

  /** Save current store events to SQLite cache. Returns count saved. */
  async saveToCache(sessionId: string): Promise<number> {
    try {
      return await rpc.sessionCore.eventStore.saveToCache({ sessionId });
    } catch (error) {
      console.warn(
        `[EventStoreProxy] saveToCache failed for ${sessionId}; continuing with in-memory EventStore`,
        error
      );
      return 0;
    }
  }

  // =========================================================================
  // Batch Update Operations
  // =========================================================================

  /** Complete the last running event. Returns the event ID if found. */
  async completeLastRunning(sessionId?: string): Promise<string | null> {
    return rpc.sessionCore.eventStore.completeLastRunning({
      sessionId: sessionId ?? null,
    });
  }

  /** Batch-update multiple events by IDs with the same patch. Returns count updated. */
  async patchByIds(
    ids: string[],
    patch: Partial<SessionEvent>,
    sessionId?: string
  ): Promise<number> {
    if (ids.length === 0) return 0;
    return rpc.sessionCore.eventStore.patchByIds({
      ids,
      patch,
      sessionId: sessionId ?? null,
    });
  }

  /** Remove events whose IDs start with a given prefix. Returns count removed. */
  async removeByIdPrefix(prefix: string, sessionId?: string): Promise<number> {
    return rpc.sessionCore.eventStore.removeByIdPrefix({
      prefix,
      sessionId: sessionId ?? null,
    });
  }

  /** Remove frontend-injected user placeholders after backend echo arrives. */
  async removeSyntheticUserInputEvents(
    sessionId?: string | null
  ): Promise<number> {
    return rpc.sessionCore.eventStore.removeSyntheticUserInputs({
      sessionId: sessionId ?? null,
    });
  }

  /** Atomically remove one event and upsert another (stream finalization). */
  async replaceAndRemove(
    removeId: string | null,
    newEvent: SessionEvent,
    sessionId?: string
  ): Promise<boolean> {
    const resolvedSessionId = sessionId ?? newEvent.sessionId ?? null;
    await this.evictSyntheticUserEventsForRealUserEvents(
      [newEvent],
      resolvedSessionId
    );
    return rpc.sessionCore.eventStore.replaceAndRemove({
      removeId,
      newEvent,
      sessionId: resolvedSessionId,
    });
  }

  /** Update args on the last active spawning tool_call. Returns event ID if found. */
  async updateActiveTaskArgs(
    mergeArgs: Record<string, unknown>,
    functionNames?: string[],
    sessionId?: string
  ): Promise<string | null> {
    return rpc.sessionCore.eventStore.updateActiveTaskArgs({
      mergeArgs,
      functionNames: functionNames ?? null,
      sessionId: sessionId ?? null,
    });
  }

  /** Update streamOutput on the last shell tool_call. Returns event ID if found. */
  async updateLastShellOutput(
    streamOutput: string,
    sessionId?: string
  ): Promise<string | null> {
    return rpc.sessionCore.eventStore.updateLastShellOutput({
      streamOutput,
      sessionId: sessionId ?? null,
    });
  }

  /**
   * Update shell process info (pid, status, exit_code, log_path) on the last shell tool_call.
   */
  updateLastShellProcess(
    pid: number,
    status: "running" | "background" | "exited" | "killed",
    exitCode?: number,
    logPath?: string,
    sessionId?: string
  ): void {
    void rpc.sessionCore.eventStore.updateLastShellProcess({
      pid,
      status,
      exitCode: exitCode ?? null,
      logPath: logPath ?? null,
      sessionId: sessionId ?? null,
    });
  }

  /** Check if there is an active spawning tool_call in the store. */
  async hasActiveTask(
    functionNames?: string[],
    sessionId?: string
  ): Promise<boolean> {
    return rpc.sessionCore.eventStore.hasActiveTask({
      functionNames: functionNames ?? null,
      sessionId: sessionId ?? null,
    });
  }

  // =========================================================================
  // Internal
  // =========================================================================

  private _notifyListeners(snapshot: Snapshot, sessionId: string): void {
    for (const listener of this._globalListeners) {
      listener(snapshot, sessionId);
    }

    const sessionListeners = this._sessionListeners.get(sessionId);
    if (sessionListeners) {
      for (const listener of sessionListeners) {
        listener(snapshot);
      }
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

/**
 * Global event store proxy singleton.
 * All session sync hooks write here; all UI consumers read via Jotai atoms
 * that are fed from snapshot notifications.
 */
export const eventStoreProxy = new EventStoreProxyImpl();
export type { EventStoreProxyImpl as EventStoreProxy };
