import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveSession } from "@src/api/tauri/agent";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { COLLAB_IDENTITY_KIND } from "@src/store/collaboration/types";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";
import type { SessionForkedFrom } from "@src/store/session/sessionAtom/types";

import { forkSession } from "./engine/collabSyncEngineHelpers";
import type { ForkSessionResult } from "./engine/collabSyncEngineHelpers";
import {
  __FORK_RELAY_INTERNALS,
  buildForkHandoffPrompt,
  buildPendingForkHandoff,
  forkTeammateSession,
  getSessionForkedFrom,
  markForkHandoffConsumed,
} from "./forkSession";

vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: {
    getPersistedEvents: vi.fn(),
  },
}));

vi.mock("@src/api/tauri/agent", () => ({
  saveSession: vi.fn(),
}));

vi.mock("./engine/collabSyncEngineHelpers", () => ({
  forkSession: vi.fn(),
}));

const eventStoreMock = vi.mocked(eventStoreProxy);
const saveSessionMock = vi.mocked(saveSession);
const forkSessionMock = vi.mocked(forkSession);

const FORK_RESULT: ForkSessionResult = {
  localSessionId: "agentsession-fork-1",
  name: "⑂ Remote session",
  eventCount: 2,
};

function makeRemote(
  overrides: Partial<RemoteTeammateSessionMetadata> = {}
): RemoteTeammateSessionMetadata {
  return {
    id: "org-1:m2:remote-1",
    orgId: "org-1",
    ownerMemberId: "m2",
    ownerUserId: "m2",
    ownerDisplayName: "Bob",
    ownerIdentityKind: COLLAB_IDENTITY_KIND.HUMAN,
    sourceSessionId: "remote-1",
    title: "Remote session",
    repoPath: "/repo/shared",
    lastActivityAt: "2026-07-01T00:00:00.000Z",
    eventsEpoch: 1,
    eventsFrozenSeq: 1,
    eventsCount: 2,
    eventsTailHash: undefined,
    ...overrides,
  };
}

function makeForkOptions(
  overrides: Partial<RemoteTeammateSessionMetadata> = {}
) {
  return {
    client: { getSessionEventSegments: vi.fn() },
    profile: { supabaseUrl: "https://team.supabase.co", anonKey: "k" },
    orgId: "org-1",
    remoteSession: makeRemote(overrides),
  };
}

function makeEvent(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    id: "e1",
    sessionId: "agentsession-fork-1",
    createdAt: "2026-07-01T00:00:00.000Z",
    functionName: "assistant_message",
    actionType: "assistant",
    source: "assistant",
    displayText: "hello from the teammate",
    displayStatus: "completed",
    args: {},
    result: {},
    ...overrides,
  } as unknown as SessionEvent;
}

const FORKED_FROM: SessionForkedFrom = {
  orgId: "org-1",
  sourceSessionId: "remote-1",
  ownerMemberId: "m2",
  ownerDisplayName: "Bob",
  atCount: 2,
  forkedAt: "2026-07-02T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem(__FORK_RELAY_INTERNALS.FORK_RELAY_STORAGE_KEY);
  forkSessionMock.mockResolvedValue(FORK_RESULT);
  saveSessionMock.mockResolvedValue(undefined);
  eventStoreMock.getPersistedEvents.mockResolvedValue([]);
});

describe("forkTeammateSession (design §16.11 relay completion)", () => {
  it("registers a REAL backend row so the fork is dispatchable and reload-proof", async () => {
    const result = await forkTeammateSession(makeForkOptions());

    expect(result).toEqual(FORK_RESULT);
    expect(saveSessionMock).toHaveBeenCalledTimes(1);
    const record = saveSessionMock.mock.calls[0][0] as unknown as Record<
      string,
      unknown
    >;
    expect(record.sessionId).toBe("agentsession-fork-1");
    expect(record.name).toBe("⑂ Remote session");
    expect(record.workspacePath).toBe("/repo/shared");
    // agentsession-* has no builtin prefix mapping in agent-core — the
    // persisted definition id is what makes the lazy init_session on the
    // first agent_send_message resolve an agent at all.
    expect(record.agentDefinitionId).toBe("builtin:sde");
    // UnifiedSessionRecord requires session_type (passed via the SessionMeta
    // schema catchall); "sde" = coding session.
    expect(record.sessionType).toBe("sde");
  });

  it("records durable provenance readable through getSessionForkedFrom", async () => {
    await forkTeammateSession(makeForkOptions());

    // A bare backend-rebuilt row (no forkedFrom field — list reloads drop
    // TS-only fields) still resolves its provenance from the registry.
    const provenance = getSessionForkedFrom({
      session_id: "agentsession-fork-1",
    });
    expect(provenance).toMatchObject({
      orgId: "org-1",
      sourceSessionId: "remote-1",
      ownerMemberId: "m2",
      ownerDisplayName: "Bob",
      atCount: 2,
    });
  });

  it("prefers the live Session.forkedFrom field over the registry", async () => {
    await forkTeammateSession(makeForkOptions());
    const rowField: SessionForkedFrom = { ...FORKED_FROM, atCount: 99 };
    expect(
      getSessionForkedFrom({
        session_id: "agentsession-fork-1",
        forkedFrom: rowField,
      })
    ).toBe(rowField);
  });

  it("returns null (and registers nothing) when the engine fork has nothing to inherit", async () => {
    forkSessionMock.mockResolvedValueOnce(null);

    const result = await forkTeammateSession(makeForkOptions());

    expect(result).toBeNull();
    expect(saveSessionMock).not.toHaveBeenCalled();
    expect(
      getSessionForkedFrom({ session_id: "agentsession-fork-1" })
    ).toBeUndefined();
  });

  it("throws when backend registration fails and does NOT arm the handoff", async () => {
    saveSessionMock.mockRejectedValueOnce(new Error("ipc down"));

    await expect(forkTeammateSession(makeForkOptions())).rejects.toThrow(
      "ipc down"
    );
    // A fork that cannot be dispatched must not look armed/complete.
    expect(
      await buildPendingForkHandoff("agentsession-fork-1", "go on")
    ).toBeNull();
    expect(
      getSessionForkedFrom({ session_id: "agentsession-fork-1" })
    ).toBeUndefined();
  });

  it("survives a corrupt registry payload (provenance is best-effort)", async () => {
    localStorage.setItem(
      __FORK_RELAY_INTERNALS.FORK_RELAY_STORAGE_KEY,
      "{not json"
    );
    const result = await forkTeammateSession(makeForkOptions());
    expect(result).toEqual(FORK_RESULT);
    expect(
      getSessionForkedFrom({ session_id: "agentsession-fork-1" })
    ).toBeDefined();
  });
});

describe("first-send handoff (LLM context continuity)", () => {
  it("wraps the first send with the inherited digest and keeps the user's words as displayText", async () => {
    await forkTeammateSession(makeForkOptions());
    eventStoreMock.getPersistedEvents.mockResolvedValue([
      makeEvent({
        id: "u1",
        source: "user",
        actionType: "user_message",
        displayText: "please fix the login bug",
      }),
      makeEvent({
        id: "t1",
        actionType: "tool_call",
        functionName: "edit_file",
        displayText: "",
        args: { text: "patch auth.ts" },
        result: { content: "file updated" },
      }),
    ]);

    const handoff = await buildPendingForkHandoff(
      "agentsession-fork-1",
      "continue where Bob left off"
    );

    expect(handoff).not.toBeNull();
    expect(handoff!.displayText).toBe("continue where Bob left off");
    expect(handoff!.content).toContain("taking over a teammate's shared");
    expect(handoff!.content).toContain("Original owner: Bob");
    expect(handoff!.content).toContain("User: please fix the login bug");
    expect(handoff!.content).toContain("Tool: edit_file");
    expect(handoff!.content).toContain("Input: patch auth.ts");
    expect(handoff!.content).toContain("Result at that time: file updated");
    expect(handoff!.content).toContain("continue where Bob left off");
  });

  it("is one-shot: consumed after a successful send, durable until then", async () => {
    await forkTeammateSession(makeForkOptions());

    // Not consumed yet — a failed send may retry with the handoff intact.
    expect(
      await buildPendingForkHandoff("agentsession-fork-1", "first try")
    ).not.toBeNull();
    expect(
      await buildPendingForkHandoff("agentsession-fork-1", "retry")
    ).not.toBeNull();

    markForkHandoffConsumed("agentsession-fork-1");
    expect(
      await buildPendingForkHandoff("agentsession-fork-1", "second message")
    ).toBeNull();
    // Provenance outlives the handoff.
    expect(
      getSessionForkedFrom({ session_id: "agentsession-fork-1" })
    ).toBeDefined();
  });

  it("returns null for non-forked sessions without touching the event store", async () => {
    expect(
      await buildPendingForkHandoff("sdeagent-ordinary", "hello")
    ).toBeNull();
    expect(eventStoreMock.getPersistedEvents).not.toHaveBeenCalled();
  });

  it("slices to the fork point so the just-typed user event is not doubled into the digest", async () => {
    await forkTeammateSession(makeForkOptions()); // atCount = 2
    eventStoreMock.getPersistedEvents.mockResolvedValue([
      makeEvent({ id: "e1", displayText: "inherited one" }),
      makeEvent({ id: "e2", displayText: "inherited two" }),
      // Appended by the composer before dispatch — NOT inherited history.
      makeEvent({
        id: "e3",
        source: "user",
        actionType: "user_message",
        displayText: "my brand new message",
      }),
    ]);

    const handoff = await buildPendingForkHandoff(
      "agentsession-fork-1",
      "my brand new message"
    );
    expect(handoff!.content).toContain("inherited one");
    expect(handoff!.content).toContain("inherited two");
    // Present once as the continuation request, not also as transcript.
    expect(handoff!.content).not.toContain("User: my brand new message");
  });
});

describe("buildForkHandoffPrompt", () => {
  it("skips thinking/reasoning events and truncates long item text", () => {
    const longText = "x".repeat(
      __FORK_RELAY_INTERNALS.MAX_ITEM_TEXT_LENGTH + 100
    );
    const prompt = buildForkHandoffPrompt(
      [
        makeEvent({
          id: "think",
          actionType: "llm_thinking",
          displayText: "SECRET internal monologue",
        }),
        makeEvent({ id: "long", displayText: longText }),
      ],
      FORKED_FROM,
      "carry on"
    );

    expect(prompt).not.toContain("SECRET internal monologue");
    expect(prompt).toContain("…");
    expect(prompt).not.toContain(longText);
    expect(prompt).toContain("carry on");
  });

  it("caps the digest at MAX_HANDOFF_ITEMS keeping the most recent items", () => {
    const events = Array.from(
      { length: __FORK_RELAY_INTERNALS.MAX_HANDOFF_ITEMS + 10 },
      (_unused, index) =>
        makeEvent({ id: `e${index}`, displayText: `item number ${index}` })
    );
    const prompt = buildForkHandoffPrompt(events, FORKED_FROM, "go");
    expect(prompt).not.toContain("item number 0\n");
    expect(prompt).toContain(
      `item number ${__FORK_RELAY_INTERNALS.MAX_HANDOFF_ITEMS + 9}`
    );
  });

  it("states the fallback when no usable transcript items exist", () => {
    const prompt = buildForkHandoffPrompt([], FORKED_FROM, "go");
    expect(prompt).toContain("No usable transcript items were found.");
  });
});
