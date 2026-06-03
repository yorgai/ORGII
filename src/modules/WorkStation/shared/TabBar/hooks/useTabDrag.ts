/**
 * useTabDrag Hook
 *
 * Handles all drag-and-drop logic for tabs including:
 * - Drag start/end events
 * - Insertion indicator positioning
 * - Tab reordering within a single pane
 */
import type {
  DragEndEvent,
  DragMoveEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TAB_BAR_HEIGHT } from "../config";
import type { WorkStationTab } from "../types";

/**
 * Drop line height; centered in the actual tab bar strip (the `.work-station-tab-bar`
 * row), not the full pane column — same vertical math as 32px pills in a 40px bar.
 */
const INSERTION_INDICATOR_HEIGHT = TAB_BAR_HEIGHT - 8;

// ============================================
// Types
// ============================================

export interface UseTabDragOptions {
  /** Current pane ID */
  paneId: string;
  /** List of tabs */
  tabs: WorkStationTab[];
  /** Callback when tabs are reordered */
  onTabReorder?: (startIndex: number, endIndex: number) => void;
}

export interface UseTabDragReturn {
  /** Currently dragging tab ID */
  draggingTabId: string | null;
  /** Currently dragging tab object */
  draggingTab: WorkStationTab | null;
  /** Handle drag start event */
  handleDragStart: (event: DragStartEvent) => void;
  /** Handle drag move event (no-op, tracking via pointermove) */
  handleDragMove: (event: DragMoveEvent) => void;
  /** Handle drag end event */
  handleDragEnd: (event: DragEndEvent) => void;
  /** Handle drag cancel event */
  handleDragCancel: () => void;
}

// ============================================
// Hook Implementation
// ============================================

export function useTabDrag({
  paneId,
  tabs,
  onTabReorder,
}: UseTabDragOptions): UseTabDragReturn {
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);

  const lastPointerPositionRef = useRef<{ x: number; y: number } | null>(null);

  const draggingTab = useMemo(
    () =>
      draggingTabId
        ? (tabs.find((tab) => tab.id === draggingTabId) ?? null)
        : null,
    [draggingTabId, tabs]
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const tabId = event.active.id as string;
      setDraggingTabId(tabId);

      const foundTab = tabs.find((tab) => tab.id === tabId);

      const filePath =
        foundTab?.type === "file" || foundTab?.type === "git-diff"
          ? (foundTab.data.filePath as string | undefined)
          : foundTab?.type === "directory"
            ? (foundTab.data.directoryPath as string | undefined)
            : undefined;

      if (filePath && foundTab) {
        window.__internalWorkstationTabDrag = true;
        window.__internalWorkstationTabDragData = JSON.stringify({
          path: filePath,
          name: foundTab.title,
          type: foundTab.type === "directory" ? "directory" : "file",
        });
      }

      document.dispatchEvent(
        new CustomEvent("tab-drag-start", {
          detail: { tabId, filePath },
        })
      );
    },
    [tabs]
  );

  // Track pointer position during drag move, and show insertion indicator
  useEffect(() => {
    if (!draggingTabId) {
      document.querySelectorAll(".drop-target-highlight").forEach((el) => {
        el.classList.remove("drop-target-highlight");
      });
      document.querySelector(".tab-insertion-indicator")?.remove();
      return;
    }

    let indicator = document.querySelector(
      ".tab-insertion-indicator"
    ) as HTMLDivElement | null;
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.className = "tab-insertion-indicator";
      indicator.style.cssText = `
        position: fixed;
        left: 0;
        top: 0;
        width: 2px;
        height: ${INSERTION_INDICATOR_HEIGHT}px;
        background: var(--color-primary-6);
        border-radius: 1px;
        z-index: 10000;
        pointer-events: none;
        display: none;
        box-shadow: 0 0 4px color-mix(in srgb, var(--color-primary-6) 50%, transparent);
        will-change: transform;
        contain: layout style;
      `;
      document.body.appendChild(indicator);
    }

    const allPanes = Array.from(
      document.querySelectorAll("[data-pane-id]")
    ) as HTMLElement[];

    const currentPane = allPanes.find((pane) => pane.dataset.paneId === paneId);

    let lastIndicatorX = -1;
    let rafId: number | null = null;
    let lastX = 0;
    let lastY = 0;

    const updateIndicator = () => {
      rafId = null;
      if (!indicator) return;

      // Re-read layout on every frame so stale cached bounds don't cause
      // wrong indicator positions after the tab strip has scrolled or the
      // panel has been resized since drag-start.
      let currentPaneBounds: DOMRect | null = null;
      let currentTabBarBounds: DOMRect | null = null;
      let currentPaneTabBounds: Array<{
        left: number;
        right: number;
        midpoint: number;
        id: string;
      }> = [];
      if (currentPane) {
        currentPaneBounds = currentPane.getBoundingClientRect();
        const currentTabBar = currentPane.querySelector(
          ".work-station-tab-bar"
        );
        currentTabBarBounds = currentTabBar
          ? currentTabBar.getBoundingClientRect()
          : null;
        const currentTabs = currentPane.querySelectorAll("[data-tab-id]");
        currentPaneTabBounds = Array.from(currentTabs).map((tab) => {
          const tabEl = tab as HTMLElement;
          const rect = tabEl.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            midpoint: rect.left + rect.width / 2,
            id: tabEl.dataset.tabId || "",
          };
        });
      }

      const overCurrent =
        currentPaneBounds &&
        lastX >= currentPaneBounds.left &&
        lastX <= currentPaneBounds.right &&
        lastY >= currentPaneBounds.top &&
        lastY <= currentPaneBounds.bottom;

      if (!overCurrent) {
        indicator.style.display = "none";
        return;
      }

      let indicatorX = 0;
      const tabBounds = currentPaneTabBounds;
      const paneBounds = currentPaneBounds;
      if (!paneBounds) return;

      const tabStripBounds = currentTabBarBounds;
      const top = tabStripBounds?.top ?? paneBounds.top;
      const stripH = tabStripBounds?.height ?? TAB_BAR_HEIGHT;
      const lineH = Math.min(
        INSERTION_INDICATOR_HEIGHT,
        Math.max(1, stripH - 2)
      );
      const indicatorY = top + (stripH - lineH) / 2;
      if (indicator) {
        indicator.style.height = `${lineH}px`;
      }

      if (tabBounds.length > 0) {
        let foundPosition = false;

        for (let tabIdx = 0; tabIdx < tabBounds.length; tabIdx++) {
          const tabBound = tabBounds[tabIdx];
          if (tabBound.id === draggingTabId) {
            continue;
          }
          if (lastX < tabBound.midpoint) {
            indicatorX = tabBound.left - 1;
            foundPosition = true;
            break;
          }
        }

        if (!foundPosition) {
          const lastTab = tabBounds[tabBounds.length - 1];
          if (lastTab) {
            indicatorX = lastTab.right - 1;
          }
        }
      } else {
        indicatorX = paneBounds.left + 8;
      }

      if (Math.abs(indicatorX - lastIndicatorX) > 1) {
        lastIndicatorX = indicatorX;
        indicator.style.transform = `translate3d(${indicatorX}px, ${indicatorY}px, 0)`;
        indicator.style.display = "block";
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      lastX = event.clientX;
      lastY = event.clientY;
      lastPointerPositionRef.current = { x: lastX, y: lastY };

      if (rafId === null) {
        rafId = requestAnimationFrame(updateIndicator);
      }
    };

    document.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });

    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      indicator?.remove();
    };
  }, [draggingTabId, paneId]);

  const handleDragMove = useCallback((_event: DragMoveEvent) => {
    // Position tracking handled by pointermove listener above
  }, []);

  const clearTabDragGlobals = useCallback(() => {
    window.__internalWorkstationTabDrag = false;
    window.__internalWorkstationTabDragData = undefined;
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const tabId = active.id as string;

      const foundTab = tabs.find((tab) => tab.id === tabId);
      const filePath =
        foundTab?.type === "file" || foundTab?.type === "git-diff"
          ? (foundTab.data.filePath as string | undefined)
          : foundTab?.type === "directory"
            ? (foundTab.data.directoryPath as string | undefined)
            : undefined;

      setDraggingTabId(null);
      clearTabDragGlobals();

      document.dispatchEvent(
        new CustomEvent("tab-drag-end", {
          detail: {
            tabId,
            filePath,
            name: foundTab?.title,
            type: foundTab?.type === "directory" ? "directory" : "file",
            pointerX: lastPointerPositionRef.current?.x,
            pointerY: lastPointerPositionRef.current?.y,
          },
        })
      );

      lastPointerPositionRef.current = null;

      if (over && active.id !== over.id && onTabReorder) {
        const oldIndex = tabs.findIndex((tab) => tab.id === active.id);
        const newIndex = tabs.findIndex((tab) => tab.id === over.id);

        if (oldIndex !== -1 && newIndex !== -1) {
          onTabReorder(oldIndex, newIndex);
        }
      }
    },
    [tabs, onTabReorder, clearTabDragGlobals]
  );

  const handleDragCancel = useCallback(() => {
    setDraggingTabId(null);
    clearTabDragGlobals();
    lastPointerPositionRef.current = null;
  }, [clearTabDragGlobals]);

  return {
    draggingTabId,
    draggingTab,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
  };
}

export default useTabDrag;
