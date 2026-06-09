/**
 * useContextPanel
 *
 * Manages the open/close state and absolute position of the
 * ContextInfoButton floating panel.
 *
 * Responsibilities:
 * - Computes panel position relative to the trigger button rect.
 * - Repositions on window resize while the panel is open.
 * - Closes on outside click or Escape key.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  PANEL_GAP,
  PANEL_WIDTH,
  type PanelPosition,
  RING_SIZE,
  VIEWPORT_PADDING,
} from "./contextInfoTypes";

export interface UseContextPanelReturn {
  panelPos: PanelPosition | null;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  toggle: () => void;
  close: () => void;
}

export function useContextPanel(): UseContextPanelReturn {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<PanelPosition | null>(null);

  const computePos = useCallback((): PanelPosition | null => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return null;

    const idealRight =
      window.innerWidth - rect.right - PANEL_WIDTH / 2 + RING_SIZE / 2;
    const right = Math.max(
      VIEWPORT_PADDING,
      Math.min(idealRight, window.innerWidth - PANEL_WIDTH - VIEWPORT_PADDING)
    );

    return {
      bottom: window.innerHeight - rect.top + PANEL_GAP,
      right,
    };
  }, []);

  const toggle = useCallback(() => {
    setPanelPos((prev) => (prev ? null : computePos()));
  }, [computePos]);

  const close = useCallback(() => {
    setPanelPos(null);
  }, []);

  useEffect(() => {
    if (!panelPos) return;
    function handleResize() {
      setPanelPos(computePos());
    }
    window.addEventListener("resize", handleResize, { passive: true });
    return () => window.removeEventListener("resize", handleResize);
  }, [panelPos, computePos]);

  useEffect(() => {
    if (!panelPos) return;
    function handleDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setPanelPos(null);
      }
    }
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [panelPos]);

  useEffect(() => {
    if (!panelPos) return;
    function handleKey(evt: KeyboardEvent) {
      if (evt.key === "Escape") {
        setPanelPos(null);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [panelPos]);

  return { panelPos, triggerRef, panelRef, toggle, close };
}
