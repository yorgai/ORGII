import { describe, expect, it } from "vitest";

import { resolveRestorableUserMessage } from "./useSessionActions";

describe("resolveRestorableUserMessage", () => {
  it("preserves image attachments when restoring from a snapshot-backed user event", () => {
    const imageDataUrls = ["data:image/png;base64,one"];

    expect(
      resolveRestorableUserMessage({
        snapshotDisplayText: "please inspect this screenshot",
        snapshotImages: imageDataUrls,
        lastUserMessage: {
          displayContent: "please inspect this screenshot",
          imageDataUrls,
        },
      })
    ).toEqual({
      displayContent: "please inspect this screenshot",
      imageDataUrls,
    });
  });

  it("uses lastUserMessage images when older snapshot data omitted images", () => {
    const imageDataUrls = ["data:image/png;base64,restored"];

    expect(
      resolveRestorableUserMessage({
        snapshotDisplayText: "cancel me",
        lastUserMessage: {
          displayContent: "cancel me",
          imageDataUrls,
        },
      })
    ).toEqual({
      displayContent: "cancel me",
      imageDataUrls,
    });
  });

  it("does not attach stale images to a different snapshot message", () => {
    expect(
      resolveRestorableUserMessage({
        snapshotDisplayText: "newer message",
        lastUserMessage: {
          displayContent: "older message",
          imageDataUrls: ["data:image/png;base64,stale"],
        },
      })
    ).toEqual({
      displayContent: "newer message",
      imageDataUrls: undefined,
    });
  });

  it("falls back to pending synthetic event images when no snapshot exists", () => {
    const imageDataUrls = ["data:image/png;base64,pending"];

    expect(
      resolveRestorableUserMessage({
        pendingDisplayText: "pending message",
        pendingImages: imageDataUrls,
      })
    ).toEqual({
      displayContent: "pending message",
      imageDataUrls,
    });
  });
});
