/**
 * buildRecoveredEvents — unit tests
 *
 * Why this is a regression-guard test, not a happy-path test:
 *   The previous `checkAndRecover` implementation wrapped both
 *   `partialCache.load(...)` and the event construction in a single
 *   try/catch. If the transform step ever threw — for example because
 *   a future field on `result` became non-string and triggered a
 *   `.trim()` failure — the catch arm would delete the on-disk partial
 *   file. That meant a bug in the transform path silently destroyed
 *   the user's accumulated streaming content.
 *
 *   The fix extracted the transform into a pure module-level function
 *   so that:
 *     (a) it can be exercised here without spinning up a hook,
 *     (b) the caller can choose NOT to delete on transform failure,
 *         keeping the on-disk file intact for a future retry.
 *
 * These tests pin down the contract:
 *   - Empty / missing optional fields produce 0 events (not a throw).
 *   - Thinking-only state produces one thinking event.
 *   - Message-only state produces one message event.
 *   - Both present → both events, thinking first.
 *   - The `recovered: true` marker is always set on result.
 *   - The function NEVER throws, even on degenerate / missing data.
 */
import { describe, expect, it } from "vitest";

import type { PartialStreamState } from "../../../storage/partialCache";
import { buildRecoveredEvents } from "../usePartialRecovery";

function makeState(
  overrides: Partial<PartialStreamState> = {}
): PartialStreamState {
  return {
    sessionId: "test-session",
    startedAt: "2024-01-01T00:00:00.000Z",
    lastUpdatedAt: "2024-01-01T00:00:01.000Z",
    ...overrides,
  };
}

describe("buildRecoveredEvents — empty inputs", () => {
  it("returns [] when both accumulated buffers are missing", () => {
    const events = buildRecoveredEvents("s1", makeState());
    expect(events).toEqual([]);
  });

  it("returns [] when both accumulated buffers are empty strings", () => {
    const events = buildRecoveredEvents(
      "s1",
      makeState({ accumulatedMessage: "", accumulatedThinking: "" })
    );
    expect(events).toEqual([]);
  });

  it("returns [] when both buffers are whitespace-only", () => {
    const events = buildRecoveredEvents(
      "s1",
      makeState({
        accumulatedMessage: "   \n\t  ",
        accumulatedThinking: " \n ",
      })
    );
    expect(events).toEqual([]);
  });
});

describe("buildRecoveredEvents — thinking only", () => {
  it("produces a single thinking event", () => {
    const events = buildRecoveredEvents(
      "s1",
      makeState({ accumulatedThinking: "Let me think about this." })
    );
    expect(events).toHaveLength(1);
    expect(events[0].actionType).toBe("llm_thinking");
    expect(events[0].displayVariant).toBe("thinking");
    expect(events[0].source).toBe("assistant");
  });

  it("uses the provided thinkingEventId as the event id when available", () => {
    const events = buildRecoveredEvents(
      "s1",
      makeState({
        accumulatedThinking: "x",
        thinkingEventId: "explicit-thinking-id",
      })
    );
    expect(events[0].id).toBe("explicit-thinking-id");
    expect(events[0].chunk_id).toBe("explicit-thinking-id");
  });

  it("synthesizes a recovery id when thinkingEventId is missing", () => {
    const events = buildRecoveredEvents(
      "s1",
      makeState({ accumulatedThinking: "x" })
    );
    expect(events[0].id).toMatch(/^recovered:thinking:s1:/);
    expect(events[0].chunk_id).toBeNull();
  });

  it("marks recovered: true on the result for downstream replay logic", () => {
    const events = buildRecoveredEvents(
      "s1",
      makeState({ accumulatedThinking: "x" })
    );
    expect(events[0].result.recovered).toBe(true);
  });

  it("forces isDelta=false so the chat-history pipeline treats it as final", () => {
    const events = buildRecoveredEvents(
      "s1",
      makeState({ accumulatedThinking: "x" })
    );
    expect(events[0].isDelta).toBe(false);
  });
});

describe("buildRecoveredEvents — message only", () => {
  it("produces a single message event", () => {
    const events = buildRecoveredEvents(
      "s1",
      makeState({ accumulatedMessage: "Here's the answer." })
    );
    expect(events).toHaveLength(1);
    expect(events[0].actionType).toBe("assistant");
    expect(events[0].displayVariant).toBe("message");
    expect(events[0].source).toBe("assistant");
  });

  it("uses messageEventId when present", () => {
    const events = buildRecoveredEvents(
      "s1",
      makeState({
        accumulatedMessage: "x",
        messageEventId: "explicit-msg-id",
      })
    );
    expect(events[0].id).toBe("explicit-msg-id");
    expect(events[0].chunk_id).toBe("explicit-msg-id");
  });

  it("synthesizes a recovery id when messageEventId is missing", () => {
    const events = buildRecoveredEvents(
      "s1",
      makeState({ accumulatedMessage: "x" })
    );
    expect(events[0].id).toMatch(/^recovered:message:s1:/);
    expect(events[0].chunk_id).toBeNull();
  });

  it("propagates content into multiple result fields for downstream extractors", () => {
    const events = buildRecoveredEvents(
      "s1",
      makeState({ accumulatedMessage: "Hello world" })
    );
    expect(events[0].result.content).toBe("Hello world");
    expect(events[0].result.observation).toBe("Hello world");
    expect(events[0].result.role).toBe("assistant");
  });
});

describe("buildRecoveredEvents — both present", () => {
  it("produces both events with thinking first, message second", () => {
    const events = buildRecoveredEvents(
      "s1",
      makeState({
        accumulatedThinking: "Reasoning…",
        accumulatedMessage: "Answer!",
      })
    );
    expect(events).toHaveLength(2);
    expect(events[0].actionType).toBe("llm_thinking");
    expect(events[1].actionType).toBe("assistant");
  });

  it("uses lastUpdatedAt for both events' createdAt", () => {
    const events = buildRecoveredEvents(
      "s1",
      makeState({
        lastUpdatedAt: "2024-06-15T12:00:00.000Z",
        accumulatedThinking: "x",
        accumulatedMessage: "y",
      })
    );
    expect(events[0].createdAt).toBe("2024-06-15T12:00:00.000Z");
    expect(events[1].createdAt).toBe("2024-06-15T12:00:00.000Z");
  });

  it("falls back to a current ISO timestamp when lastUpdatedAt is missing", () => {
    // Simulate a malformed state where lastUpdatedAt was lost.
    const events = buildRecoveredEvents(
      "s1",
      makeState({
        // Force an empty string so the `|| now` fallback kicks in.
        lastUpdatedAt: "",
        accumulatedMessage: "x",
      })
    );
    expect(events[0].createdAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });
});

describe("buildRecoveredEvents — never throws (regression guard)", () => {
  it("does not throw on a state with degenerate optional fields", () => {
    const degenerate = makeState({
      accumulatedMessage: undefined,
      accumulatedThinking: undefined,
      messageEventId: undefined,
      thinkingEventId: undefined,
      model: undefined,
    });
    expect(() => buildRecoveredEvents("s1", degenerate)).not.toThrow();
  });

  it("does not throw on a state with only the required fields", () => {
    const minimal: PartialStreamState = {
      sessionId: "s1",
      startedAt: "now",
      lastUpdatedAt: "now",
    };
    expect(() => buildRecoveredEvents("s1", minimal)).not.toThrow();
  });
});

describe("buildRecoveredEvents — sessionId propagation", () => {
  it("uses the provided sessionId on every recovered event", () => {
    const events = buildRecoveredEvents(
      "my-special-session",
      makeState({
        accumulatedThinking: "a",
        accumulatedMessage: "b",
      })
    );
    expect(events[0].sessionId).toBe("my-special-session");
    expect(events[1].sessionId).toBe("my-special-session");
  });

  it("uses the sessionId argument even if the state has a different one", () => {
    // The state's sessionId is for the partial-cache filename; the
    // recovered events should use the CALLER's sessionId (which is
    // what the events store keys by).
    const events = buildRecoveredEvents(
      "caller-session",
      makeState({
        sessionId: "different-session",
        accumulatedMessage: "x",
      })
    );
    expect(events[0].sessionId).toBe("caller-session");
  });
});
