/**
 * Unit tests for the user chat bubble layout derivation
 * (`userBubbleLayout.ts`).
 *
 * Covers the cases that drive the bubble's render ordering: image + text,
 * image-only, text-only, multiple images, and empty messages.
 */
import { describe, expect, it } from "vitest";

import { computeUserBubbleLayout } from "../userBubbleLayout";

describe("computeUserBubbleLayout", () => {
  it("renders bubble with both rows when image and text are present", () => {
    const layout = computeUserBubbleLayout("hello world", ["img-a"]);
    expect(layout).toEqual({
      hasImages: true,
      hasContent: true,
      showBubble: true,
      imageRowNeedsGap: true,
    });
  });

  it("renders image-only bubble with no trailing gap", () => {
    const layout = computeUserBubbleLayout("", ["img-a"]);
    expect(layout.hasImages).toBe(true);
    expect(layout.hasContent).toBe(false);
    expect(layout.showBubble).toBe(true);
    // No text follows, so the image row must not reserve a bottom gap.
    expect(layout.imageRowNeedsGap).toBe(false);
  });

  it("treats whitespace-only content as image-only", () => {
    const layout = computeUserBubbleLayout("   \n  ", ["img-a"]);
    expect(layout.hasContent).toBe(false);
    expect(layout.imageRowNeedsGap).toBe(false);
  });

  it("renders text-only bubble without an image row", () => {
    const layout = computeUserBubbleLayout("just text");
    expect(layout).toEqual({
      hasImages: false,
      hasContent: true,
      showBubble: true,
      imageRowNeedsGap: false,
    });
  });

  it("handles multiple images the same as a single image", () => {
    const layout = computeUserBubbleLayout("caption", [
      "img-a",
      "img-b",
      "img-c",
    ]);
    expect(layout.hasImages).toBe(true);
    expect(layout.imageRowNeedsGap).toBe(true);
  });

  it("does not render the bubble when there is no content or image", () => {
    expect(computeUserBubbleLayout("", []).showBubble).toBe(false);
    expect(computeUserBubbleLayout("").showBubble).toBe(false);
    expect(computeUserBubbleLayout("", undefined).showBubble).toBe(false);
    expect(computeUserBubbleLayout("", null).showBubble).toBe(false);
  });

  it("treats an empty image array as no images", () => {
    const layout = computeUserBubbleLayout("text", []);
    expect(layout.hasImages).toBe(false);
    expect(layout.imageRowNeedsGap).toBe(false);
  });
});
