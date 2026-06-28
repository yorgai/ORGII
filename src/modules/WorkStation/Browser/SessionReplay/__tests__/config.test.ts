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

  it("keeps internal browser entries without the legacy webview arg", () => {
    const event = makeEvent({
      functionName: "control_internal_browser",
      uiCanonical: "control_internal_browser",
      args: { action: "click", index: 3 },
      result: JSON.stringify({
        success: true,
        action: "click",
        target: {
          browserSessionId: "session-browser-1",
          label: "browser-session-session-browser-1",
        },
        beforeUrl: "https://example.com",
        actualUrl: "https://example.com/next",
        actualUrlChanged: true,
        message: "Clicked Next",
        result: {
          success: true,
          message: "Clicked Next",
        },
      }) as unknown as Record<string, unknown>,
    });

    const state = deriveBrowserState([event], event.id);
    const entry = state.activeInternalEntry;

    expect(state.activeSubtool).toBe("internal_browser");
    expect(state.internalBrowserEntries).toHaveLength(1);
    expect(entry?.webviewLabel).toBe("browser-session-session-browser-1");
    expect(entry?.browserSessionId).toBe("session-browser-1");
    expect(entry?.success).toBe(true);
    expect(entry?.actualUrlChanged).toBe(true);
  });
});
