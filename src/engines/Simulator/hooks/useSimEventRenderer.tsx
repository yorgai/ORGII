/**
 * useSimEventRenderer Hook
 *
 * Event renderer using unified adapter system.
 * Provides simulator-specific functionality like artifact rendering and event indexing.
 *
 * Now uses useSimulatorAdapter internally for consistent event rendering
 * across all contexts (chat, simulator).
 *
 * Performance & Safety:
 * - Error boundaries around lazy-loaded components
 * - Graceful fallback for failed components
 * - Memoized render functions
 * - O(1) event/spec lookups using index maps (critical for 1000+ events)
 *
 * Data Format Support:
 * - Direct BackendEvent format
 * - Nested activityData on wire payloads (optional nested tool fields)
 * - ActivityChunk format (from WebSocket)
 */
import React, { useCallback, useEffect } from "react";

import type {
  SessionEvent,
  SessionSpec,
} from "@src/engines/SessionCore/core/types";
import { prefetchCommonComponents } from "@src/engines/SessionCore/rendering/registry";
import { useSimulatorAdapter } from "@src/engines/Simulator/adapters/SimulatorAdapter";

import {
  EventIndex,
  SpecIndex,
  useEventIndex,
  useSpecIndex,
} from "./useEventIndex";

// ============================================
// Types
// ============================================

export interface UseSimEventRendererOptions {
  events: SessionEvent[];
  specs: SessionSpec[];
}

export interface UseSimEventRendererReturn {
  renderEvent: (param: { event: SessionEvent }) => React.ReactNode;
  /** Event index for O(1) lookups - exposed for external use */
  eventIndex: EventIndex;
  /** Spec index for O(1) lookups - exposed for external use */
  specIndex: SpecIndex;
}

// ============================================
// Hook Implementation
// ============================================

export const useSimEventRenderer = (
  options: UseSimEventRendererOptions
): UseSimEventRendererReturn => {
  const { events, specs } = options;

  // Use the unified simulator adapter
  const { renderEvent: adapterRenderEvent } = useSimulatorAdapter();

  // Create O(1) lookup indexes - critical for large sessions
  const eventIndex = useEventIndex(events);
  const specIndex = useSpecIndex(specs);

  // Prefetch common components on first render
  useEffect(() => {
    prefetchCommonComponents();
  }, []);

  /**
   * Render a single event using the unified adapter - NO CONVERSION NEEDED!
   * Events are already SessionEvent from the store
   */
  const renderEvent = useCallback(
    (param: { event: SessionEvent }): React.ReactNode => {
      return adapterRenderEvent({ event: param.event });
    },
    [adapterRenderEvent]
  );

  return { renderEvent, eventIndex, specIndex };
};

export default useSimEventRenderer;
