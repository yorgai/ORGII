/**
 * useAutoScrollToActive Hook
 *
 * Scrolls the tab strip so the active tab is at the left edge whenever
 * the tab changes or whenever a scroll-reveal is explicitly requested.
 *
 * Two trigger paths:
 * 1. `activeTabId` changes (new tab opened, keyboard nav, etc.)
 * 2. `scrollReveal` version increments (file-tree re-click of an already-active
 *    tab, where `activeTabId` stays the same) — the effect fires because
 *    the version number changed, regardless of the tabId.
 *
 * Behaviour: if the tab is already fully visible → no-op.
 * Otherwise → scroll so the tab sits at the LEFT edge of the strip.
 */
import { type RefObject, useEffect, useRef } from "react";

export interface UseAutoScrollToActiveOptions {
  /** Currently active tab ID */
  activeTabId: string | null;
  /** Number of tabs (used to detect tab list changes) */
  tabsLength: number;
  /** Ref to the scrollable container */
  containerRef: RefObject<HTMLDivElement | null>;
  /**
   * Explicit scroll-reveal request. The `version` field must increment on
   * every request, even when `tabId` is the same as the current active tab.
   * Produced by `requestTabScrollRevealAtom`.
   */
  scrollReveal?: { tabId: string; version: number };
}

function scrollTabIdIntoView(container: HTMLDivElement, tabId: string): void {
  if (!tabId || typeof tabId !== "string") return;
  if (tabId.includes("=>") || tabId.includes("function")) return;

  const el = container.querySelector<HTMLElement>(
    `[data-tab-id="${CSS.escape(tabId)}"]`
  );
  if (!el) return;

  const tabLeft = el.offsetLeft;
  const tabRight = tabLeft + el.offsetWidth;
  const visibleLeft = container.scrollLeft + 8;
  const visibleRight = container.scrollLeft + container.clientWidth - 8;

  if (tabLeft < visibleLeft || tabRight > visibleRight) {
    container.scrollLeft = Math.max(0, tabLeft - 8);
  }
}

export function useAutoScrollToActive({
  activeTabId,
  tabsLength: _tabsLength,
  containerRef,
  scrollReveal,
}: UseAutoScrollToActiveOptions): void {
  const frameIdRef = useRef<number | null>(null);

  // Path 1: activeTabId changes (new tab opened, keyboard nav, etc.)
  useEffect(() => {
    if (
      !activeTabId ||
      typeof activeTabId !== "string" ||
      activeTabId.includes("=>")
    ) {
      return;
    }

    if (frameIdRef.current !== null) cancelAnimationFrame(frameIdRef.current);
    frameIdRef.current = requestAnimationFrame(() => {
      frameIdRef.current = null;
      const container = containerRef.current;
      if (container) scrollTabIdIntoView(container, activeTabId);
    });

    return () => {
      if (frameIdRef.current !== null) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
      }
    };
  }, [activeTabId, containerRef]);

  // Path 2: explicit scroll-reveal request (e.g. file-tree re-click of the
  // already-active tab). The version always increments so this effect fires
  // even when tabId hasn't changed.
  useEffect(() => {
    if (!scrollReveal?.tabId || scrollReveal.version === 0) return;

    if (frameIdRef.current !== null) cancelAnimationFrame(frameIdRef.current);
    frameIdRef.current = requestAnimationFrame(() => {
      frameIdRef.current = null;
      const container = containerRef.current;
      if (container) scrollTabIdIntoView(container, scrollReveal.tabId);
    });

    return () => {
      if (frameIdRef.current !== null) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
      }
    };
  }, [scrollReveal?.tabId, scrollReveal?.version, containerRef]);
}

export default useAutoScrollToActive;
