/**
 * useMultiSessionSimulatorEvents — subscribe to simulator events from
 * multiple child sessions simultaneously.
 *
 * Returns a bounded Map from sessionId → recent simulator-visible SessionEvent[]
 * for grid cells. This intentionally keeps only the latest window per child
 * session so large subagent histories do not stay duplicated in React state.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type SessionEvent,
  isVisibleInSimulator,
} from "@src/engines/SessionCore";
import {
  eventStoreProxy,
  isStreamingSnapshot,
} from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type {
  DerivedSnapshot,
  Snapshot,
  StreamingSnapshot,
} from "@src/engines/SessionCore/core/store/EventStoreProxy";

import type { SubagentSession } from "./useSubagentSessions";

const MAX_EVENTS_PER_SUBAGENT_SESSION = 360;

type SessionEventsMap = Map<string, SessionEvent[]>;

const EMPTY_MAP: SessionEventsMap = new Map();

function trimEventWindow(events: SessionEvent[]): SessionEvent[] {
  if (events.length <= MAX_EVENTS_PER_SUBAGENT_SESSION) return events;
  return events.slice(events.length - MAX_EVENTS_PER_SUBAGENT_SESSION);
}

function eventCreatedAtMs(event: SessionEvent): number {
  const t = new Date(event.createdAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Insert `event` into `events` so the array remains sorted ascending by
 * `createdAt`. Uses linear scan from the tail because streaming arrivals are
 * almost always in order; the rare out-of-order arrival walks back at most
 * a handful of positions, never breaking the sorted invariant that every
 * binary search downstream relies on.
 */
function insertSorted(events: SessionEvent[], event: SessionEvent): number {
  const eventMs = eventCreatedAtMs(event);
  let i = events.length;
  while (i > 0 && eventCreatedAtMs(events[i - 1]) > eventMs) {
    i--;
  }
  events.splice(i, 0, event);
  return i;
}

function mergeEventUpserts(
  previousEvents: SessionEvent[],
  upserts: SessionEvent[]
): SessionEvent[] {
  if (upserts.length === 0) return previousEvents;
  const nextEvents = [...previousEvents];
  const indexById = new Map<string, number>();

  for (let index = 0; index < nextEvents.length; index++) {
    indexById.set(nextEvents[index].id, index);
  }

  for (const upsert of upserts) {
    const existingIndex = indexById.get(upsert.id);
    if (existingIndex === undefined) {
      const insertedAt = insertSorted(nextEvents, upsert);
      // `splice` invalidates downstream indices in the map; rebuild the
      // affected range so subsequent upserts find the right slot.
      indexById.set(upsert.id, insertedAt);
      for (let j = insertedAt + 1; j < nextEvents.length; j++) {
        indexById.set(nextEvents[j].id, j);
      }
    } else {
      nextEvents[existingIndex] = upsert;
    }
  }

  return trimEventWindow(nextEvents);
}

function extractSimulatorEvents(
  snapshot: Snapshot,
  previousEvents: SessionEvent[]
): SessionEvent[] {
  if (!isStreamingSnapshot(snapshot)) {
    const derived = snapshot as DerivedSnapshot;
    if (derived.sortedSimulatorEvents?.length > 0) {
      return trimEventWindow(derived.sortedSimulatorEvents);
    }
  } else {
    const streaming = snapshot as StreamingSnapshot;
    return mergeEventUpserts(
      previousEvents,
      streaming.simulatorEventUpserts ?? []
    );
  }

  const raw = snapshot.chatEvents ?? [];
  return trimEventWindow(raw.filter(isVisibleInSimulator));
}

export function useMultiSessionSimulatorEvents(
  subagentSessions: SubagentSession[]
): SessionEventsMap {
  const [eventsMap, setEventsMap] = useState<SessionEventsMap>(EMPTY_MAP);
  const loadedRef = useRef<Set<string>>(new Set());
  const mapKeysRef = useRef<Set<string>>(new Set());
  const lastEventsPerSessionRef = useRef<Map<string, SessionEvent[]>>(
    new Map()
  );

  const handleSnapshot = useCallback(
    (sessionId: string, snapshot: Snapshot) => {
      const previousEvents =
        lastEventsPerSessionRef.current.get(sessionId) ?? [];
      const events = extractSimulatorEvents(snapshot, previousEvents);
      lastEventsPerSessionRef.current.set(sessionId, events);
      mapKeysRef.current.add(sessionId);
      setEventsMap((prev) => {
        const next = new Map(prev);
        next.set(sessionId, events);
        return next;
      });
    },
    []
  );

  useEffect(() => {
    if (subagentSessions.length === 0) {
      loadedRef.current.clear();
      lastEventsPerSessionRef.current.clear();
      if (mapKeysRef.current.size > 0) {
        mapKeysRef.current.clear();
        queueMicrotask(() => setEventsMap(EMPTY_MAP));
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
            .catch((_err) => {});
        }
      }
    }

    const staleKeys: string[] = [];
    for (const key of mapKeysRef.current) {
      if (!sessionIds.has(key)) staleKeys.push(key);
    }
    if (staleKeys.length > 0) {
      for (const key of staleKeys) {
        mapKeysRef.current.delete(key);
        lastEventsPerSessionRef.current.delete(key);
      }
      queueMicrotask(() => {
        setEventsMap((prev) => {
          const next = new Map(prev);
          for (const key of staleKeys) next.delete(key);
          return next;
        });
      });
    }

    for (const sid of loadedRef.current) {
      if (!sessionIds.has(sid)) {
        loadedRef.current.delete(sid);
        lastEventsPerSessionRef.current.delete(sid);
      }
    }

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [subagentSessions, handleSnapshot]);

  if (subagentSessions.length === 0) return EMPTY_MAP;
  return eventsMap;
}
