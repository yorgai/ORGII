import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { deriveBrowserState } from "../config";

function makeEvent(overrides: Partial<SessionEvent>): SessionEvent {
  return {
    chunk_id: null,
    id: "event-1",
    sessionId: "session-1",
    createdAt: "2026-05-20T00:00:00.000Z",
    functionName: "control_browser_with_agent_browser",
    uiCanonical: "control_browser_with_agent_browser",
    actionType: "tool_call",
    args: {},
    result: {},
    source: "assistant",
    displayText: "",
    displayStatus: "completed",
    displayVariant: "tool_call",
    activityStatus: "processed",
    ...overrides,
  };
}

describe("deriveBrowserState", () => {
  it("formats raw Agent Browser CLI commands like chat panel rows", () => {
    const event = makeEvent({
      args: { command: "open https://example.com" },
      result: { url: "https://example.com" },
    });

    const state = deriveBrowserState([event], event.id);

    expect(state.activeEntry?.title).toBe("Open Page");
    expect(state.activeEntry?.subtitle).toBe("https://example.com");
  });

  it("formats raw Agent Browser CLI click commands as parsed actions", () => {
    const event = makeEvent({
      args: { command: "click e20" },
    });

    const state = deriveBrowserState([event], event.id);

    expect(state.activeEntry?.title).toBe("Click");
    expect(state.activeEntry?.subtitle).toBe("e20");
  });

  it("formats raw Playwright CLI commands like chat panel rows", () => {
    const event = makeEvent({
      functionName: "control_browser_with_playwright",
      uiCanonical: "control_browser_with_playwright",
      args: { command: "snapshot" },
    });

    const state = deriveBrowserState([event], event.id);

    expect(state.activeEntry?.title).toBe("Snapshot Page");
    expect(state.activeEntry?.subtitle).toBe("snapshot");
  });
});
