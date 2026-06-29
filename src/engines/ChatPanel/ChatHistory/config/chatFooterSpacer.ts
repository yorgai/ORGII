/**
 * Chat history bottom spacer.
 *
 * Keep the footer height stable so streaming/explore row re-measurements do
 * not amplify into a full-viewport blank tail.
 */

export const CHAT_FOOTER_SPACER = {
  /** Minimum spacer before the bottom overlay guard. */
  MIN_WHEN_FULL_PX: 32,
  /** Extra guard added on top of bottomInset for the input overlay. Do not tune casually; follow reliability depends on this target. */
  BOTTOM_GUARD_PX: 120,
  /** Ignore sub-pixel / tiny remeasure noise, but keep spacer state and rendering in sync. */
  UPDATE_THRESHOLD_PX: 8,
  /** Gap before every non-first turn header so adjacent rounds do not visually merge. */
  ROUND_GAP_PX: 24,
} as const;

export function computeChatFooterSpacerHeight(params: {
  clientHeight: number;
  scrollHeight: number;
  currentFooterSpacerPx: number;
  /** Measured px from the top of the latest group's first body item down
   *  to the end of the last rendered body item, excluding the spacer. */
  lastGroupContentHeight: number | null;
  /** Height of the absolute-positioned input overlay. Added so the last
   *  message is always reachable above the overlay. */
  bottomInset?: number;
  /** Reserve enough footer room to pin the latest group to the viewport top. */
  reservePinToTop?: boolean;
}): number {
  const { bottomInset = 0 } = params;

  return (
    CHAT_FOOTER_SPACER.MIN_WHEN_FULL_PX +
    bottomInset +
    CHAT_FOOTER_SPACER.BOTTOM_GUARD_PX
  );
}

export function getChatContentBottomScrollTop(params: {
  scrollHeight: number;
  clientHeight: number;
  footerSpacerHeight: number;
  bottomInset: number;
}): number {
  const contentBottom = Math.max(
    0,
    params.scrollHeight - params.footerSpacerHeight
  );
  return Math.max(
    0,
    contentBottom -
      params.clientHeight +
      Math.max(0, params.bottomInset) +
      CHAT_FOOTER_SPACER.BOTTOM_GUARD_PX
  );
}

export function getChatContentBottomDistance(params: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  footerSpacerHeight: number;
  bottomInset: number;
}): number {
  return getChatContentBottomScrollTop(params) - Math.max(0, params.scrollTop);
}
