/**
 * Measures the chat scroller and sets footer spacer height so normal
 * bottom state stays compact while active pin-to-top has enough scroll range.
 */
import { useAtomValue } from "jotai";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { MutableRefObject, RefObject } from "react";

import { activeSessionIdAtom } from "@src/store/session";

import {
  CHAT_FOOTER_SPACER,
  computeChatFooterSpacerHeight,
} from "../config/chatFooterSpacer";

export interface UseChatFooterSpacerOptions {
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  /** History / layout keys that invalidate scroll metrics */
  optimizedChatHistoryLength: number;
  totalFlatItems: number;
  planningIndicatorCount: number;
  /** Flat index of the latest user-message group's first body item, or
   *  `null` when the latest group has no body items yet. Used to measure
   *  the last group's rendered height so the spacer can reserve enough
   *  room for pin-to-top. */
  lastGroupFirstFlatIndex: number | null;
  /** Height in px of the overlapping input area. Added to the spacer so the
   *  last message stays reachable above the absolute-positioned input overlay. */
  bottomInset?: number;
  /** Reserve enough room for the latest group to pin to the viewport top. */
  reservePinToTop?: boolean;
  /** Timestamp of the latest user scroll; spacer writes pause briefly during momentum. */
  manualScrollAtRef?: MutableRefObject<number>;
}

export interface UseChatFooterSpacerReturn {
  footerSpacerHeight: number;
  /** Writable — assigned to the active chat scroll root node. */
  virtuosoScrollerRef: MutableRefObject<HTMLDivElement | null>;
  /** `true` when the rendered chat content (excluding the footer spacer)
   *  is taller than the viewport — i.e. there is actually content off-screen
   *  that would benefit from follow-to-bottom auto-scroll. When `false`, the
   *  entire thread fits in view and any auto-scroll would only drag content
   *  upward for no reason. Recomputed on every `runRemeasurePass`. */
  isContentOverflowingRef: MutableRefObject<boolean>;
}

/** Tolerance for "content fits" comparison — avoids ping-pong when content
 *  height is within a few sub-pixels of the viewport. */
const OVERFLOW_SLACK_PX = 8;
const MANUAL_SCROLL_SPACER_SUPPRESS_MS = 350;

export function useChatFooterSpacer(
  options: UseChatFooterSpacerOptions
): UseChatFooterSpacerReturn {
  const {
    bottomInset = 0,
    reservePinToTop = false,
    manualScrollAtRef,
  } = options;
  const bottomInsetRef = useRef(bottomInset);
  const fallbackManualScrollAtRef = useRef(0);
  const effectiveManualScrollAtRef =
    manualScrollAtRef ?? fallbackManualScrollAtRef;
  useEffect(() => {
    bottomInsetRef.current = bottomInset;
  }, [bottomInset]);
  const sessionId = useAtomValue(activeSessionIdAtom);
  /** Mutable — `useRef(null)` can infer `RefObject` (readonly current) in some TS versions. */
  const virtuosoScrollerRef = useRef<HTMLDivElement | null>(
    null
  ) as MutableRefObject<HTMLDivElement | null>;

  // Initial spacer must already include bottomInset + guard so the static
  // rendering path (≤12 items, no Virtuoso scroller) gets a correct spacer
  // even before the ResizeObserver fires or when virtuosoScrollerRef is null.
  const initialSpacerHeight =
    CHAT_FOOTER_SPACER.MIN_WHEN_FULL_PX +
    bottomInset +
    CHAT_FOOTER_SPACER.BOTTOM_GUARD_PX;

  const [footerSpacerHeight, setFooterSpacerHeight] =
    useState<number>(initialSpacerHeight);
  const footerSpacerHeightRef = useRef<number>(initialSpacerHeight);
  const isContentOverflowingRef = useRef<boolean>(false);

  const prevSessionIdRef = useRef(sessionId);
  useLayoutEffect(() => {
    if (prevSessionIdRef.current === sessionId) return;
    prevSessionIdRef.current = sessionId;
    const resetHeight =
      CHAT_FOOTER_SPACER.MIN_WHEN_FULL_PX +
      bottomInsetRef.current +
      CHAT_FOOTER_SPACER.BOTTOM_GUARD_PX;
    footerSpacerHeightRef.current = resetHeight;
    const rafId = requestAnimationFrame(() => {
      setFooterSpacerHeight(resetHeight);
    });
    return () => cancelAnimationFrame(rafId);
  }, [sessionId]);

  /** Read from a ref so remeasures triggered by ResizeObserver always see
   *  the latest value without re-creating the callback each render. */
  const lastGroupFirstFlatIndexRef = useRef<number | null>(
    options.lastGroupFirstFlatIndex
  );
  useEffect(() => {
    lastGroupFirstFlatIndexRef.current = options.lastGroupFirstFlatIndex;
  }, [options.lastGroupFirstFlatIndex]);

  /** Do not depend on `footerSpacerHeight` state — that caused update-depth loops
   *  (effect → setState → effect) when scrollHeight fluctuated after each write. */
  const runRemeasurePass = useCallback(() => {
    const el = virtuosoScrollerRef.current;
    if (!el) {
      // Static rendering path: no Virtuoso scroller. Ensure the spacer always
      // accounts for the input overlay height so last items aren't obscured.
      const minForOverlay =
        CHAT_FOOTER_SPACER.MIN_WHEN_FULL_PX +
        bottomInsetRef.current +
        CHAT_FOOTER_SPACER.BOTTOM_GUARD_PX;
      if (
        Math.abs(minForOverlay - footerSpacerHeightRef.current) >=
        CHAT_FOOTER_SPACER.UPDATE_THRESHOLD_PX
      ) {
        footerSpacerHeightRef.current = minForOverlay;
        setFooterSpacerHeight(minForOverlay);
      }
      return;
    }

    const lastGroupContentHeight = reservePinToTop
      ? measureLastGroupContentHeight(el, lastGroupFirstFlatIndexRef.current)
      : null;

    // Overflow check — "content (excluding spacer) taller than viewport".
    // Read before any setState so it's fresh on the same tick the caller
    // (useChatScroll) reacts to the content-length change.
    const contentWithoutSpacer =
      el.scrollHeight - footerSpacerHeightRef.current;
    isContentOverflowingRef.current =
      el.clientHeight > 0 &&
      contentWithoutSpacer > el.clientHeight + OVERFLOW_SLACK_PX;

    const next = Math.round(
      computeChatFooterSpacerHeight({
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        currentFooterSpacerPx: footerSpacerHeightRef.current,
        lastGroupContentHeight,
        bottomInset: bottomInsetRef.current,
        reservePinToTop,
      })
    );
    if (
      performance.now() - effectiveManualScrollAtRef.current <
        MANUAL_SCROLL_SPACER_SUPPRESS_MS &&
      next > footerSpacerHeightRef.current
    ) {
      return;
    }

    if (
      Math.abs(next - footerSpacerHeightRef.current) >=
      CHAT_FOOTER_SPACER.UPDATE_THRESHOLD_PX
    ) {
      footerSpacerHeightRef.current = next;
      setFooterSpacerHeight(next);
    }
  }, [effectiveManualScrollAtRef, reservePinToTop]);

  useLayoutEffect(() => {
    runRemeasurePass();
    const rafId = requestAnimationFrame(() => {
      runRemeasurePass();
    });
    return () => cancelAnimationFrame(rafId);
  }, [
    options.optimizedChatHistoryLength,
    options.totalFlatItems,
    options.planningIndicatorCount,
    options.lastGroupFirstFlatIndex,
    bottomInset,
    runRemeasurePass,
  ]);

  useEffect(() => {
    const outer = options.scrollAreaRef.current;
    if (!outer) return;
    let roRaf = 0;
    let roDebounce: ReturnType<typeof setTimeout>;
    let lastOuterWidth = -1;
    let lastOuterHeight = -1;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      const nextOuterWidth = Math.round(entry?.contentRect.width ?? 0);
      const nextOuterHeight = Math.round(entry?.contentRect.height ?? 0);
      if (
        nextOuterWidth === lastOuterWidth &&
        nextOuterHeight === lastOuterHeight
      ) {
        return;
      }
      lastOuterWidth = nextOuterWidth;
      lastOuterHeight = nextOuterHeight;

      cancelAnimationFrame(roRaf);
      clearTimeout(roDebounce);
      roDebounce = setTimeout(() => {
        roRaf = requestAnimationFrame(() => {
          runRemeasurePass();
          requestAnimationFrame(() => {
            runRemeasurePass();
          });
        });
      }, 32);
    });
    ro.observe(outer);
    return () => {
      clearTimeout(roDebounce);
      cancelAnimationFrame(roRaf);
      ro.disconnect();
    };
  }, [options.scrollAreaRef, reservePinToTop, runRemeasurePass, sessionId]);

  return { footerSpacerHeight, virtuosoScrollerRef, isContentOverflowingRef };
}

/**
 * Sum the bounding-rect heights of rendered virtual items whose
 * `data-item-index` is `>= firstFlatIndex`. Returns `null` when we cannot
 * measure (first item not rendered, scroller missing, or `firstFlatIndex`
 * is `null`) so the caller falls back to the short-thread-only formula.
 */
function measureLastGroupContentHeight(
  scroller: HTMLElement,
  firstFlatIndex: number | null
): number | null {
  if (firstFlatIndex === null) return 0;

  const items = scroller.querySelectorAll<HTMLElement>("[data-item-index]");
  if (items.length === 0) return null;

  let sawFirst = false;
  let total = 0;
  for (const item of items) {
    const attr = item.getAttribute("data-item-index");
    if (attr === null) continue;
    const idx = Number(attr);
    if (!Number.isFinite(idx)) continue;
    if (idx < firstFlatIndex) continue;
    if (idx === firstFlatIndex) sawFirst = true;
    total += item.getBoundingClientRect().height;
  }
  if (!sawFirst) return null;
  return total;
}
