/**
 * IDE simulator config: event matching and deriveIDEState.
 */
import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { deriveIDEState, matchesIDEEvent } from "../config";

function minimalSessionEvent(
  overrides: Partial<SessionEvent> = {}
): SessionEvent {
  return {
    chunk_id: null,
    id: "evt-1",
    sessionId: "sess-1",
    createdAt: "2026-03-29T12:00:00.000Z",
    functionName: "read_file",
    uiCanonical: "",
    actionType: "tool_call",
    args: {},
    result: {},
    source: "assistant",
    displayText: "",
    displayStatus: "completed",
    displayVariant: "tool_call",
    activityStatus: "agent",
    ...overrides,
  };
}

describe("matchesIDEEvent", () => {
  it("matches file, shell, and explore tool names from fixtures", () => {
    expect(matchesIDEEvent("read_file")).toBe(true);
    expect(matchesIDEEvent("run_shell")).toBe(true);
    expect(matchesIDEEvent("code_search")).toBe(true);
  });

  it("does not match pure channel-only tools", () => {
    expect(matchesIDEEvent("send_message")).toBe(false);
  });
});

describe("deriveIDEState", () => {
  it("collects file operations and sets file view mode from current event", () => {
    const read = minimalSessionEvent({
      id: "r1",
      functionName: "read_file",
      args: { path: "/repo/a.ts" },
      result: {
        success: {
          path: "/repo/a.ts",
          content: "x",
        },
      },
    });

    const state = deriveIDEState([read], "r1");
    expect(state.fileOperations.length).toBe(1);
    expect(state.fileViewMode).toBe("explore");
    expect(state.selectedFileOperation?.eventId).toBe("r1");
  });
});
