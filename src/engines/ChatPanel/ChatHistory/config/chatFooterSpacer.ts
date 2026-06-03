/**
 * Chat history bottom spacer (Virtuoso Footer slot).
 *
 * Footer spacer behavior with two modes:
 *  1. Normal bottom/open state: add only enough slack so the last message sits
 *     above the composer instead of exposing a full-viewport void.
 *  2. Active pin-to-top state: temporarily reserve enough room that the latest
 *     user message group can sit pinned at the very top of the viewport.
 */

export const CHAT_FOOTER_SPACER = {
  /** Extra px below the last message when content fills the viewport */
  BREATHING_ROOM_PX: 12,
  /** Minimum spacer when the thread already fills the scroll area */
  MIN_WHEN_FULL_PX: 24,
  /**
   * Extra guard added on top of bottomInset so the last chat item is never
   * obscured by the absolute-positioned InputArea overlay.
   */
  BOTTOM_GUARD_PX: 24,
  /** Cap pin-to-top slack so short latest rounds do not create a full viewport void. */
  MAX_PIN_RESERVE_PX: 200,
} as const;

export function computeChatFooterSpacerHeight(params: {
  clientHeight: number;
  scrollHeight: number;
  currentFooterSpacerPx: number;
  /** Measured px from the top of the latest group's first body item down
   *  to the end of the last rendered body item, excluding the spacer.
   *  `null` when the latest group has no body items yet (pin to top still
   *  works — we treat the height as 0 and reserve a full-viewport spacer). */
  lastGroupContentHeight: number | null;
  /** Height of the absolute-positioned input overlay. Added to all spacer
   *  values so the last message is always reachable above the overlay. */
  bottomInset?: number;
  /** Reserve enough footer room to pin the latest group to the viewport top. */
  reservePinToTop?: boolean;
}): number {
  const {
    clientHeight,
    scrollHeight,
    currentFooterSpacerPx,
    lastGroupContentHeight,
    bottomInset = 0,
    reservePinToTop = false,
  } = params;
  if (clientHeight <= 0) {
    return (
      CHAT_FOOTER_SPACER.MIN_WHEN_FULL_PX +
      bottomInset +
      CHAT_FOOTER_SPACER.BOTTOM_GUARD_PX
    );
  }

  const contentWithoutSpacer = scrollHeight - currentFooterSpacerPx;

  // Short-thread filler: top up so the last message clears the overlay.
  let shortThreadFiller = CHAT_FOOTER_SPACER.MIN_WHEN_FULL_PX + bottomInset;
  if (contentWithoutSpacer < clientHeight) {
    shortThreadFiller =
      clientHeight -
      contentWithoutSpacer +
      CHAT_FOOTER_SPACER.BREATHING_ROOM_PX +
      bottomInset;
  }

  const minFull =
    CHAT_FOOTER_SPACER.MIN_WHEN_FULL_PX +
    bottomInset +
    CHAT_FOOTER_SPACER.BOTTOM_GUARD_PX;

  if (!reservePinToTop) {
    return Math.max(minFull, shortThreadFiller);
  }

  // Pin-to-top reserve: the latest group should be scrollable upward, but not
  // so far that a short latest round creates a full-viewport blank footer.
  const rawLastGroupReserve =
    clientHeight -
    (lastGroupContentHeight ?? 0) +
    CHAT_FOOTER_SPACER.BREATHING_ROOM_PX +
    bottomInset;
  const cappedLastGroupReserve = Math.min(
    rawLastGroupReserve,
    bottomInset + CHAT_FOOTER_SPACER.MAX_PIN_RESERVE_PX
  );

  return Math.max(minFull, shortThreadFiller, cappedLastGroupReserve);
}
