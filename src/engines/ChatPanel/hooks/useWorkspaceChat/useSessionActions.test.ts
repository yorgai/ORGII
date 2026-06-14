import { describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  hasCurrentTurnProducedOutput,
  hasPriorTurns,
  resolveRestorableUserMessage,
} from "./useSessionActions";

vi.hoisted(() => {
  Object.defineProperty(globalThis.window, "matchMedia", {
    writable: true,
    value: () => ({ matches: false }),
  });
});

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

describe("hasCurrentTurnProducedOutput", () => {
  function event(overrides: Partial<SessionEvent>): SessionEvent {
    return {
      id: "event-1",
      sessionId: "session-1",
      source: "user",
      createdAt: new Date().toISOString(),
      actionType: "raw",
      functionName: "user_message",
      displayVariant: "message",
      ...overrides,
    } as SessionEvent;
  }

  it("returns false when the current turn only has a user message", () => {
    expect(
      hasCurrentTurnProducedOutput([event({ source: "user" })], "session-1")
    ).toBe(false);
  });

  it("returns true after assistant output exists in the current turn", () => {
    expect(
      hasCurrentTurnProducedOutput(
        [event({ source: "user" }), event({ source: "assistant" })],
        "session-1"
      )
    ).toBe(true);
  });

  it("ignores output from other sessions", () => {
    expect(
      hasCurrentTurnProducedOutput(
        [
          event({ source: "assistant", sessionId: "other-session" }),
          event({ source: "user" }),
        ],
        "session-1"
      )
    ).toBe(false);
  });

  it("returns false when prior turns have output but current turn does not", () => {
    expect(
      hasCurrentTurnProducedOutput(
        [
          event({ id: "t1-user", source: "user" }),
          event({ id: "t1-assist", source: "assistant" }),
          event({ id: "t2-user", source: "user" }),
        ],
        "session-1"
      )
    ).toBe(false);
  });

  it("returns true when the current turn has output after prior turns", () => {
    expect(
      hasCurrentTurnProducedOutput(
        [
          event({ id: "t1-user", source: "user" }),
          event({ id: "t1-assist", source: "assistant" }),
          event({ id: "t2-user", source: "user" }),
          event({ id: "t2-assist", source: "assistant" }),
        ],
        "session-1"
      )
    ).toBe(true);
  });
});

describe("hasPriorTurns", () => {
  function event(overrides: Partial<SessionEvent>): SessionEvent {
    return {
      id: "event-1",
      sessionId: "session-1",
      source: "user",
      createdAt: new Date().toISOString(),
      actionType: "raw",
      functionName: "user_message",
      displayVariant: "message",
      ...overrides,
    } as SessionEvent;
  }

  it("returns false for a single user event (first conversation)", () => {
    expect(hasPriorTurns([event({ source: "user" })], "session-1")).toBe(false);
  });

  it("returns true when two user events exist (multi-turn)", () => {
    expect(
      hasPriorTurns(
        [
          event({ id: "t1-user", source: "user" }),
          event({ id: "t1-assist", source: "assistant" }),
          event({ id: "t2-user", source: "user" }),
        ],
        "session-1"
      )
    ).toBe(true);
  });

  it("ignores user events from other sessions", () => {
    expect(
      hasPriorTurns(
        [
          event({ id: "other-user", source: "user", sessionId: "other" }),
          event({ id: "my-user", source: "user" }),
        ],
        "session-1"
      )
    ).toBe(false);
  });
});
