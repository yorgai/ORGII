/**
 * Layout derivation for the user chat bubble (`UserBubbleContent`).
 *
 * Decides whether the primary bubble box should render and how image
 * attachments and text content stack inside it. Images render FIRST
 * (on top) and text content below, both inside the same `bg-primary-1`
 * bubble. Extracted as a pure function so the ordering/visibility rules
 * can be unit-tested independently of the JSX.
 */
export interface UserBubbleLayout {
  /** Whether the message has any image attachments to render. */
  hasImages: boolean;
  /** Whether the message has visible text content (post pill-stripping). */
  hasContent: boolean;
  /**
   * Whether the primary bubble box (images + text) should render at all.
   * False when the message is empty (no images and no text content).
   */
  showBubble: boolean;
  /**
   * Whether a vertical gap is needed below the image row — only when both
   * images and text are present, so image-only bubbles have no trailing gap.
   */
  imageRowNeedsGap: boolean;
}

/**
 * Derive bubble layout flags from the (already pill-stripped) text content
 * and the optional image reference list.
 */
export function computeUserBubbleLayout(
  strippedContent: string,
  images?: readonly string[] | null
): UserBubbleLayout {
  const hasImages = Array.isArray(images) && images.length > 0;
  const hasContent = strippedContent.trim() !== "";
  return {
    hasImages,
    hasContent,
    showBubble: hasImages || hasContent,
    imageRowNeedsGap: hasImages && hasContent,
  };
}
