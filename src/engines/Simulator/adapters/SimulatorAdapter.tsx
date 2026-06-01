/**
 * Simulator Adapter
 *
 * Thin wrapper around useUnifiedEventRenderer for Simulated Activities.
 * Provides backward-compatible interface with useSimEventRenderer.
 *
 * Usage:
 * ```tsx
 * const { renderEvent } = useSimulatorAdapter();
 * return renderEvent({ event });
 * ```
 */
import { type ReactNode, useCallback, useMemo } from "react";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { useUnifiedEventRenderer } from "@src/engines/SessionCore/rendering/hooks";

// ============================================
// Types
// ============================================

export interface SimulatorAdapterOptions {
  // Reserved for future options
}

export interface SimulatorAdapterResult {
  /** Render a single event */
  renderEvent: (param: { event: SessionEvent }) => ReactNode;
}

// ============================================
// Hook Implementation
// ============================================

/**
 * Simulator adapter for unified event rendering
 * Drop-in replacement for useSimEventRenderer
 */
export function useSimulatorAdapter(
  _options: SimulatorAdapterOptions = {}
): SimulatorAdapterResult {
  const { renderEvent: baseRenderEvent } = useUnifiedEventRenderer({
    context: "simulator",
    mode: "simulation",
  });

  /**
   * Render a single event (simulator format)
   */
  const renderEvent = useCallback(
    (param: { event: SessionEvent }): ReactNode => {
      const { event } = param;

      // Skip meta events
      if (event.actionType === "system" || event.actionType === "status") {
        return null;
      }

      // Render using unified renderer
      const result = baseRenderEvent(event, {
        mode: "simulation",
      });
      return result;
    },
    [baseRenderEvent]
  );

  return useMemo(
    () => ({
      renderEvent,
    }),
    [renderEvent]
  );
}

export default useSimulatorAdapter;
