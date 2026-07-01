import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  collabChatMessagesAtom,
  collabConnectionStatesAtom,
  collabInvitesAtom,
  collabLastSyncTimestampsAtom,
  collabMembersAtom,
  collabOrgsAtom,
  collabPendingOpenSessionAtom,
  collabProjectsAtom,
  collabRepoJoinRequestsAtom,
  collabSessionAccessSettingsAtom,
  collabSessionSnapshotRequestsAtom,
  collabWorkItemsAtom,
  remoteTeammateSessionsAtom,
} from "@src/store/collaboration/collabOrgsAtom";
import {
  COLLAB_IDENTITY_KIND,
  COLLAB_ROLE,
  COLLAB_SESSION_ACCESS_MODE,
  COLLAB_SYNC_BACKEND,
  COLLAB_WORKSPACE_SCOPE,
} from "@src/store/collaboration/types";
import type {
  CollabMemberRecord,
  CollabOrgRecord,
  CollabSessionAccessMode,
  CollabSessionAccessSettings,
  RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";
import { sessionsAtom } from "@src/store/session/sessionAtom/atoms";
import type { Session } from "@src/store/session/sessionAtom/types";
import { createInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import type { CollabOrgState } from "../sync/CollabSyncBackend";
import { supabaseSyncClient } from "../sync/supabaseSyncClient";
import { CollabSyncEngine } from "./CollabSyncEngine";

vi.mock("../sync/supabaseSyncClient", () => ({
  supabaseSyncClient: {
    verifySetup: vi.fn(),
    listOrgState: vi.fn(),
    upsertSessionMetadata: vi.fn(),
    removeSessionMetadata: vi.fn(),
    upsertSessionEvents: vi.fn(),
    downloadSessionEventsBlob: vi.fn(),
    requestSessionSnapshot: vi.fn(),
    publishSessionSnapshot: vi.fn(),
    denySessionSnapshot: vi.fn(),
  },
}));

vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: {
    subscribe: vi.fn(),
    getEvents: vi.fn(),
    set: vi.fn(),
    saveToCache: vi.fn(),
  },
}));

const syncMock = vi.mocked(supabaseSyncClient);
const eventStoreMock = vi.mocked(eventStoreProxy);

const REPO_PATH = "/repo/alpha";

const ORG: CollabOrgRecord = {
  id: "org-1",
  name: "Team",
  syncBackend: COLLAB_SYNC_BACKEND.SUPABASE,
  supabaseUrl: "https://team.supabase.co",
  supabaseAnonKey: "anon-key",
  memberToken: "member-token-1",
  localMemberId: "m1",
  repoScopes: [REPO_PATH],
  createdAt: "2026-06-01T00:00:00.000Z",
};

const LOCAL_MEMBER: CollabMemberRecord = {
  id: "m1",
  orgId: "org-1",
  displayName: "Me",
  avatar: { initials: "M", variant: "v1" },
  role: COLLAB_ROLE.ADMIN,
  identityKind: COLLAB_IDENTITY_KIND.HUMAN,
  joinedAt: "2026-06-01T00:00:00.000Z",
};

const LOCAL_SESSION: Session = {
  session_id: "session-1",
  status: "completed",
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
  name: "Local session",
  repoPath: REPO_PATH,
  category: "rust_agent",
};

function accessSettings(
  accessMode: CollabSessionAccessMode
): CollabSessionAccessSettings {
  return {
    orgId: "org-1",
    memberId: "m1",
    accessMode,
    workspaceScope: COLLAB_WORKSPACE_SCOPE.SELECTED_WORKSPACES,
    workspacePaths: [],
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

function emptyOrgState(): CollabOrgState {
  return {
    serverTime: new Date().toISOString(),
    orgs: [],
    members: [],
    invites: [],
    projects: [],
    workItems: [],
    sessions: [],
    chatMessages: [],
    repoJoinRequests: [],
    snapshotRequests: [],
  };
}

function remoteSession(
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
    repoPath: REPO_PATH,
    lastActivityAt: "2026-07-01T00:00:00.000Z",
    eventsBlobPath: undefined,
    eventsContentHash: undefined,
    eventsUpdatedAt: undefined,
    ...overrides,
  };
}

function makeEvent(id: string): SessionEvent {
  return { id, sessionId: "session-1" } as unknown as SessionEvent;
}

/**
 * Yield real macrotask turns so already-resolved mock promises and real
 * async work (crypto.subtle in sha256Hex) settle between faked timer steps.
 * setImmediate is intentionally NOT faked (see toFake below).
 */
async function settle(turns = 10): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function fireEventStoreChange(sessionId: string): void {
  const subscribeCalls = eventStoreMock.subscribe.mock.calls;
  expect(subscribeCalls.length).toBeGreaterThan(0);
  const listener = subscribeCalls[subscribeCalls.length - 1][0] as (
    snapshot: unknown,
    sessionId: string
  ) => void;
  listener({}, sessionId);
}

describe("CollabSyncEngine", () => {
  const store = createInstrumentedStore();
  let engine: CollabSyncEngine;

  function resetAtoms(): void {
    store.set(collabOrgsAtom, []);
    store.set(collabMembersAtom, []);
    store.set(collabInvitesAtom, []);
    store.set(collabProjectsAtom, []);
    store.set(collabWorkItemsAtom, []);
    store.set(collabConnectionStatesAtom, []);
    store.set(collabChatMessagesAtom, []);
    store.set(collabSessionAccessSettingsAtom, []);
    store.set(collabSessionSnapshotRequestsAtom, []);
    store.set(collabRepoJoinRequestsAtom, []);
    store.set(remoteTeammateSessionsAtom, []);
    store.set(collabLastSyncTimestampsAtom, {});
    store.set(collabPendingOpenSessionAtom, null);
    store.set(sessionsAtom, []);
  }

  function seedConnection(
    accessMode: CollabSessionAccessMode = COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY
  ): void {
    store.set(collabOrgsAtom, [ORG]);
    store.set(collabMembersAtom, [LOCAL_MEMBER]);
    store.set(collabSessionAccessSettingsAtom, [accessSettings(accessMode)]);
  }

  beforeEach(() => {
    vi.resetAllMocks();
    // setImmediate stays real so `settle()` can drain genuinely async work
    // (crypto.subtle) while setTimeout/Date advance under test control.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    syncMock.verifySetup.mockResolvedValue({
      ok: true,
      schemaVersion: 2,
      missing: [],
    });
    syncMock.listOrgState.mockImplementation(async () => emptyOrgState());
    syncMock.upsertSessionMetadata.mockResolvedValue(undefined);
    syncMock.removeSessionMetadata.mockResolvedValue(undefined);
    syncMock.upsertSessionEvents.mockResolvedValue(undefined);
    syncMock.downloadSessionEventsBlob.mockResolvedValue([]);
    syncMock.requestSessionSnapshot.mockResolvedValue(undefined);
    syncMock.publishSessionSnapshot.mockResolvedValue(undefined);
    syncMock.denySessionSnapshot.mockResolvedValue(undefined);
    eventStoreMock.subscribe.mockImplementation(() => () => {});
    eventStoreMock.getEvents.mockResolvedValue([]);
    eventStoreMock.set.mockResolvedValue(undefined);
    eventStoreMock.saveToCache.mockResolvedValue(0);

    resetAtoms();
    engine = new CollabSyncEngine();
  });

  afterEach(() => {
    engine.stop();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("schedules the next pull after completion with 5/15/60s error backoff, resets on success, and verifies setup once", async () => {
    seedConnection();
    syncMock.listOrgState.mockRejectedValue(new Error("boom"));

    engine.start(store);
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(syncMock.listOrgState).toHaveBeenCalledTimes(1);

    // First failure → retry after 5s.
    await vi.advanceTimersByTimeAsync(4_999);
    await settle();
    expect(syncMock.listOrgState).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(syncMock.listOrgState).toHaveBeenCalledTimes(2);

    // Second failure → 15s.
    await vi.advanceTimersByTimeAsync(14_999);
    await settle();
    expect(syncMock.listOrgState).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(syncMock.listOrgState).toHaveBeenCalledTimes(3);

    // Third failure → capped at 60s; flip to success before it fires.
    syncMock.listOrgState.mockImplementation(async () => emptyOrgState());
    engine.notifyActivity();
    await vi.advanceTimersByTimeAsync(59_999);
    await settle();
    expect(syncMock.listOrgState).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(syncMock.listOrgState).toHaveBeenCalledTimes(4);

    // Success resets the backoff → active cadence (5s) again.
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    expect(syncMock.listOrgState).toHaveBeenCalledTimes(5);

    // verifySetup ran once per org per engine start, not per cycle (M2).
    expect(syncMock.verifySetup).toHaveBeenCalledTimes(1);
  });

  it("drops to 60s cadence when idle and returns to 5s after notifyActivity", async () => {
    seedConnection();

    engine.start(store);
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(syncMock.listOrgState).toHaveBeenCalledTimes(1);

    // Idle (no focus, no activity): 5s later nothing fires...
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    expect(syncMock.listOrgState).toHaveBeenCalledTimes(1);
    // ...the next pull lands on the 60s idle cadence.
    await vi.advanceTimersByTimeAsync(55_000);
    await settle();
    expect(syncMock.listOrgState).toHaveBeenCalledTimes(2);

    // Activity: the next completed cycle reschedules at 5s.
    engine.notifyActivity();
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(syncMock.listOrgState).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    expect(syncMock.listOrgState).toHaveBeenCalledTimes(4);
  });

  it("keeps zero subscriptions and zero timers with no active connections", async () => {
    engine.start(store);
    await settle();

    expect(eventStoreMock.subscribe).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(120_000);
    await settle();
    expect(syncMock.listOrgState).not.toHaveBeenCalled();
    expect(syncMock.verifySetup).not.toHaveBeenCalled();
  });

  it("gates metadata pushes on the metadata hash", async () => {
    seedConnection();
    store.set(sessionsAtom, [LOCAL_SESSION]);

    engine.start(store);
    await settle();
    expect(syncMock.upsertSessionMetadata).toHaveBeenCalledTimes(1);

    // Same metadata again (new array identity) → hash gate holds the push.
    store.set(sessionsAtom, [{ ...LOCAL_SESSION }]);
    await vi.advanceTimersByTimeAsync(3_000);
    await settle();
    expect(syncMock.upsertSessionMetadata).toHaveBeenCalledTimes(1);

    // Changed title → second push.
    store.set(sessionsAtom, [{ ...LOCAL_SESSION, name: "Renamed session" }]);
    await vi.advanceTimersByTimeAsync(3_000);
    await settle();
    expect(syncMock.upsertSessionMetadata).toHaveBeenCalledTimes(2);
  });

  it("tombstones an OFF session exactly once across sweeps", async () => {
    seedConnection(COLLAB_SESSION_ACCESS_MODE.OFF);
    store.set(sessionsAtom, [LOCAL_SESSION]);

    engine.start(store);
    await settle();
    expect(syncMock.removeSessionMetadata).toHaveBeenCalledTimes(1);

    store.set(sessionsAtom, [{ ...LOCAL_SESSION }]);
    await vi.advanceTimersByTimeAsync(3_000);
    await settle();
    expect(syncMock.removeSessionMetadata).toHaveBeenCalledTimes(1);
    expect(syncMock.upsertSessionMetadata).not.toHaveBeenCalled();
  });

  it("re-runs a push that arrives while one is in flight instead of dropping it", async () => {
    seedConnection();
    store.set(sessionsAtom, [LOCAL_SESSION]);
    eventStoreMock.getEvents
      .mockResolvedValueOnce([makeEvent("e1")])
      .mockResolvedValueOnce([makeEvent("e1"), makeEvent("e2")]);
    let resolveFirstEventsPush!: () => void;
    syncMock.upsertSessionEvents.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstEventsPush = resolve;
        })
    );

    engine.start(store);
    await settle();

    fireEventStoreChange("session-1");
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(30);
    expect(syncMock.upsertSessionEvents).toHaveBeenCalledTimes(1);

    // A flush during the in-flight push must not be dropped.
    fireEventStoreChange("session-1");
    await vi.advanceTimersByTimeAsync(3_000);
    await settle();
    expect(syncMock.upsertSessionEvents).toHaveBeenCalledTimes(1);

    resolveFirstEventsPush();
    await settle(30);
    expect(syncMock.upsertSessionEvents).toHaveBeenCalledTimes(2);
    expect(syncMock.upsertSessionEvents.mock.calls[0][0].events).toHaveLength(
      1
    );
    expect(syncMock.upsertSessionEvents.mock.calls[1][0].events).toHaveLength(
      2
    );
  });

  it("never lets member inference overwrite an existing member record", async () => {
    seedConnection();
    const adminTeammate: CollabMemberRecord = {
      id: "m2",
      orgId: "org-1",
      displayName: "Admin Bob",
      avatar: { initials: "AB", variant: "v2" },
      role: COLLAB_ROLE.ADMIN,
      identityKind: COLLAB_IDENTITY_KIND.HUMAN,
      joinedAt: "2026-06-02T00:00:00.000Z",
    };
    store.set(collabMembersAtom, [LOCAL_MEMBER, adminTeammate]);
    syncMock.listOrgState.mockImplementation(async () => ({
      ...emptyOrgState(),
      sessions: [remoteSession({ ownerDisplayName: "bob-inferred" })],
      chatMessages: [
        {
          id: "chat-1",
          orgId: "org-1",
          authorMemberId: "m3",
          authorDisplayName: "Carol",
          authorIdentityKind: COLLAB_IDENTITY_KIND.HUMAN,
          body: "hello",
          createdAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    }));

    engine.start(store);
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    const members = store.get(collabMembersAtom);
    const teammate = members.find((member) => member.id === "m2");
    expect(teammate?.role).toBe(COLLAB_ROLE.ADMIN);
    expect(teammate?.displayName).toBe("Admin Bob");
    // Unknown members are still backfilled.
    const inferred = members.find((member) => member.id === "m3");
    expect(inferred?.role).toBe(COLLAB_ROLE.MEMBER);
    expect(inferred?.displayName).toBe("Carol");
  });

  it("removes tombstoned sessions from remoteTeammateSessionsAtom", async () => {
    seedConnection();
    const existing = remoteSession();
    store.set(remoteTeammateSessionsAtom, [existing]);
    syncMock.listOrgState.mockImplementation(async () => ({
      ...emptyOrgState(),
      sessions: [{ ...existing, deletedAt: "2026-07-01T11:59:00.000Z" }],
    }));

    engine.start(store);
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    expect(store.get(remoteTeammateSessionsAtom)).toHaveLength(0);
  });

  it("never pushes sessions the engine itself imported", async () => {
    seedConnection();
    const remote = remoteSession({
      eventsBlobPath: "blobs/remote-1",
      eventsContentHash: "hash-1",
    });
    syncMock.listOrgState
      .mockImplementationOnce(async () => ({
        ...emptyOrgState(),
        sessions: [remote],
      }))
      .mockImplementation(async () => emptyOrgState());
    syncMock.downloadSessionEventsBlob.mockResolvedValue([makeEvent("e1")]);

    engine.start(store);
    await vi.advanceTimersByTimeAsync(0);
    await settle(20);

    expect(eventStoreMock.set).toHaveBeenCalledTimes(1);
    const localSessionId = eventStoreMock.set.mock.calls[0][1] as string;
    expect(localSessionId).toMatch(/^imported-session-/);
    const imported = store
      .get(sessionsAtom)
      .find((session) => session.session_id === localSessionId);
    expect(imported?.category).toBe("external_history");

    // The import's own eventStore write re-enters the push subscription —
    // the imported id must never round-trip back out.
    fireEventStoreChange(localSessionId);
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(20);
    expect(syncMock.upsertSessionEvents).not.toHaveBeenCalled();
  });
});
