/**
 * fileChangeHandlers — side-channel event forwarding regression tests.
 *
 * Regression target:
 *   `agent:file_change`, `agent:setup_repo_update`, and `agent:heartbeat`
 *   are emitted by the Rust runtime but were previously dropped by the
 *   `dispatchAgentEvent` `default: break` branch. The frontend never saw
 *   them, so file edits triggered no UI refresh.
 *
 * Verified here:
 *   - each handler re-broadcasts the correct `window` CustomEvent
 *   - the event detail matches the documented shape
 *   - guard clauses (missing sessionId / empty files / missing action)
 *     suppress the broadcast instead of emitting a malformed event
 *
 * Runs under the default `node` environment, so `window` and
 * `CustomEvent` are stubbed minimally rather than relying on jsdom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentWSEvent } from "../../../shared/types";
import {
  AGENT_SIDE_CHANNEL_EVENTS,
  type AgentFileChangeDetail,
  type AgentSetupRepoUpdateDetail,
  handleFileChange,
  handleHeartbeat,
  handleSetupRepoUpdate,
} from "../fileChangeHandlers";

interface DispatchedEvent {
  type: string;
  detail: unknown;
}

const dispatched: DispatchedEvent[] = [];

/**
 * Minimal `window` + `CustomEvent` stand-ins. The handlers only ever
 * call `window.dispatchEvent(new CustomEvent(name, { detail }))`, so a
 * recording stub is enough to assert the broadcast contract.
 */
class StubCustomEvent {
  type: string;
  detail: unknown;
  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type;
    this.detail = init?.detail;
  }
}

beforeEach(() => {
  dispatched.length = 0;
  vi.stubGlobal("CustomEvent", StubCustomEvent);
  vi.stubGlobal("window", {
    dispatchEvent: (evt: StubCustomEvent) => {
      dispatched.push({ type: evt.type, detail: evt.detail });
      return true;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeEvent(overrides: Partial<AgentWSEvent>): AgentWSEvent {
  return { type: "agent:file_change", ...overrides };
}

/** Capture the detail of the broadcast for `name`, or `null` if none. */
function captureWindowEvent<T>(name: string, fire: () => void): T | null {
  fire();
  const match = dispatched.find((evt) => evt.type === name);
  return match ? (match.detail as T) : null;
}

describe("handleFileChange", () => {
  it("broadcasts agent-file-change with the documented detail shape", () => {
    const detail = captureWindowEvent<AgentFileChangeDetail>(
      AGENT_SIDE_CHANNEL_EVENTS.FILE_CHANGE,
      () => {
        handleFileChange(
          makeEvent({
            tool: "edit_file",
            files: ["/repo/a.ts", "/repo/b.ts"],
            workspacePath: "/repo",
          }),
          "agent-123"
        );
      }
    );

    expect(detail).not.toBeNull();
    expect(detail).toEqual({
      sessionId: "agent-123",
      tool: "edit_file",
      files: ["/repo/a.ts", "/repo/b.ts"],
      workspacePath: "/repo",
    });
  });

  it("falls back to toolName when tool is absent", () => {
    const detail = captureWindowEvent<AgentFileChangeDetail>(
      AGENT_SIDE_CHANNEL_EVENTS.FILE_CHANGE,
      () => {
        handleFileChange(
          makeEvent({ toolName: "write_file", files: ["/x.ts"] }),
          "s1"
        );
      }
    );
    expect(detail?.tool).toBe("write_file");
  });

  it("suppresses the broadcast when sessionId is missing", () => {
    const detail = captureWindowEvent<AgentFileChangeDetail>(
      AGENT_SIDE_CHANNEL_EVENTS.FILE_CHANGE,
      () => {
        handleFileChange(makeEvent({ files: ["/x.ts"] }), undefined);
      }
    );
    expect(detail).toBeNull();
  });

  it("suppresses the broadcast when the file list is empty", () => {
    const detail = captureWindowEvent<AgentFileChangeDetail>(
      AGENT_SIDE_CHANNEL_EVENTS.FILE_CHANGE,
      () => {
        handleFileChange(makeEvent({ files: [] }), "s1");
      }
    );
    expect(detail).toBeNull();
  });
});

describe("handleSetupRepoUpdate", () => {
  it("broadcasts agent-setup-repo-update with the action and data", () => {
    const detail = captureWindowEvent<AgentSetupRepoUpdateDetail>(
      AGENT_SIDE_CHANNEL_EVENTS.SETUP_REPO_UPDATE,
      () => {
        handleSetupRepoUpdate(
          {
            ...makeEvent({ type: "agent:setup_repo_update", action: "clone" }),
            // `data` is not on the typed AgentWSEvent superset — the Rust
            // payload nests raw params here; mirror that wire shape.
            data: { repo: "git@example.com:x.git" },
          } as AgentWSEvent,
          "s1"
        );
      }
    );
    expect(detail).toEqual({
      sessionId: "s1",
      action: "clone",
      data: { repo: "git@example.com:x.git" },
    });
  });

  it("suppresses the broadcast when action is missing", () => {
    const detail = captureWindowEvent<AgentSetupRepoUpdateDetail>(
      AGENT_SIDE_CHANNEL_EVENTS.SETUP_REPO_UPDATE,
      () => {
        handleSetupRepoUpdate(
          makeEvent({ type: "agent:setup_repo_update" }),
          "s1"
        );
      }
    );
    expect(detail).toBeNull();
  });
});

describe("handleHeartbeat", () => {
  it("broadcasts agent-heartbeat with a timestamp", () => {
    const detail = captureWindowEvent<{ sessionId: string; at: string }>(
      AGENT_SIDE_CHANNEL_EVENTS.HEARTBEAT,
      () => {
        handleHeartbeat(makeEvent({ type: "agent:heartbeat" }), "s1");
      }
    );
    expect(detail?.sessionId).toBe("s1");
    expect(typeof detail?.at).toBe("string");
    expect(Number.isNaN(Date.parse(detail?.at ?? ""))).toBe(false);
  });

  it("suppresses the broadcast when sessionId is missing", () => {
    const detail = captureWindowEvent<{ sessionId: string }>(
      AGENT_SIDE_CHANNEL_EVENTS.HEARTBEAT,
      () => {
        handleHeartbeat(makeEvent({ type: "agent:heartbeat" }), undefined);
      }
    );
    expect(detail).toBeNull();
  });
});
