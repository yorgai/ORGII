/**
 * useSimulatorDisplayState
 *
 * Pure derived calculations for ActivitySimulator display state.
 * All atom reads happen in ActivitySimulator itself (matching the original
 * structure) — this hook only computes derived values from those inputs.
 *
 * Derived values:
 * - displayEvent  — event fed to ActivitySimulatorGrid (thread/app filter)
 * - effectiveSelectedApp — selected dock app or follow-mode app lock
 * - dockActiveApp — highlighted icon in dock
 * - currentWorkingApp — blue-dot indicator (always follows currentEvent)
 * - layout — grid layout (auto or manual, clamped to 1x1 when thread selected)
 */
import { useMemo } from "react";

import {
  type SessionEvent,
  type SimulatorEventPreview,
  getAppTypeForSimulatorPreview,
} from "@src/engines/SessionCore";
import type { ReplayMode } from "@src/engines/SessionCore/core/types";

import { calculateAutoLayout } from "../config";
import { AppType } from "../types/appTypes";
import { getAppTypeForSessionEvent } from "../utils/eventToDockMapping";

interface UseSimulatorDisplayStateOptions {
  selectedApp: AppType | null;
  followAppLock: AppType | null;
  eventIds: string[];
  eventById: Map<string, SessionEvent>;
  previewById: Record<string, SimulatorEventPreview>;
  filteredEvents: SessionEvent[];
  currentEvent: SessionEvent | null;
  currentEventIndex: number;
  selectedTaskId: string | null;
  executionThreadCount: number;
  executionThreads: { threadId: string; eventCount: number }[];
  replayMode: ReplayMode;
  autoLayoutEnabled: boolean;
  manualLayout: ReturnType<typeof calculateAutoLayout>;
}

export interface UseSimulatorDisplayStateReturn {
  effectiveSelectedApp: AppType | null;
  displayEvent: SessionEvent | null;
  dockActiveApp: AppType | null;
  currentWorkingApp: AppType | undefined;
  layout: ReturnType<typeof calculateAutoLayout> | "1x1";
  isFollowing: boolean;
}

export function useSimulatorDisplayState({
  selectedApp,
  followAppLock,
  eventIds,
  eventById,
  previewById,
  filteredEvents,
  currentEvent,
  currentEventIndex,
  selectedTaskId,
  executionThreadCount,
  executionThreads: _executionThreads,
  replayMode,
  autoLayoutEnabled,
  manualLayout,
}: UseSimulatorDisplayStateOptions): UseSimulatorDisplayStateReturn {
  const effectiveSelectedApp = useMemo(() => {
    if (selectedApp) return selectedApp;
    // In follow mode with an app lock, treat the lock as the selected app
    // so the grid renders only that app's content.
    if (replayMode === "follow" && followAppLock) return followAppLock;
    return null;
  }, [selectedApp, followAppLock, replayMode]);

  const displayEvent = useMemo(() => {
    if (selectedTaskId && filteredEvents.length > 0) {
      if (currentEvent) {
        const isCurrentInFiltered = filteredEvents.some(
          (ev) => ev.id === currentEvent.id
        );
        if (isCurrentInFiltered) return currentEvent;
      }
      return filteredEvents[0];
    }

    if (selectedApp) {
      const searchEndIndex =
        currentEventIndex >= 0 ? currentEventIndex : eventIds.length - 1;
      for (let idx = searchEndIndex; idx >= 0; idx--) {
        const eventId = eventIds[idx];
        const appType = getAppTypeForSimulatorPreview(previewById[eventId]);
        if (appType === selectedApp) {
          return eventById.get(eventId) ?? null;
        }
      }
      return null;
    }

    return currentEvent;
  }, [
    selectedApp,
    selectedTaskId,
    filteredEvents,
    currentEvent,
    currentEventIndex,
    eventIds,
    eventById,
    previewById,
  ]);

  const dockActiveApp = useMemo((): AppType | null => {
    if (effectiveSelectedApp) return effectiveSelectedApp;
    if (currentEvent) {
      return getAppTypeForSessionEvent(currentEvent);
    }
    return null;
  }, [effectiveSelectedApp, currentEvent]);

  const currentWorkingApp = useMemo(() => {
    if (currentEvent) {
      return getAppTypeForSessionEvent(currentEvent) ?? undefined;
    }
    return undefined;
  }, [currentEvent]);

  const layout = useMemo(() => {
    if (selectedTaskId) return "1x1" as const;
    if (autoLayoutEnabled && executionThreadCount > 0) {
      return calculateAutoLayout(executionThreadCount);
    }
    return manualLayout;
  }, [autoLayoutEnabled, executionThreadCount, manualLayout, selectedTaskId]);

  const isFollowing = replayMode === "follow";

  return {
    effectiveSelectedApp,
    displayEvent,
    dockActiveApp,
    currentWorkingApp,
    layout,
    isFollowing,
  };
}
