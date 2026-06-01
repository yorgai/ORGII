/**
 * useSimulatorContent Hook
 *
 * Manages content rendering logic for the simulator, including:
 * - Event rendering
 * - Activity/artifact rendering
 * - Content caching to prevent flashing
 * - App type resolution for embedded Workstation
 */
import { useAtomValue } from "jotai";
import { type ReactNode, useMemo } from "react";

import {
  type SessionEvent,
  type SessionSpec,
  getAppTypeForSimulatorPreview,
  simulatorEventPreviewByIdAtom,
  sortedSimulatorEventIdsAtom,
} from "@src/engines/SessionCore";
import {
  hasSimulatorApp,
  useSimulatorAppRenderer,
} from "@src/modules/WorkStation/shared/simulatorRegistry";

import type { AppType } from "../../types/appTypes";
import { getAppTypeForSessionEvent } from "../../utils/eventToDockMapping";

interface UseSimulatorContentOptions {
  currentEvent: SessionEvent | null;
  events: SessionEvent[];
  specs: SessionSpec[];
  forceAppType?: AppType | null;
}

interface UseSimulatorContentReturn {
  mainContentAppType: AppType | null;
  isBootingEvent: boolean;
  displayContent: ReactNode;
}

export function useSimulatorContent({
  currentEvent,
  events: _events,
  specs: _specs,
  forceAppType,
}: UseSimulatorContentOptions): UseSimulatorContentReturn {
  const { renderApp } = useSimulatorAppRenderer();
  const sortedSimulatorEventIds = useAtomValue(sortedSimulatorEventIdsAtom);
  const previewById = useAtomValue(simulatorEventPreviewByIdAtom);

  const isBootingEvent = currentEvent?.functionName === "booting_system";

  const resolvedAppType = useMemo(() => {
    if (forceAppType) return forceAppType;
    if (currentEvent) {
      const mapped = getAppTypeForSessionEvent(currentEvent);
      if (mapped !== null) return mapped;
    }
    // Backward search: find the last event with a known app type.
    // Also serves as the "sticky" fallback when currentEvent has no
    // mapping — prevents the pane from flashing blank between events.
    for (let idx = sortedSimulatorEventIds.length - 1; idx >= 0; idx--) {
      const appType = getAppTypeForSimulatorPreview(
        previewById[sortedSimulatorEventIds[idx]]
      );
      if (appType !== null && hasSimulatorApp(appType)) return appType;
    }
    return null;
  }, [forceAppType, currentEvent, sortedSimulatorEventIds, previewById]);

  const retainedAppTypes = useMemo(() => {
    if (resolvedAppType === null || !hasSimulatorApp(resolvedAppType)) {
      return [];
    }
    return [resolvedAppType];
  }, [resolvedAppType]);

  const displayContent = useMemo(() => {
    if (retainedAppTypes.length === 0) return null;

    return (
      <div className="relative h-full w-full overflow-hidden">
        {retainedAppTypes.map((appType) => {
          const isActive = appType === resolvedAppType;
          return (
            <div
              key={appType}
              className={`absolute inset-0 ${
                isActive
                  ? "pointer-events-auto visible"
                  : "pointer-events-none invisible"
              }`}
            >
              {renderApp(appType, {
                currentEvent,
                mode: "simulation",
                isActive,
              })}
            </div>
          );
        })}
      </div>
    );
  }, [currentEvent, resolvedAppType, renderApp, retainedAppTypes]);

  return {
    mainContentAppType: resolvedAppType,
    isBootingEvent,
    displayContent,
  };
}
