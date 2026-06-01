/**
 * useChatEventReplay Hook
 *
 * Hook for replaying chat events in the simulator.
 * Uses session store atoms for cross-provider communication.
 *
 * NOTE: This hook does NOT switch simulator tabs - tabs are independent.
 * User manually controls which tab they're viewing.
 */
import dayjs from "dayjs";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";

import { REPLAY_CONFIG } from "@src/config/workspace/replayConfig";
import {
  currentEventIdAtom,
  eventIndexAtom,
  eventSecondaryLookupAtom,
  replayBarValueAtom,
  replayModeAtom,
  replayTimeRangeAtom,
  sortedEventsAtom,
} from "@src/engines/SessionCore/core/atoms";
import {
  getPlanEventAliases,
  isPlanDisplayEvent,
  planAliasesContain,
} from "@src/engines/SessionCore/derived/planDisplayEvents";
import {
  simulatorFollowAppLockAtom,
  simulatorSelectedAppAtom,
  stationModeAtom,
} from "@src/store/ui/simulatorAtom";

export interface UseChatEventReplayReturn {
  /**
   * Locate and replay an event in the simulator by its event_id
   * @param eventId - The event_id (same as chunk_id from activity)
   */
  replayEventById: (eventId: string) => void;

  /**
   * Check if replay is available (has events loaded)
   */
  canReplay: boolean;
}

/**
 * Hook to replay chat events in the simulator.
 * Uses session store atoms directly - no legacy type conversions.
 *
 * IMPORTANT: Uses sortedEventsAtom (all events, pre-sorted) for lookup,
 * not chatEventsAtom, because some events (like submit_output) may be
 * filtered from chat but still need to be navigable in the simulator.
 */
export function useChatEventReplay(): UseChatEventReplayReturn {
  const sortedEvents = useAtomValue(sortedEventsAtom);
  const eventIndex = useAtomValue(eventIndexAtom);
  const eventSecondaryLookup = useAtomValue(eventSecondaryLookupAtom);
  const timeRange = useAtomValue(replayTimeRangeAtom);
  const setCurrentEventId = useSetAtom(currentEventIdAtom);
  const setReplayBarValue = useSetAtom(replayBarValueAtom);
  const setReplayTimeRange = useSetAtom(replayTimeRangeAtom);
  const setReplayMode = useSetAtom(replayModeAtom);
  const setSelectedApp = useSetAtom(simulatorSelectedAppAtom);
  const setFollowAppLock = useSetAtom(simulatorFollowAppLockAtom);
  const setStationMode = useSetAtom(stationModeAtom);

  const canReplay = sortedEvents.length > 0;

  const replayEventById = useCallback(
    (eventId: string) => {
      if (!eventId) {
        console.warn("[ChatEventReplay] No event_id provided");
        return;
      }

      // Extract original ID if prefixed (e.g., "group:stageoutput:intake:uuid")
      let lookupId = eventId;
      if (eventId.startsWith("group:stageoutput:")) {
        const parts = eventId.split(":");
        if (parts.length >= 4) {
          lookupId = parts.slice(3).join(":");
        }
      }

      let event = eventIndex.get(lookupId);
      if (!event) {
        const secondaryEventId =
          eventSecondaryLookup.chunkIdToEventId.get(lookupId) ??
          eventSecondaryLookup.callIdToEventId.get(lookupId);
        event = secondaryEventId ? eventIndex.get(secondaryEventId) : undefined;
      }
      event ??= sortedEvents.find((candidate) => {
        if (!isPlanDisplayEvent(candidate)) return false;
        return planAliasesContain(getPlanEventAliases(candidate), lookupId);
      });

      if (!event) {
        console.warn(
          `[ChatEventReplay] Event not found: ${lookupId}`,
          eventId !== lookupId ? `(extracted from: ${eventId})` : "",
          `| total events: ${sortedEvents.length}`
        );
        return;
      }
      const resolvedEventId = event.id;

      setStationMode("agent-station");

      // Set event first — this is the primary navigation action.
      // Order matters: replayMode must be "replay" before currentEventId
      // so appendEventsAtom (which checks mode) doesn't auto-follow.
      setReplayMode("replay");
      setCurrentEventId(resolvedEventId);

      // Clear user-forced app filters so locating a chat event follows the
      // clicked event across apps instead of staying restricted to a prior
      // dock selection or "This app" replay scope.
      //
      // The dock derives the active app from `currentEvent.functionName`
      // when `selectedApp` is null; user turns (`functionName === "user_message"`)
      // fall back to `AppType.CHANNELS` inside `useSimulatorContent` via
      // `event.source === "user"`.
      if (process.env.NODE_ENV === "development" && event.functionName) {
        // eslint-disable-next-line no-console
        console.debug(
          `[ChatEventReplay] Event ${lookupId}: ${event.functionName} → follow dock`
        );
      }

      setSelectedApp(null);
      setFollowAppLock(null);

      // Compute bar position from the existing time range when valid,
      // otherwise derive it from sortedEvents (already O(1) sorted).
      const firstEvent = sortedEvents[0];
      const lastEvent = sortedEvents[sortedEvents.length - 1];
      if (!firstEvent || !lastEvent) return;

      let startTime = timeRange.start;
      let endTime = timeRange.end;
      const rangeValid = startTime && endTime && startTime !== endTime;

      if (!rangeValid) {
        startTime = firstEvent.createdAt;
        endTime = lastEvent.createdAt;
        if (startTime === endTime) {
          endTime = dayjs(endTime).add(1, "minute").toISOString();
        }
        setReplayTimeRange({ start: startTime, end: endTime });
      }

      const startMs = dayjs(startTime).valueOf();
      const endMs = dayjs(endTime).valueOf();
      const timeRangeMs = endMs - startMs;

      if (timeRangeMs > 0) {
        const eventMs = dayjs(event.createdAt).valueOf();
        const barValue =
          ((eventMs - startMs) / timeRangeMs) * REPLAY_CONFIG.MAX_VALUE;
        setReplayBarValue(
          Math.max(0, Math.min(REPLAY_CONFIG.MAX_VALUE, barValue))
        );
      }
    },
    [
      sortedEvents,
      eventIndex,
      eventSecondaryLookup,
      timeRange,
      setCurrentEventId,
      setReplayBarValue,
      setReplayTimeRange,
      setReplayMode,
      setSelectedApp,
      setFollowAppLock,
      setStationMode,
    ]
  );

  return {
    replayEventById,
    canReplay,
  };
}
