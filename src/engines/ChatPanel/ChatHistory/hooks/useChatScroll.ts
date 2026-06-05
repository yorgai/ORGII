/**
 * useChatScroll Hook
 *
 * Manages scroll-to-bottom behaviour for the chat list:
 * - atBottom state change handler (syncs to parent)
 * - scrollToBottom action
 * - followOutput — auto-scroll when new content arrives and the user
 *   is at (or near) the content bottom
 *
 * The chat footer renders a measured spacer (see `useChatFooterSpacer`)
 * so short threads can pin the last item to the bottom without a
 * full-viewport empty gap. followOutput returns `false` and manually
 * calls `scrollToIndex(align:"end")` so the last *item* sits at the
 * viewport bottom with only the small tail spacer below the fold.
 */
import {
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type { VirtuosoHandle } from "react-virtuoso";

// ============================================
// Types
// ============================================

export interface UseChatScrollOptions {
  optimizedChatHistoryLength: number;
  virtuosoRef: RefObject<VirtuosoHandle>;
  atBottom: boolean;
  setAtBottom: Dispatch<SetStateAction<boolean>>;
  setIsChatScrolledToBottom: (bottom: boolean) => void;
  isWpGeneWorkingRef: MutableRefObject<boolean>;
  /** When true, a user-initiated cancel is in flight. Auto-scroll is
   *  suppressed to prevent the viewport from jumping upward as content
   *  shrinks (events finalizing, planning footer collapsing). */
  isPendingCancelRef: MutableRefObject<boolean>;
  /** Ref tracking Virtuoso's visibleRange.endIndex — used to detect
   *  "near content bottom" independently of atBottom (which uses a
   *  small threshold and won't be true when the spacer is below). */
  visibleRangeEndRef: MutableRefObject<number>;
  /** When true, the latest user-message group is pinned to the top of
   *  the viewport; both the new-message auto-scroll effect and the
   *  `followOutput` streaming auto-scroll stand down so the pin sticks.
   *  Cleared by `ChatHistory` on manual scroll / session switch. */
  pinLastGroupRef: MutableRefObject<boolean>;
  /** Timestamp of the latest user-triggered turn collapse/expand. During
   *  this short window, structural list-size changes must preserve the
   *  user's local viewport instead of following the virtualized tail. */
  turnCollapseInteractionAtRef: MutableRefObject<number>;
  /** `true` only when rendered chat content is taller than the viewport.
   *  When `false`, all auto-scroll-to-bottom paths bail — scrolling would
   *  just drag content upward without revealing anything new. */
  isContentOverflowingRef: MutableRefObject<boolean>;
  /** Active session ID — used to reset internal counters on session switch. */
  activeSessionId: string | null | undefined;
  /** Static renderer scroll root used when Virtuoso is not mounted. */
  staticScrollerRef?: MutableRefObject<HTMLDivElement | null>;
}

export interface UseChatScrollReturn {
  handleAtBottomStateChange: (bottom: boolean) => void;
  scrollToBottom: () => void;
  followOutput: (isAtBottom: boolean) => "smooth" | false;
}

// ============================================
// Hook
// ============================================

/** Debounce for atBottom state updates.  Prevents rapid true/false
 *  toggling at the scroll boundary from triggering re-render bounce.
 *  Aligned with RANGE_DEBOUNCE_MS in useChatPagination (150ms) so
 *  showScrollToBottom — which reads both atBottom and visibleRange —
 *  transitions without flickering from desynchronised updates. */
const AT_BOTTOM_DEBOUNCE_MS = 150;
const TURN_COLLAPSE_AUTO_FOLLOW_SUPPRESS_MS = 700;

export function useChatScroll({
  optimizedChatHistoryLength,
  virtuosoRef,
  atBottom,
  setAtBottom,
  setIsChatScrolledToBottom,
  isWpGeneWorkingRef,
  isPendingCancelRef,
  visibleRangeEndRef,
  pinLastGroupRef,
  turnCollapseInteractionAtRef,
  isContentOverflowingRef,
  activeSessionId,
  staticScrollerRef,
}: UseChatScrollOptions): UseChatScrollReturn {
  const atBottomRef = useRef(true);

  const chatHistoryLengthRef = useRef(optimizedChatHistoryLength);
  useEffect(() => {
    chatHistoryLengthRef.current = optimizedChatHistoryLength;
  }, [optimizedChatHistoryLength]);

  const scrollRafRef = useRef(0);
  useEffect(() => {
    return () => cancelAnimationFrame(scrollRafRef.current);
  }, []);

  const bottomDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    return () => {
      if (bottomDebounceRef.current) clearTimeout(bottomDebounceRef.current);
    };
  }, []);

  const shouldSuppressTurnCollapseFollow = useCallback(() => {
    return (
      performance.now() - turnCollapseInteractionAtRef.current <
      TURN_COLLAPSE_AUTO_FOLLOW_SUPPRESS_MS
    );
  }, [turnCollapseInteractionAtRef]);

  const handleAtBottomStateChange = useCallback(
    (bottom: boolean) => {
      atBottomRef.current = bottom;

      clearTimeout(bottomDebounceRef.current);
      bottomDebounceRef.current = setTimeout(() => {
        setAtBottom(bottom);
        setIsChatScrolledToBottom(bottom);
      }, AT_BOTTOM_DEBOUNCE_MS);
    },
    [setAtBottom, setIsChatScrolledToBottom]
  );

  const scrollToBottom = useCallback(() => {
    const staticEl = staticScrollerRef?.current;
    if (staticEl) {
      if (staticEl.scrollHeight > staticEl.clientHeight) {
        staticEl.scrollTo({
          top: Math.max(0, staticEl.scrollHeight - staticEl.clientHeight),
          behavior: "smooth",
        });
      }
      return;
    }
    if (virtuosoRef.current && optimizedChatHistoryLength > 0) {
      virtuosoRef.current.scrollToIndex({
        index: optimizedChatHistoryLength - 1,
        behavior: "smooth",
        align: "end",
      });
    }
  }, [optimizedChatHistoryLength, staticScrollerRef, virtuosoRef]);

  // Auto-scroll when new messages arrive if user was at content bottom.
  // Stands down while the latest group is pinned to top — the pin is the
  // caller's explicit override of bottom-follow behaviour.
  // Also stands down when content still fits in the viewport (no overflow):
  // scrolling in that case would only drag content upward without revealing
  // anything new below.
  const prevMessageCountRef = useRef(optimizedChatHistoryLength);

  // Reset on session switch so the "new items arrived" heuristic doesn't
  // carry stale counts from the previous session.
  const prevSessionIdRef = useRef(activeSessionId);
  useEffect(() => {
    if (activeSessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = activeSessionId;
      prevMessageCountRef.current = optimizedChatHistoryLength;
    }
  }, [activeSessionId, optimizedChatHistoryLength]);

  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    const currentCount = optimizedChatHistoryLength;
    prevMessageCountRef.current = currentCount;

    if (pinLastGroupRef.current) return;
    if (shouldSuppressTurnCollapseFollow()) return;
    if (!isContentOverflowingRef.current) return;

    const isNearContentBottom = visibleRangeEndRef.current >= currentCount - 2;

    if (currentCount > prevCount && (atBottom || isNearContentBottom)) {
      const timer = setTimeout(() => {
        if (pinLastGroupRef.current) return;
        if (shouldSuppressTurnCollapseFollow()) return;
        if (!isContentOverflowingRef.current && !staticScrollerRef?.current) {
          return;
        }
        scrollToBottom();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [
    optimizedChatHistoryLength,
    atBottom,
    scrollToBottom,
    visibleRangeEndRef,
    pinLastGroupRef,
    shouldSuppressTurnCollapseFollow,
    isContentOverflowingRef,
    staticScrollerRef,
  ]);

  const scrollStaticToEndGap = useCallback(() => {
    const staticEl = staticScrollerRef?.current;
    if (!staticEl) return false;
    if (staticEl.scrollHeight <= staticEl.clientHeight) return true;
    staticEl.scrollTo({
      top: Math.max(0, staticEl.scrollHeight - staticEl.clientHeight),
      behavior: "auto",
    });
    return true;
  }, [staticScrollerRef]);

  // followOutput: return false and manually scroll to the last *item*
  // (align:"end").  The footer spacer means the absolute scroll bottom
  // is past the spacer; returning "smooth" would keep the viewport on
  // the spacer instead of the content.
  //
  // Stands down while the latest group is pinned to top so streaming
  // tokens cannot yank the viewport back to the bottom.
  // Also stands down when content still fits in the viewport: aligning
  // the last item to "end" when the whole thread is shorter than the
  // viewport pushes earlier content off the top of the screen.
  const followOutput = useCallback(
    (isAtBottom: boolean): "smooth" | false => {
      if (pinLastGroupRef.current) return false;
      if (shouldSuppressTurnCollapseFollow()) return false;
      if (!isContentOverflowingRef.current) return false;
      if (isPendingCancelRef.current) return false;

      const length = chatHistoryLengthRef.current;
      const isNearContentBottom = visibleRangeEndRef.current >= length - 2;

      if (
        isAtBottom ||
        atBottomRef.current ||
        isNearContentBottom ||
        isWpGeneWorkingRef.current
      ) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = requestAnimationFrame(() => {
          if (pinLastGroupRef.current) return;
          if (shouldSuppressTurnCollapseFollow()) return;
          if (!isContentOverflowingRef.current) return;
          if (isPendingCancelRef.current) return;
          if (scrollStaticToEndGap()) return;
          const len = chatHistoryLengthRef.current;
          if (len > 0) {
            virtuosoRef.current?.scrollToIndex({
              index: len - 1,
              align: "end",
              behavior: "auto",
            });
          }
        });
      }
      return false;
    },
    [
      virtuosoRef,
      isWpGeneWorkingRef,
      isPendingCancelRef,
      visibleRangeEndRef,
      pinLastGroupRef,
      shouldSuppressTurnCollapseFollow,
      isContentOverflowingRef,
      scrollStaticToEndGap,
    ]
  );

  return {
    handleAtBottomStateChange,
    scrollToBottom,
    followOutput,
  };
}
