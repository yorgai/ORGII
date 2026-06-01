/**
 * Hook to bridge Rust EventStore → Jotai atoms.
 *
 * Mount this ONCE at the app root (or session workspace root).
 * It initializes the EventStoreProxy's Tauri event listener and
 * subscribes to snapshot pushes from Rust, updating the Jotai atoms.
 *
 * Only snapshots whose `sessionId` matches the current active session
 * are forwarded to Jotai atoms — child session snapshots (e.g. subagent
 * nested events) are routed to per-session subscribers instead.
 *
 * Snapshot merging:
 * Rust pushes a lightweight StreamingSnapshot during active streaming (no
 * `events` / `sortedSimulatorEvents` to reduce serialization cost). When we
 * receive one we merge it on top of the previous DerivedSnapshot so that the
 * Simulator always has the full event list while chat gets the latest updates.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";

import { derivedSnapshotAtom, eventStoreVersionAtom } from "../atoms/events";
import { sessionIdAtom } from "../atoms/metadata";
import type { SessionEvent } from "../types";
import {
  type DerivedSnapshot,
  type Snapshot,
  eventStoreProxy,
  isStreamingSnapshot,
} from "./EventStoreProxy";

function applyEventUpserts(
  previousEvents: SessionEvent[],
  previousEventIndex: Record<string, number>,
  upserts: SessionEvent[]
): SessionEvent[] {
  if (upserts.length === 0) return previousEvents;
  let nextEvents: SessionEvent[] | null = null;

  for (const upsert of upserts) {
    const existingIndex = previousEventIndex[upsert.id];
    if (existingIndex !== undefined) {
      if (previousEvents[existingIndex] !== upsert) {
        nextEvents ??= [...previousEvents];
        nextEvents[existingIndex] = upsert;
      }
    } else {
      nextEvents ??= [...previousEvents];
      nextEvents.push(upsert);
    }
  }

  return nextEvents ?? previousEvents;
}

function buildEventIndex(events: SessionEvent[]): Record<string, number> {
  const eventIndex: Record<string, number> = {};
  for (let index = 0; index < events.length; index++) {
    eventIndex[events[index].id] = index;
  }
  return eventIndex;
}

function eventsForIds(
  events: SessionEvent[],
  eventIndex: Record<string, number>,
  ids: string[]
): SessionEvent[] {
  return ids
    .map((id) => {
      const index = eventIndex[id];
      return index === undefined ? undefined : events[index];
    })
    .filter((event): event is SessionEvent => Boolean(event));
}

export function useEventStoreBridge(): void {
  const setSnapshot = useSetAtom(derivedSnapshotAtom);
  const setVersion = useSetAtom(eventStoreVersionAtom);
  const activeSessionId = useAtomValue(sessionIdAtom);
  const activeSessionIdRef = useRef(activeSessionId);
  const lastDerivedRef = useRef<DerivedSnapshot | null>(null);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
    // Clear the cached derived snapshot when the session changes so stale
    // events from the previous session don't bleed into the new one.
    lastDerivedRef.current = null;

    // Proactively apply any cached snapshot for the incoming session.
    // Closes the race where Rust pushes `es:changed` for the new session
    // before `sessionIdAtom` updates — the subscribe callback would drop
    // that snapshot because the ref still held the old ID. Applying the
    // cached copy here recovers the lost frame.
    if (activeSessionId) {
      const cached = eventStoreProxy.getLatestSessionSnapshot(activeSessionId);
      if (cached) {
        if (!isStreamingSnapshot(cached)) {
          lastDerivedRef.current = cached as DerivedSnapshot;
        }
        setSnapshot(cached);
        setVersion(cached.version);
      }
    }
  }, [activeSessionId, setSnapshot, setVersion]);

  useEffect(() => {
    let destroyed = false;
    let unsubscribe: (() => void) | null = null;

    eventStoreProxy.init().then(() => {
      // Guard against fast unmount: if the cleanup already ran before the
      // promise resolved, skip adding the listener so it is never orphaned
      // in _globalListeners holding stale setter closures.
      if (destroyed) return;

      unsubscribe = eventStoreProxy.subscribe(
        (snapshot: Snapshot, sessionId: string) => {
          if (
            activeSessionIdRef.current &&
            sessionId !== activeSessionIdRef.current
          ) {
            return;
          }

          if (isStreamingSnapshot(snapshot)) {
            // StreamingSnapshot omits the full `events` array and `eventIndex`
            // for perf. Merge bounded simulator upserts onto the last
            // DerivedSnapshot so active simulator windows can hydrate live events.
            //
            // IMPORTANT: the merged object keeps `streaming: true` so that
            // chatEventsAtom's stability optimisation (allArgsStable) is
            // bypassed. Without this flag, changes to args.streamContent
            // (tool-call argument streaming — e.g. create_plan content) are
            // invisible to the stability check and the plan card never updates
            // mid-stream, showing "(plan is empty)" until the turn completes.
            const prev = lastDerivedRef.current;
            if (prev) {
              const events = applyEventUpserts(
                prev.events,
                prev.eventIndex,
                snapshot.simulatorEventUpserts ?? []
              );
              const eventIndex =
                events === prev.events
                  ? prev.eventIndex
                  : buildEventIndex(events);
              const sortedSimulatorEvents =
                snapshot.sortedSimulatorEventIds &&
                snapshot.sortedSimulatorEventIds.length > 0
                  ? eventsForIds(
                      events,
                      eventIndex,
                      snapshot.sortedSimulatorEventIds
                    )
                  : prev.sortedSimulatorEvents;
              const merged: DerivedSnapshot & { streaming: true } = {
                ...prev,
                version: snapshot.version,
                eventCount: snapshot.eventCount,
                events,
                eventIndex,
                chatEvents: snapshot.chatEvents,
                sortedSimulatorEvents,
                lastEvent: snapshot.lastEvent,
                hasRunningEvent: snapshot.hasRunningEvent,
                sortedSimulatorEventIds: snapshot.sortedSimulatorEventIds,
                eventPreviewById: snapshot.eventPreviewById,
                createdAtById: snapshot.createdAtById,
                threadIdById: snapshot.threadIdById,
                functionNameById: snapshot.functionNameById,
                displayStatusById: snapshot.displayStatusById,
                displayVariantById: snapshot.displayVariantById,
                streaming: true,
              };
              lastDerivedRef.current = merged;
              setSnapshot(merged);
              setVersion(merged.version);
              return;
            }
            // No prior DerivedSnapshot yet — fall through and store as-is.
            // Events will appear once the first DerivedSnapshot arrives.
          } else {
            lastDerivedRef.current = snapshot as DerivedSnapshot;
          }

          setSnapshot(snapshot);
          setVersion(snapshot.version);
        }
      );
    });

    return () => {
      destroyed = true;
      unsubscribe?.();
      // Tear down the Tauri IPC listener so it is not orphaned when the
      // component unmounts before init() resolves (e.g. StrictMode double-mount,
      // fast navigation, HMR). Without this call _unlistenTauri stays alive
      // but _globalListeners is empty, and a subsequent init() call silently
      // returns early because _initialized is still true — making the bridge
      // permanently deaf to es:changed events in that lifecycle.
      eventStoreProxy.destroy();
    };
  }, [setSnapshot, setVersion]);
}
