import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  resolveRestorableUserMessage,
  shouldRestoreStoppedUserMessage,
} from "./useSessionActions";

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

function makeEvent(overrides: Partial<SessionEvent>): SessionEvent {
  return {
    id: "event-id",
    chunk_id: "event-id",
    sessionId: "session-a",
    createdAt: "2026-01-01T00:00:00.000Z",
    functionName: "",
    uiCanonical: "",
    actionType: "raw",
    args: {},
    result: {},
    source: "assistant",
    displayText: "",
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
    ...overrides,
  } as SessionEvent;
}

describe("shouldRestoreStoppedUserMessage", () => {
  const message = { displayContent: "please run this" };

  it("restores when the stopped user message has no later rendered agent events", () => {
    expect(
      shouldRestoreStoppedUserMessage({
        events: [
          makeEvent({
            id: "user-1",
            source: "user",
            displayText: "please run this",
            displayVariant: "message",
            result: { message: "please run this" },
          }),
        ],
        sessionId: "session-a",
        message,
      })
    ).toBe(true);
  });

  it("does not restore when agent output already rendered after the stopped user message", () => {
    expect(
      shouldRestoreStoppedUserMessage({
        events: [
          makeEvent({
            id: "user-1",
            source: "user",
            displayText: "please run this",
            displayVariant: "message",
            result: { message: "please run this" },
          }),
          makeEvent({
            id: "assistant-1",
            source: "assistant",
            actionType: "assistant",
            displayVariant: "message",
            result: { content: "I started working on it" },
          }),
        ],
        sessionId: "session-a",
        message,
      })
    ).toBe(false);
  });

  it("ignores events from other sessions", () => {
    expect(
      shouldRestoreStoppedUserMessage({
        events: [
          makeEvent({
            id: "user-1",
            source: "user",
            displayText: "please run this",
            displayVariant: "message",
            result: { message: "please run this" },
          }),
          makeEvent({
            id: "assistant-foreign",
            sessionId: "session-b",
            source: "assistant",
            actionType: "assistant",
            displayVariant: "message",
            result: { content: "foreign output" },
          }),
        ],
        sessionId: "session-a",
        message,
      })
    ).toBe(true);
  });
});
