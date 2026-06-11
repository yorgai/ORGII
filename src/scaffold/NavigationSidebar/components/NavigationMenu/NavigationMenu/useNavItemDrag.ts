import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { TabDragEventDetail } from "@src/modules/WorkStation/shared/TabBar/tabDragTypes";

import type { NavigationMenuItem } from "../config";

const DRAG_THRESHOLD_PX = 6;

export interface NavItemDragState {
  isDragging: boolean;
  dragX: number;
  dragY: number;
  dragLabel: string;
}

/**
 * Adds pointer-based drag behaviour to a navigation menu item that has a
 * `dragPayload`. On drag-end the hook fires the same `tab-drag-end` DOM
 * event that WorkStation tabs fire, so existing `useTabDragEndToPill` /
 * `useTabDragDrop` hooks on both the SessionCreator and the in-session
 * InputArea pick up the drop and insert a context pill automatically.
 *
 * Items without a `dragPayload` get no-op handlers and null drag state.
 */
export function useNavItemDrag(item: NavigationMenuItem): {
  dragHandlers: React.HTMLAttributes<HTMLElement>;
  dragState: NavItemDragState | null;
} {
  const dragStateRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    thresholdMet: boolean;
  } | null>(null);

  const [dragState, setDragState] = useState<NavItemDragState | null>(null);

  const itemRef = useRef(item);
  useLayoutEffect(() => {
    itemRef.current = item;
  });

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!itemRef.current.dragPayload) return;
      if (event.button !== 0) return;

      dragStateRef.current = {
        active: true,
        startX: event.clientX,
        startY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY,
        thresholdMet: false,
      };

      const onPointerMove = (moveEvent: PointerEvent) => {
        const state = dragStateRef.current;
        if (!state?.active) return;

        state.currentX = moveEvent.clientX;
        state.currentY = moveEvent.clientY;

        if (!state.thresholdMet) {
          const dx = moveEvent.clientX - state.startX;
          const dy = moveEvent.clientY - state.startY;
          if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD_PX) return;

          state.thresholdMet = true;
          const payload = itemRef.current.dragPayload!;
          window.__internalWorkstationTabDrag = true;
          window.__internalWorkstationTabDragData = JSON.stringify(payload);

          document.dispatchEvent(
            new CustomEvent<TabDragEventDetail>("tab-drag-start", {
              detail: {
                tabId: itemRef.current.id,
                pill: payload,
              },
            })
          );

          setDragState({
            isDragging: true,
            dragX: moveEvent.clientX,
            dragY: moveEvent.clientY,
            dragLabel: payload.name ?? payload.path,
          });
        } else {
          setDragState((prev) =>
            prev
              ? { ...prev, dragX: moveEvent.clientX, dragY: moveEvent.clientY }
              : null
          );
        }
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);

        const state = dragStateRef.current;
        dragStateRef.current = null;

        window.__internalWorkstationTabDrag = false;
        window.__internalWorkstationTabDragData = undefined;

        if (!state?.thresholdMet) {
          setDragState(null);
          return;
        }

        const payload = itemRef.current.dragPayload;
        if (payload) {
          document.dispatchEvent(
            new CustomEvent<TabDragEventDetail>("tab-drag-end", {
              detail: {
                tabId: itemRef.current.id,
                pill: payload,
                pointerX: upEvent.clientX,
                pointerY: upEvent.clientY,
              },
            })
          );
        }

        setDragState(null);
      };

      window.addEventListener("pointermove", onPointerMove, { passive: true });
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (dragStateRef.current?.thresholdMet) {
        window.__internalWorkstationTabDrag = false;
        window.__internalWorkstationTabDragData = undefined;
      }
      dragStateRef.current = null;
    };
  }, []);

  if (!item.dragPayload) {
    return { dragHandlers: {}, dragState: null };
  }

  return {
    dragHandlers: {
      onPointerDown: handlePointerDown,
    },
    dragState,
  };
}
