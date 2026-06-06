import { describe, expect, it, vi } from "vitest";

import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  resolveRestorableUserMessage,
  restoreStoppedTurnFromSnapshot,
} from "./useSessionActions";

vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: {
    getLatestSessionSnapshot: vi.fn(),
    truncateBeforeId: vi.fn().mockResolvedValue(undefined),
  },
}));

function makeEvent(
  id: string,
  source: "user" | "assistant",
  displayVariant: SessionEvent["displayVariant"] = "message"
): SessionEvent {
  return {
    id,
    chunk_id: null,
    sessionId: "session-1",
    createdAt: "2026-06-06T21:00:00.000Z",
    functionName: source === "user" ? "user_message" : "assistant_message",
    uiCanonical: source === "user" ? "user_message" : "assistant_message",
    actionType: source,
    args: {},
    result: { observation: id },
    source,
    displayText: id,
    displayStatus: "completed",
    displayVariant,
    activityStatus: "agent",
  };
}

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

describe("restoreStoppedTurnFromSnapshot", () => {
  it("bounds deferred Stop restore scans to the recent tail", () => {
    const oldEvents = Array.from({ length: 250 }, (_, index) =>
      makeEvent(`old-assistant-${index}`, "assistant")
    );
    const tailUser = makeEvent("tail-user", "user");
    vi.mocked(eventStoreProxy.getLatestSessionSnapshot).mockReturnValue({
      version: 1,
      eventCount: oldEvents.length + 1,
      events: [...oldEvents, tailUser],
      chatEvents: [...oldEvents, tailUser],
      messagesEvents: [...oldEvents, tailUser],
      sortedSimulatorEvents: [],
      lastEvent: tailUser,
      eventIndex: {},
      chatEventCount: oldEvents.length + 1,
      hasRunningEvent: false,
    });
    const setRestoreToInput = vi.fn();

    restoreStoppedTurnFromSnapshot({
      sessionId: "session-1",
      lastUserMessage: null,
      pendingDisplayText: "pending fallback",
      setRestoreToInput,
    });

    expect(setRestoreToInput).toHaveBeenCalledWith({
      displayContent: "tail-user",
      imageDataUrls: undefined,
    });
    expect(eventStoreProxy.truncateBeforeId).toHaveBeenCalledWith(
      "tail-user",
      "session-1"
    );
  });
});
