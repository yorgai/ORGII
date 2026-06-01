/**
 * useStickyMount Hook
 *
 * Mount-once pattern: once the consumer becomes active for the first time,
 * the hook returns true forever, so the owning component stays mounted and
 * its state (WebSocket connections, scroll positions, component state)
 * survives subsequent visibility toggles.
 *
 * Uses React's "adjust state during render" pattern to avoid refs during
 * render and setState in effects.
 * See: https://react.dev/reference/react/useState#storing-information-from-previous-renders
 *
 * @param isActive - Whether the consumer is currently active (visible).
 * @returns shouldRender - Whether the consumer should be mounted.
 */
import { useState } from "react";

export function useStickyMount(isActive: boolean): boolean {
  const [hasEverBeenActive, setHasEverBeenActive] = useState(isActive);
  if (isActive && !hasEverBeenActive) {
    setHasEverBeenActive(true);
  }
  return hasEverBeenActive;
}
