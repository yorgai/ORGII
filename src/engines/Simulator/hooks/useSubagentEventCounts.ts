/**
 * useSubagentEventCounts — lightweight per-subagent event count tracker.
 *
 * Subscribes to every subagent session's EventStore snapshot channel and
 * exposes a Map<sessionId, count> of chatEvents length. This is the
 * minimal information needed to globally sort subagents "with activity"
 * ahead of "no activity" subagents BEFORE pagination slices them — so
 * page 1 always shows the populated cells first, page 2 picks up the
 * remainder, and so on.
 *
 * Why not reuse `useMultiSessionSimulatorEvents`?
 *
 * That hook keeps the full simulator-visible event arrays per session in
 * React state so each grid cell can render its replay timeline. For
 * sorting we only need the count, not the events themselves — and we
 * need it for the FULL list of subagents (every page), not just the
 * currently-visible page. Keeping a count-only Map keeps the cost
 * roughly O(N) cells of one number each, even when there are many
 * subagents off-page.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  eventStoreProxy,
  isStreamingSnapshot,
} from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { Snapshot } from "@src/engines/SessionCore/core/store/EventStoreProxy";

import type { SubagentSession } from "./useSubagentSessions";

type CountMap = ReadonlyMap<string, number>;

const EMPTY_MAP: CountMap = new Map();

function extractCount(snapshot: Snapshot): number {
  // Streaming snapshots carry the live chatEvents array; derived snapshots
  // expose the same field. Both shapes have `chatEvents` so a single
  // lookup is enough — we do not need to distinguish here.
  if (isStreamingSnapshot(snapshot)) {
    return snapshot.chatEvents?.length ?? 0;
  }
  return snapshot.chatEvents?.length ?? 0;
}

/**
 * Subscribe to the EventStore snapshot channel for every session in
 * `subagentSessions` and return a Map of sessionId → chat-event count.
 *
 * The returned Map identity is stable across renders when no counts have
 * changed, so downstream `useMemo` deps can rely on it.
 */
export function useSubagentEventCounts(
  subagentSessions: SubagentSession[]
): CountMap {
  const [countMap, setCountMap] = useState<CountMap>(EMPTY_MAP);
  const loadedRef = useRef<Set<string>>(new Set());
  const knownKeysRef = useRef<Set<string>>(new Set());
  const lastCountRef = useRef<Map<string, number>>(new Map());

  const handleSnapshot = useCallback(
    (sessionId: string, snapshot: Snapshot) => {
      const nextCount = extractCount(snapshot);
      const prevCount = lastCountRef.current.get(sessionId);
      if (prevCount === nextCount) return;
      lastCountRef.current.set(sessionId, nextCount);
      knownKeysRef.current.add(sessionId);
      setCountMap((prev) => {
        const next = new Map(prev);
        next.set(sessionId, nextCount);
        return next;
      });
    },
    []
  );

  useEffect(() => {
    if (subagentSessions.length === 0) {
      loadedRef.current.clear();
      lastCountRef.current.clear();
      if (knownKeysRef.current.size > 0) {
        knownKeysRef.current.clear();
        queueMicrotask(() => setCountMap(EMPTY_MAP));
      }
      return;
    }

    const sessionIds = new Set(subagentSessions.map((sub) => sub.sessionId));
    const unsubs: Array<() => void> = [];

    for (const sub of subagentSessions) {
      const sid = sub.sessionId;

      const unsub = eventStoreProxy.subscribeSession(sid, (snapshot) => {
        handleSnapshot(sid, snapshot);
      });
      unsubs.push(unsub);

      if (!loadedRef.current.has(sid)) {
        loadedRef.current.add(sid);

        const liveSnap = eventStoreProxy.getLatestSessionSnapshot(sid);
        if (liveSnap) {
          queueMicrotask(() => handleSnapshot(sid, liveSnap));
        } else {
          eventStoreProxy
            .loadFromCache(sid)
            .then(async (loadedCount) => {
              if (loadedCount === 0) return;
              const snap = await eventStoreProxy.getSnapshot(sid);
              if (snap && sessionIds.has(sid)) {
                handleSnapshot(sid, snap as Snapshot);
              }
            })
            .catch((_err) => {
              // Same policy as useMultiSessionSimulatorEvents: swallow
              // cache load errors. A missing count just leaves the row
              // ranked "no activity" which is the correct fallback.
            });
        }
      }
    }

    // GC stale entries when a previously-tracked session is no longer in
    // the input list (e.g. parent session changed).
    const staleKeys: string[] = [];
    for (const key of knownKeysRef.current) {
      if (!sessionIds.has(key)) staleKeys.push(key);
    }
    if (staleKeys.length > 0) {
      for (const key of staleKeys) {
        knownKeysRef.current.delete(key);
        lastCountRef.current.delete(key);
      }
      queueMicrotask(() => {
        setCountMap((prev) => {
          const next = new Map(prev);
          for (const key of staleKeys) next.delete(key);
          return next;
        });
      });
    }

    for (const sid of loadedRef.current) {
      if (!sessionIds.has(sid)) {
        loadedRef.current.delete(sid);
        lastCountRef.current.delete(sid);
      }
    }

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [subagentSessions, handleSnapshot]);

  if (subagentSessions.length === 0) return EMPTY_MAP;
  return countMap;
}
