import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import type { GroupedVirtuosoHandle } from "react-virtuoso";

export interface UseChatScrollPinOptions {
  activeId: string | null;
  groupCounts: number[];
  totalFlatItems: number;
  footerSpacerHeight: number;
  sessionLoadStatus: string;
  virtuosoRef: RefObject<GroupedVirtuosoHandle>;
  virtuosoScrollerRef: RefObject<HTMLElement | null>;
  atBottom: boolean;
  isPendingCancelRef: MutableRefObject<boolean>;
  isContentOverflowingRef: MutableRefObject<boolean>;
  optimizedChatHistoryLength: number;
  /**
   * Shared ref owned by the parent. Both useChatScroll and useChatScrollPin
   * read/write this ref so they coordinate pin intent without re-renders.
   */
  pinLastGroupRef: MutableRefObject<boolean>;
  onPinToTopChange?: (active: boolean) => void;
  /**
   * Fallback scroll container for the static rendering path (≤12 items,
   * no Virtuoso). When virtuosoRef.current is null, scrollToEnd falls back
   * to scrolling this element to its bottom instead of silently failing.
   */
  staticScrollerRef?: MutableRefObject<HTMLDivElement | null>;
}

export interface UseChatScrollPinReturn {
  scrollToEnd: () => void;
  programmaticScrollAtRef: MutableRefObject<number>;
}

/**
 * Manages three scroll-pin behaviours for ChatHistory:
 *
 * 1. Re-pin last item when footer spacer converges or history grows.
 *    Always scrolls to end on session switch.
 * 2. Pin the latest user-message group to the viewport top when a new
 *    group is added. Re-fires as the temporary footer
 *    reserve grows so the first scroll lands at the correct offset.
 * 3. Breaks pin intent on user-initiated scroll. Distinguishes programmatic
 *    scrolls (ignored) from user scrolls (releases pin) via a time window.
 *    The listener is mounted once and reads live state via refs — it is NOT
 *    re-registered on every new message, eliminating monitoring gaps.
 */
export function useChatScrollPin({
  activeId,
  groupCounts,
  totalFlatItems,
  footerSpacerHeight,
  sessionLoadStatus: _sessionLoadStatus,
  virtuosoRef,
  virtuosoScrollerRef,
  atBottom,
  isPendingCancelRef,
  isContentOverflowingRef,
  optimizedChatHistoryLength,
  pinLastGroupRef,
  onPinToTopChange,
  staticScrollerRef,
}: UseChatScrollPinOptions): UseChatScrollPinReturn {
  const programmaticScrollAtRef = useRef(0);

  const atBottomRef = useRef(atBottom);
  useLayoutEffect(() => {
    atBottomRef.current = atBottom;
  }, [atBottom]);

  // Keep a ref to onPinToTopChange so Effect 3's listener doesn't need
  // it in the dependency array (avoids re-registering the scroll listener
  // every time the callback identity changes).
  const onPinToTopChangeRef = useRef(onPinToTopChange);
  useEffect(() => {
    onPinToTopChangeRef.current = onPinToTopChange;
  }, [onPinToTopChange]);

  const scrollToEnd = useCallback(() => {
    if (virtuosoRef.current) {
      if (totalFlatItems > 0) {
        virtuosoRef.current.scrollToIndex({
          index: totalFlatItems - 1,
          align: "end",
          behavior: "auto",
        });
      } else {
        virtuosoRef.current.scrollTo({ top: 0 });
      }
      return;
    }
    // Static rendering path fallback: Virtuoso is not mounted (≤12 items).
    // Scroll the plain div to its bottom so session switches still land correctly.
    const staticEl = staticScrollerRef?.current;
    if (staticEl) {
      staticEl.scrollTo({ top: staticEl.scrollHeight });
    }
  }, [totalFlatItems, virtuosoRef, staticScrollerRef]);

  // Effect 1: re-pin last item when spacer converges or history grows;
  // always scroll to end on session switch.
  const prevActiveIdForScrollRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (optimizedChatHistoryLength === 0) return;
    const sessionChanged = prevActiveIdForScrollRef.current !== activeId;
    prevActiveIdForScrollRef.current = activeId ?? null;

    if (sessionChanged) {
      // Reset the programmatic-scroll timestamp so the first scroll event on
      // the new session is never mistaken for a continuation of the previous
      // session's last programmatic scroll.
      programmaticScrollAtRef.current = 0;
      pinLastGroupRef.current = false;
      onPinToTopChange?.(false);
      const rafId = requestAnimationFrame(() => {
        programmaticScrollAtRef.current = performance.now();
        scrollToEnd();
      });
      return () => cancelAnimationFrame(rafId);
    }
    if (pinLastGroupRef.current) return;
    if (isPendingCancelRef.current) return;
    if (!isContentOverflowingRef.current) return;
    if (!atBottomRef.current) return;
    const rafId = requestAnimationFrame(() => {
      // Mark as programmatic so Effect 3's listener doesn't break the pin.
      programmaticScrollAtRef.current = performance.now();
      scrollToEnd();
    });
    return () => cancelAnimationFrame(rafId);
  }, [
    activeId,
    footerSpacerHeight,
    optimizedChatHistoryLength,
    scrollToEnd,
    isContentOverflowingRef,
    isPendingCancelRef,
    onPinToTopChange,
    pinLastGroupRef,
  ]);

  // Effect 2: scroll to bottom when a new user-message group is added.
  const prevGroupLenRef = useRef(groupCounts.length);
  const prevFooterSpacerForPinRef = useRef(footerSpacerHeight);

  useEffect(() => {
    const prevGroupLen = prevGroupLenRef.current;
    const prevSpacer = prevFooterSpacerForPinRef.current;
    prevGroupLenRef.current = groupCounts.length;
    prevFooterSpacerForPinRef.current = footerSpacerHeight;

    const newGroupAdded = groupCounts.length > prevGroupLen;
    const spacerGrew =
      pinLastGroupRef.current && footerSpacerHeight > prevSpacer;

    if (newGroupAdded) {
      pinLastGroupRef.current = false;
      onPinToTopChange?.(false);
    }

    if (newGroupAdded || spacerGrew) {
      requestAnimationFrame(() => {
        programmaticScrollAtRef.current = performance.now();
        scrollToEnd();
      });
    }
  }, [
    groupCounts.length,
    footerSpacerHeight,
    onPinToTopChange,
    pinLastGroupRef,
    scrollToEnd,
  ]);

  // Effect 3: break pin intent on user-initiated scroll.
  //
  // Mounted once per scroller element change — intentionally does NOT
  // depend on totalFlatItems or sessionLoadStatus. Those changes used to
  // force a remove+re-add cycle that created a short window where user
  // scrolls went undetected. Live values are accessed via refs instead.
  useEffect(() => {
    const el = virtuosoScrollerRef.current;
    if (!el) return;
    const PROGRAMMATIC_WINDOW_MS = 250;
    const handleScroll = (): void => {
      if (!pinLastGroupRef.current) return;
      const elapsed = performance.now() - programmaticScrollAtRef.current;
      if (elapsed < PROGRAMMATIC_WINDOW_MS) return;
      pinLastGroupRef.current = false;
      onPinToTopChangeRef.current?.(false);
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", handleScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtuosoScrollerRef, pinLastGroupRef]);

  return { scrollToEnd, programmaticScrollAtRef };
}
