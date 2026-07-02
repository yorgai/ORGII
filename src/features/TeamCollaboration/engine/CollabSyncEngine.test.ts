import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type {
  EventDisplayStatus,
  SessionEvent,
} from "@src/engines/SessionCore/core/types";
import {
  collabChatMessagesAtom,
  collabConnectionStatesAtom,
  collabInvitesAtom,
  collabLastSyncTimestampsAtom,
  collabMembersAtom,
  collabOrgsAtom,
  collabPendingOpenSessionAtom,
  collabPublishedSessionKeysAtom,
  collabRepoJoinRequestsAtom,
  collabSessionAccessSettingsAtom,
  collabSessionPushCursorsAtom,
  collabSessionSnapshotRequestsAtom,
  remoteTeammateSessionsAtom,
} from "@src/store/collaboration/collabOrgsAtom";
import {
  COLLAB_CONNECTION_STATUS,
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
import { tauriProjectSyncBridge } from "./projectSyncBridge";

vi.mock("../sync/supabaseSyncClient", () => ({
  supabaseSyncClient: {
    verifySetup: vi.fn(),
    listOrgState: vi.fn(),
    upsertSessionMetadata: vi.fn(),
    removeSessionMetadata: vi.fn(),
    appendSessionEvents: vi.fn(),
    rewriteSessionEvents: vi.fn(),
    getSessionEventSegments: vi.fn(),
    gcSessionEventSegments: vi.fn(),
    requestSessionSnapshot: vi.fn(),
    publishSessionSnapshot: vi.fn(),
    denySessionSnapshot: vi.fn(),
  },
}));

vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: {
    subscribe: vi.fn(),
    getEvents: vi.fn(),
    getPersistedEvents: vi.fn(),
    set: vi.fn(),
    saveToCache: vi.fn(),
    clear: vi.fn(),
  },
}));

// ProjectSyncChannel's Tauri bridge (design §16.8): the engine tests only
// need the channel to be a well-behaved no-op — ProjectSyncChannel.test.ts
// covers the drain/push/ack/apply protocol itself.
vi.mock("./projectSyncBridge", () => ({
  tauriProjectSyncBridge: {
    drainOutbox: vi.fn(async () => []),
    ackOutbox: vi.fn(async () => undefined),
    applyRemote: vi.fn(async () => 0),
    notifyDataChanged: vi.fn(async () => undefined),
  },
}));

const syncMock = vi.mocked(supabaseSyncClient);
const eventStoreMock = vi.mocked(eventStoreProxy);
const bridgeMock = vi.mocked(tauriProjectSyncBridge);

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
    eventsEpoch: undefined,
    eventsFrozenSeq: undefined,
    eventsCount: undefined,
    eventsTailHash: undefined,
    ...overrides,
  };
}

function makeEvent(
  id: string,
  displayStatus: EventDisplayStatus = "completed",
  extra: Record<string, unknown> = {}
): SessionEvent {
  return {
    id,
    sessionId: "session-1",
    displayStatus,
    ...extra,
  } as unknown as SessionEvent;
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
    store.set(collabConnectionStatesAtom, []);
    store.set(collabChatMessagesAtom, []);
    store.set(collabSessionAccessSettingsAtom, []);
    store.set(collabSessionSnapshotRequestsAtom, []);
    store.set(collabRepoJoinRequestsAtom, []);
    store.set(remoteTeammateSessionsAtom, []);
    store.set(collabLastSyncTimestampsAtom, {});
    store.set(collabSessionPushCursorsAtom, {});
    store.set(collabPublishedSessionKeysAtom, {});
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
    syncMock.appendSessionEvents.mockResolvedValue(undefined);
    syncMock.rewriteSessionEvents.mockResolvedValue(undefined);
    syncMock.getSessionEventSegments.mockResolvedValue({
      epoch: null,
      frozenSeq: null,
      tailHash: null,
      count: null,
      segments: [],
    });
    syncMock.gcSessionEventSegments.mockResolvedValue(0);
    syncMock.requestSessionSnapshot.mockResolvedValue(undefined);
    syncMock.publishSessionSnapshot.mockResolvedValue(undefined);
    syncMock.denySessionSnapshot.mockResolvedValue(undefined);
    eventStoreMock.subscribe.mockImplementation(() => () => {});
    eventStoreMock.getEvents.mockResolvedValue([]);
    eventStoreMock.getPersistedEvents.mockResolvedValue([]);
    eventStoreMock.set.mockResolvedValue(undefined);
    eventStoreMock.clear.mockResolvedValue(undefined);
    // es_save_to_cache returns the number of events durably persisted (0 on a
    // failed/empty write). Mirror that: report the count of the most recent
    // set() so a successful import reports > 0 and the failure path can be
    // driven by overriding to 0.
    eventStoreMock.saveToCache.mockImplementation(async () => {
      const lastSet = eventStoreMock.set.mock.calls.at(-1);
      const events = lastSet?.[0] as unknown[] | undefined;
      return events?.length ?? 0;
    });
    // resetAllMocks wipes the module-mock implementations — re-arm the
    // ProjectSyncChannel bridge as a well-behaved no-op every test.
    bridgeMock.drainOutbox.mockResolvedValue([]);
    bridgeMock.ackOutbox.mockResolvedValue(undefined);
    bridgeMock.applyRemote.mockResolvedValue(0);
    bridgeMock.notifyDataChanged.mockResolvedValue(undefined);

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

  it("re-pushes metadata when status, branch, or lastActivityAt change, but not on a repoPath-only move", async () => {
    // Both repo paths are in this org's scope, so the repoPath-only move below
    // keeps the session push-allowed (it does not leave scope and tombstone) —
    // isolating repoPath as the only differing field.
    store.set(collabOrgsAtom, [
      { ...ORG, repoScopes: [REPO_PATH, "/repo/moved"] },
    ]);
    store.set(collabMembersAtom, [LOCAL_MEMBER]);
    store.set(collabSessionAccessSettingsAtom, [
      accessSettings(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY),
    ]);
    store.set(sessionsAtom, [LOCAL_SESSION]);

    engine.start(store);
    await settle();
    expect(syncMock.upsertSessionMetadata).toHaveBeenCalledTimes(1);

    // status is a hashed field → a status change re-pushes.
    store.set(sessionsAtom, [{ ...LOCAL_SESSION, status: "running" }]);
    await vi.advanceTimersByTimeAsync(3_000);
    await settle();
    expect(syncMock.upsertSessionMetadata).toHaveBeenCalledTimes(2);

    // branch is hashed → a branch change re-pushes (keep the new status so
    // only branch differs from the previous push).
    store.set(sessionsAtom, [
      { ...LOCAL_SESSION, status: "running", branch: "feat/x" },
    ]);
    await vi.advanceTimersByTimeAsync(3_000);
    await settle();
    expect(syncMock.upsertSessionMetadata).toHaveBeenCalledTimes(3);

    // lastActivityAt (updated_at) is hashed but bucketed to the minute — a
    // move of a full minute crosses the bucket boundary and re-pushes.
    store.set(sessionsAtom, [
      {
        ...LOCAL_SESSION,
        status: "running",
        branch: "feat/x",
        updated_at: "2026-07-01T00:01:00.000Z",
      },
    ]);
    await vi.advanceTimersByTimeAsync(3_000);
    await settle();
    expect(syncMock.upsertSessionMetadata).toHaveBeenCalledTimes(4);

    // repoPath is INTENTIONALLY excluded from the metadata hash (a local path
    // move is not a wire-record change) → no re-push, everything else equal.
    store.set(sessionsAtom, [
      {
        ...LOCAL_SESSION,
        status: "running",
        branch: "feat/x",
        updated_at: "2026-07-01T00:01:00.000Z",
        repoPath: "/repo/moved",
      },
    ]);
    await vi.advanceTimersByTimeAsync(3_000);
    await settle();
    expect(syncMock.upsertSessionMetadata).toHaveBeenCalledTimes(4);
  });

  it("tombstones a previously published OFF session exactly once across sweeps", async () => {
    seedConnection(COLLAB_SESSION_ACCESS_MODE.OFF);
    store.set(sessionsAtom, [LOCAL_SESSION]);
    // Publish evidence from an earlier run (persisted): the tombstone is
    // warranted — the server still holds this session's metadata.
    store.set(collabPublishedSessionKeysAtom, {
      "org-1:session-1": "2026-06-30T00:00:00.000Z",
    });

    engine.start(store);
    await settle();
    expect(syncMock.removeSessionMetadata).toHaveBeenCalledTimes(1);
    // The tombstone prunes the persisted publish evidence.
    expect(
      store.get(collabPublishedSessionKeysAtom)["org-1:session-1"]
    ).toBeUndefined();

    store.set(sessionsAtom, [{ ...LOCAL_SESSION }]);
    await vi.advanceTimersByTimeAsync(3_000);
    await settle();
    expect(syncMock.removeSessionMetadata).toHaveBeenCalledTimes(1);
    expect(syncMock.upsertSessionMetadata).not.toHaveBeenCalled();
  });

  it("emits no tombstone for a never-published OFF session", async () => {
    seedConnection(COLLAB_SESSION_ACCESS_MODE.OFF);
    store.set(sessionsAtom, [LOCAL_SESSION]);

    engine.start(store);
    await settle();
    // No publish evidence (no metadata hash, no push cursor, no persisted
    // published key) → there is nothing on the server to remove; an OFF
    // session must not emit a tombstone RPC on every engine start.
    expect(syncMock.removeSessionMetadata).not.toHaveBeenCalled();
    expect(syncMock.upsertSessionMetadata).not.toHaveBeenCalled();

    store.set(sessionsAtom, [{ ...LOCAL_SESSION }]);
    await vi.advanceTimersByTimeAsync(3_000);
    await settle();
    expect(syncMock.removeSessionMetadata).not.toHaveBeenCalled();
  });

  it("re-arms the OFF tombstone after the session comes back into scope and off again", async () => {
    seedConnection(COLLAB_SESSION_ACCESS_MODE.OFF);
    store.set(sessionsAtom, [LOCAL_SESSION]);
    // Published in an earlier run → the initial tombstone has evidence.
    store.set(collabPublishedSessionKeysAtom, {
      "org-1:session-1": "2026-06-30T00:00:00.000Z",
    });

    engine.start(store);
    await settle();
    // OFF at start → exactly one tombstone, no publish.
    expect(syncMock.removeSessionMetadata).toHaveBeenCalledTimes(1);
    expect(syncMock.upsertSessionMetadata).not.toHaveBeenCalled();

    // Flip the member default to FULL_REPLAY: the session becomes push-allowed,
    // so the sweep publishes it AND clears its known-removed entry (the tombstone
    // is no longer permanent).
    store.set(collabSessionAccessSettingsAtom, [
      accessSettings(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY),
    ]);
    await vi.advanceTimersByTimeAsync(3_000);
    await settle();
    expect(syncMock.upsertSessionMetadata).toHaveBeenCalledTimes(1);
    // No new tombstone from this transition.
    expect(syncMock.removeSessionMetadata).toHaveBeenCalledTimes(1);

    // Flip back to OFF: because the known-removed entry was cleared, the
    // tombstone must fire AGAIN — it is re-armed, not permanently suppressed.
    store.set(collabSessionAccessSettingsAtom, [
      accessSettings(COLLAB_SESSION_ACCESS_MODE.OFF),
    ]);
    await vi.advanceTimersByTimeAsync(3_000);
    await settle();
    expect(syncMock.removeSessionMetadata).toHaveBeenCalledTimes(2);
  });

  it("tombstones a published session that the owner later deletes locally", async () => {
    seedConnection();
    store.set(sessionsAtom, [LOCAL_SESSION]);

    engine.start(store);
    await settle();
    expect(syncMock.upsertSessionMetadata).toHaveBeenCalledTimes(1);
    expect(syncMock.removeSessionMetadata).not.toHaveBeenCalled();

    // Owner deletes the session — it disappears from sessionsAtom entirely.
    store.set(sessionsAtom, []);
    await vi.advanceTimersByTimeAsync(3_000);
    await settle();

    // A tombstone must fire so teammates stop seeing the deleted session,
    // and exactly once across further sweeps.
    expect(syncMock.removeSessionMetadata).toHaveBeenCalledTimes(1);
    expect(syncMock.removeSessionMetadata.mock.calls[0][0]).toMatchObject({
      orgId: "org-1",
      sourceSessionId: "session-1",
    });

    store.set(sessionsAtom, []);
    await vi.advanceTimersByTimeAsync(3_000);
    await settle();
    expect(syncMock.removeSessionMetadata).toHaveBeenCalledTimes(1);
  });

  it("never pushes event segments for a METADATA_ONLY session (transcript stays private)", async () => {
    seedConnection(COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY);
    store.set(sessionsAtom, [LOCAL_SESSION]);
    // A live session with real events — under FULL_REPLAY these would be
    // pushed as segments. METADATA_ONLY must publish the title/branch metadata
    // but never the event transcript.
    eventStoreMock.getPersistedEvents.mockResolvedValue([
      makeEvent("e1"),
      makeEvent("e2", "running"),
    ]);

    engine.start(store);
    await settle();
    expect(syncMock.upsertSessionMetadata).toHaveBeenCalledTimes(1);

    // Drive an event-store change, which under FULL_REPLAY triggers a segment
    // push. It must produce no segment RPC of any kind.
    fireEventStoreChange("session-1");
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(30);

    expect(syncMock.appendSessionEvents).not.toHaveBeenCalled();
    expect(syncMock.rewriteSessionEvents).not.toHaveBeenCalled();
    // No push cursor is created — nothing about the transcript left the device.
    expect(store.get(collabSessionPushCursorsAtom)["org-1:session-1"]).toBe(
      undefined
    );
  });

  it("re-runs a push that arrives while one is in flight instead of dropping it", async () => {
    seedConnection();
    store.set(sessionsAtom, [LOCAL_SESSION]);
    eventStoreMock.getPersistedEvents
      .mockResolvedValueOnce([makeEvent("e1", "running")])
      .mockResolvedValueOnce([
        makeEvent("e1", "running"),
        makeEvent("e2", "running"),
      ]);
    let resolveFirstEventsPush!: () => void;
    syncMock.rewriteSessionEvents.mockImplementationOnce(
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
    expect(syncMock.rewriteSessionEvents).toHaveBeenCalledTimes(1);

    // A flush during the in-flight push must not be dropped.
    fireEventStoreChange("session-1");
    await vi.advanceTimersByTimeAsync(3_000);
    await settle();
    expect(syncMock.rewriteSessionEvents).toHaveBeenCalledTimes(1);
    expect(syncMock.appendSessionEvents).not.toHaveBeenCalled();

    resolveFirstEventsPush();
    await settle(30);
    // The re-run sees the grown tail and lands as a cursor-anchored append.
    expect(syncMock.appendSessionEvents).toHaveBeenCalledTimes(1);
    expect(syncMock.rewriteSessionEvents.mock.calls[0][0].tail).toHaveLength(1);
    expect(syncMock.appendSessionEvents.mock.calls[0][0].tail).toHaveLength(2);
  });

  it("splits pushes into frozen/tail: anchor rewrite, tail-only replace, frozen append, no-op", async () => {
    seedConnection();
    store.set(sessionsAtom, [LOCAL_SESSION]);
    const e1 = makeEvent("e1");
    const e2 = makeEvent("e2");
    eventStoreMock.getPersistedEvents.mockResolvedValue([
      e1,
      e2,
      makeEvent("e3", "running"),
    ]);

    engine.start(store);
    await settle();

    // 1) First push, no cursor: optimistic epoch-1 anchor rewrite; the
    // terminal prefix is frozen, the running turn is the tail.
    fireEventStoreChange("session-1");
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(30);
    expect(syncMock.rewriteSessionEvents).toHaveBeenCalledTimes(1);
    const anchor = syncMock.rewriteSessionEvents.mock.calls[0][0];
    expect(anchor.newEpoch).toBe(1);
    expect(anchor.sessionRowId).toBe("org-1:m1:session-1");
    expect(anchor.frozenSegments).toHaveLength(1);
    expect(anchor.frozenSegments[0].seq).toBe(1);
    expect(anchor.frozenSegments[0].events.map((event) => event.id)).toEqual([
      "e1",
      "e2",
    ]);
    expect(anchor.tail?.map((event) => event.id)).toEqual(["e3"]);
    expect(anchor.totalCount).toBe(3);

    // 2) The tail event mutates in place (streaming) → tail-only replace.
    eventStoreMock.getPersistedEvents.mockResolvedValue([
      e1,
      e2,
      makeEvent("e3", "running", { streamOutput: "chunk" }),
    ]);
    fireEventStoreChange("session-1");
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(30);
    expect(syncMock.appendSessionEvents).toHaveBeenCalledTimes(1);
    const tailReplace = syncMock.appendSessionEvents.mock.calls[0][0];
    expect(tailReplace.expectedEpoch).toBe(1);
    expect(tailReplace.expectedFrozenSeq).toBe(1);
    expect(tailReplace.frozenSegments).toHaveLength(0);
    expect(tailReplace.tail?.map((event) => event.id)).toEqual(["e3"]);
    expect(tailReplace.totalCount).toBe(3);

    // 3) The turn completes and a new one starts → frozen line advances:
    // append a new frozen segment plus the new tail.
    eventStoreMock.getPersistedEvents.mockResolvedValue([
      e1,
      e2,
      makeEvent("e3"),
      makeEvent("e4", "running"),
    ]);
    fireEventStoreChange("session-1");
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(30);
    expect(syncMock.appendSessionEvents).toHaveBeenCalledTimes(2);
    const frozenAdvance = syncMock.appendSessionEvents.mock.calls[1][0];
    expect(frozenAdvance.expectedEpoch).toBe(1);
    expect(frozenAdvance.expectedFrozenSeq).toBe(1);
    expect(frozenAdvance.frozenSegments).toHaveLength(1);
    expect(frozenAdvance.frozenSegments[0].seq).toBe(2);
    expect(
      frozenAdvance.frozenSegments[0].events.map((event) => event.id)
    ).toEqual(["e3"]);
    expect(frozenAdvance.tail?.map((event) => event.id)).toEqual(["e4"]);
    expect(frozenAdvance.totalCount).toBe(4);

    // 4) Nothing changed → no RPC at all.
    fireEventStoreChange("session-1");
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(30);
    expect(syncMock.appendSessionEvents).toHaveBeenCalledTimes(2);
    expect(syncMock.rewriteSessionEvents).toHaveBeenCalledTimes(1);

    // The cursor is persisted per (org, session).
    const cursor = store.get(collabSessionPushCursorsAtom)["org-1:session-1"];
    expect(cursor).toMatchObject({
      epoch: 1,
      frozenSeq: 2,
      pushedCount: 4,
      frozenEventCount: 3,
    });
  });

  it("rewrites at epoch+1 when a frozen event mutates in place", async () => {
    seedConnection();
    store.set(sessionsAtom, [LOCAL_SESSION]);
    eventStoreMock.getPersistedEvents.mockResolvedValue([
      makeEvent("e1"),
      makeEvent("e2", "running"),
    ]);

    engine.start(store);
    await settle();
    fireEventStoreChange("session-1");
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(30);
    expect(syncMock.rewriteSessionEvents).toHaveBeenCalledTimes(1);
    expect(syncMock.rewriteSessionEvents.mock.calls[0][0].newEpoch).toBe(1);

    // A patch lands on the frozen event (patchByIds on old events) → the
    // per-event hash chain mismatches → epoch 2 full rewrite, no append.
    eventStoreMock.getPersistedEvents.mockResolvedValue([
      makeEvent("e1", "completed", { patched: true }),
      makeEvent("e2", "running"),
    ]);
    fireEventStoreChange("session-1");
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(30);
    expect(syncMock.appendSessionEvents).not.toHaveBeenCalled();
    expect(syncMock.rewriteSessionEvents).toHaveBeenCalledTimes(2);
    const rewrite = syncMock.rewriteSessionEvents.mock.calls[1][0];
    expect(rewrite.newEpoch).toBe(2);
    expect(rewrite.frozenSegments[0].events.map((event) => event.id)).toEqual([
      "e1",
    ]);
  });

  it("re-anchors at server epoch + 1 after an OCC rejection", async () => {
    seedConnection();
    store.set(sessionsAtom, [LOCAL_SESSION]);
    eventStoreMock.getPersistedEvents.mockResolvedValue([
      makeEvent("e1", "running"),
    ]);
    // Another device already pushed epoch 5 while our cursor was lost: the
    // optimistic epoch-1 anchor bounces off OCC.
    syncMock.rewriteSessionEvents
      .mockRejectedValueOnce(new Error("ORGII_CONFLICT"))
      .mockResolvedValue(undefined);
    syncMock.getSessionEventSegments.mockResolvedValue({
      epoch: 5,
      frozenSeq: 9,
      tailHash: "t",
      count: 12,
      segments: [],
    });

    engine.start(store);
    await settle();
    fireEventStoreChange("session-1");
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(30);

    expect(syncMock.rewriteSessionEvents).toHaveBeenCalledTimes(2);
    expect(syncMock.rewriteSessionEvents.mock.calls[0][0].newEpoch).toBe(1);
    expect(syncMock.rewriteSessionEvents.mock.calls[1][0].newEpoch).toBe(6);
    expect(
      store.get(collabSessionPushCursorsAtom)["org-1:session-1"]
    ).toMatchObject({ epoch: 6, frozenSeq: 0, pushedCount: 1 });

    // A conflicted APPEND re-anchors the same way.
    syncMock.appendSessionEvents.mockRejectedValueOnce(
      new Error("ORGII_CONFLICT")
    );
    syncMock.getSessionEventSegments.mockResolvedValue({
      epoch: 7,
      frozenSeq: 2,
      tailHash: "t2",
      count: 5,
      segments: [],
    });
    eventStoreMock.getPersistedEvents.mockResolvedValue([
      makeEvent("e1", "running", { streamOutput: "more" }),
    ]);
    fireEventStoreChange("session-1");
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(30);
    expect(syncMock.appendSessionEvents).toHaveBeenCalledTimes(1);
    expect(syncMock.rewriteSessionEvents).toHaveBeenCalledTimes(3);
    expect(syncMock.rewriteSessionEvents.mock.calls[2][0].newEpoch).toBe(8);
  });

  it("aborts the push instead of rewriting when the persisted read is truncated", async () => {
    seedConnection();
    store.set(sessionsAtom, [LOCAL_SESSION]);
    eventStoreMock.getPersistedEvents.mockResolvedValue([
      makeEvent("e1"),
      makeEvent("e2"),
    ]);

    engine.start(store);
    await settle();
    fireEventStoreChange("session-1");
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(30);
    expect(syncMock.rewriteSessionEvents).toHaveBeenCalledTimes(1);

    // The cache read comes back shorter than what the cursor covers — a
    // truncated view, not a shorter session. Never epoch-bump on it.
    eventStoreMock.getPersistedEvents.mockResolvedValue([makeEvent("e1")]);
    fireEventStoreChange("session-1");
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(30);
    expect(syncMock.rewriteSessionEvents).toHaveBeenCalledTimes(1);
    expect(syncMock.appendSessionEvents).not.toHaveBeenCalled();
    expect(
      store.get(collabSessionPushCursorsAtom)["org-1:session-1"]
    ).toMatchObject({ pushedCount: 2 });
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

  it("imports teammate segments, records the importedFrom cursor, and never pushes them back", async () => {
    seedConnection();
    const remote = remoteSession({
      eventsEpoch: 1,
      eventsFrozenSeq: 1,
      eventsCount: 2,
      eventsTailHash: "tail-hash",
    });
    syncMock.listOrgState
      .mockImplementationOnce(async () => ({
        ...emptyOrgState(),
        sessions: [remote],
      }))
      .mockImplementation(async () => emptyOrgState());
    syncMock.getSessionEventSegments.mockResolvedValue({
      epoch: 1,
      frozenSeq: 1,
      tailHash: "tail-hash",
      count: 2,
      segments: [
        {
          seq: 1,
          isTail: false,
          events: [makeEvent("e1")],
          eventCount: 1,
          segmentHash: "h1",
        },
        {
          seq: 1_000_000_000,
          isTail: true,
          events: [makeEvent("e2", "running")],
          eventCount: 1,
          segmentHash: "tail-hash",
        },
      ],
    });

    engine.start(store);
    await vi.advanceTimersByTimeAsync(0);
    await settle(20);

    expect(syncMock.getSessionEventSegments).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionRowId: "org-1:m2:remote-1",
        afterSeq: 0,
      })
    );
    expect(eventStoreMock.set).toHaveBeenCalledTimes(1);
    const importedEvents = eventStoreMock.set.mock
      .calls[0][0] as SessionEvent[];
    const localSessionId = eventStoreMock.set.mock.calls[0][1] as string;
    expect(localSessionId).toMatch(/^imported-session-/);
    expect(importedEvents.map((event) => event.id)).toEqual(["e1", "e2"]);
    expect(importedEvents[0]?.sessionId).toBe(localSessionId);
    // Imports must survive restart (fix P7).
    expect(eventStoreMock.saveToCache).toHaveBeenCalledWith(localSessionId);
    const imported = store
      .get(sessionsAtom)
      .find((session) => session.session_id === localSessionId);
    expect(imported?.category).toBe("external_history");
    // The consumer cursor lives on the first-class importedFrom field —
    // no error_message JSON anymore.
    expect(imported?.importedFrom).toMatchObject({
      orgId: "org-1",
      sourceSessionId: "remote-1",
      ownerMemberId: "m2",
      epoch: 1,
      seq: 1,
      count: 2,
      frozenCount: 1,
      tailHash: "tail-hash",
    });
    expect(imported?.error_message).toBeUndefined();

    // The import's own eventStore write re-enters the push subscription —
    // the imported id must never round-trip back out.
    fireEventStoreChange(localSessionId);
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(20);
    expect(syncMock.appendSessionEvents).not.toHaveBeenCalled();
    expect(syncMock.rewriteSessionEvents).not.toHaveBeenCalled();
  });

  it("retries a failed teammate import with the same deterministic id, holds the cursor, and drops the orphan", async () => {
    seedConnection();
    const remote = remoteSession({
      eventsEpoch: 1,
      eventsFrozenSeq: 1,
      eventsCount: 2,
      eventsTailHash: "tail-hash",
    });
    // The same delta window must re-deliver the session on retry — the
    // engine holds the cursor after a failed import.
    syncMock.listOrgState.mockImplementation(async () => ({
      ...emptyOrgState(),
      sessions: [remote],
    }));
    syncMock.getSessionEventSegments.mockResolvedValue({
      epoch: 1,
      frozenSeq: 1,
      tailHash: "tail-hash",
      count: 2,
      segments: [
        {
          seq: 1,
          isTail: false,
          events: [makeEvent("e1")],
          eventCount: 1,
          segmentHash: "h1",
        },
        {
          seq: 1_000_000_000,
          isTail: true,
          events: [makeEvent("e2", "running")],
          eventCount: 1,
          segmentHash: "tail-hash",
        },
      ],
    });
    // The durable cache write fails ONCE (transient SQLite lock → 0).
    eventStoreMock.saveToCache.mockResolvedValueOnce(0);

    engine.start(store);
    await vi.advanceTimersByTimeAsync(0);
    await settle(20);

    // Events were attempted, but no "complete" session record/cursor was
    // persisted — otherwise the next pull would see a matching cursor and
    // never re-fetch, stranding a permanently empty transcript. The
    // orphaned event-store entry is dropped, the failure keeps the org in
    // ERROR, and the delta cursor did not advance.
    expect(eventStoreMock.set).toHaveBeenCalledTimes(1);
    const localSessionId = eventStoreMock.set.mock.calls[0][1] as string;
    expect(eventStoreMock.clear).toHaveBeenCalledWith(localSessionId);
    expect(
      store
        .get(sessionsAtom)
        .find((session) => session.session_id === localSessionId)
    ).toBeUndefined();
    expect(
      store.get(collabConnectionStatesAtom).find((s) => s.orgId === "org-1")
        ?.status
    ).toBe(COLLAB_CONNECTION_STATUS.ERROR);
    expect(store.get(collabLastSyncTimestampsAtom)["org-1"]).toBeUndefined();

    // Retry on the next cycle reuses the SAME deterministic local id (no
    // orphan accumulation) and completes the import.
    // Cycle 1 finished while idle (no focus, no activity) - the next pull
    // lands on the 60s idle cadence.
    await vi.advanceTimersByTimeAsync(60_000);
    await settle(20);
    expect(eventStoreMock.set).toHaveBeenCalledTimes(2);
    expect(eventStoreMock.set.mock.calls[1][1]).toBe(localSessionId);
    const imported = store
      .get(sessionsAtom)
      .find((session) => session.session_id === localSessionId);
    expect(imported?.importedFrom).toMatchObject({
      orgId: "org-1",
      sourceSessionId: "remote-1",
    });
    expect(store.get(collabLastSyncTimestampsAtom)["org-1"]).toBeDefined();
  });

  it("applies incremental segment pulls onto the existing imported session", async () => {
    seedConnection();
    const localSessionId = "imported-session-existing";
    const existingImported: Session = {
      session_id: localSessionId,
      status: "completed",
      created_at: "2026-06-30T00:00:00.000Z",
      updated_at: "2026-06-30T00:00:00.000Z",
      name: "Remote session",
      repoPath: REPO_PATH,
      category: "external_history",
      importedFrom: {
        orgId: "org-1",
        sourceSessionId: "remote-1",
        ownerMemberId: "m2",
        epoch: 1,
        seq: 1,
        count: 2,
        frozenCount: 1,
        tailHash: "tail-1",
      },
    };
    store.set(sessionsAtom, [existingImported]);
    eventStoreMock.getPersistedEvents.mockResolvedValue([
      { ...makeEvent("e1"), sessionId: localSessionId } as SessionEvent,
      {
        ...makeEvent("e2", "running"),
        sessionId: localSessionId,
      } as SessionEvent,
    ]);
    const remote = remoteSession({
      eventsEpoch: 1,
      eventsFrozenSeq: 2,
      eventsCount: 3,
      eventsTailHash: "tail-2",
    });
    syncMock.listOrgState
      .mockImplementationOnce(async () => ({
        ...emptyOrgState(),
        sessions: [remote],
      }))
      .mockImplementation(async () => emptyOrgState());
    syncMock.getSessionEventSegments.mockResolvedValue({
      epoch: 1,
      frozenSeq: 2,
      tailHash: "tail-2",
      count: 3,
      segments: [
        {
          seq: 2,
          isTail: false,
          events: [makeEvent("e2")],
          eventCount: 1,
          segmentHash: "h2",
        },
        {
          seq: 1_000_000_000,
          isTail: true,
          events: [makeEvent("e3", "running")],
          eventCount: 1,
          segmentHash: "tail-2",
        },
      ],
    });

    engine.start(store);
    await vi.advanceTimersByTimeAsync(0);
    await settle(20);

    // Only the delta was fetched (afterSeq = local cursor's frozen seq)…
    expect(syncMock.getSessionEventSegments).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionRowId: "org-1:m2:remote-1",
        afterSeq: 1,
      })
    );
    // …and spliced onto the local frozen prefix: old tail replaced by the
    // newly frozen e2 + the new tail e3.
    expect(eventStoreMock.set).toHaveBeenCalledTimes(1);
    const written = eventStoreMock.set.mock.calls[0][0] as SessionEvent[];
    expect(written.map((event) => event.id)).toEqual(["e1", "e2", "e3"]);
    expect(eventStoreMock.set.mock.calls[0][1]).toBe(localSessionId);
    const updated = store
      .get(sessionsAtom)
      .find((session) => session.session_id === localSessionId);
    expect(updated?.importedFrom).toMatchObject({
      epoch: 1,
      seq: 2,
      count: 3,
      frozenCount: 2,
      tailHash: "tail-2",
    });
  });

  it("aborts the OCC re-anchor when the session was unshared mid-flight", async () => {
    seedConnection();
    store.set(sessionsAtom, [LOCAL_SESSION]);
    eventStoreMock.getPersistedEvents.mockResolvedValue([
      makeEvent("e1", "running"),
    ]);

    engine.start(store);
    await settle();

    // Anchor push: epoch-1 rewrite creates the cursor.
    fireEventStoreChange("session-1");
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(30);
    expect(syncMock.rewriteSessionEvents).toHaveBeenCalledTimes(1);
    expect(
      store.get(collabSessionPushCursorsAtom)["org-1:session-1"]
    ).toBeDefined();

    // The next append bounces off OCC; the owner unshares DURING the
    // re-anchor probe (a server round trip) — the rewrite would otherwise
    // republish the just-unshared session with the stale settings, and the
    // sweep's known-removed gate would block any self-healing tombstone.
    eventStoreMock.getPersistedEvents.mockResolvedValue([
      makeEvent("e1", "running", { streamOutput: "more" }),
    ]);
    syncMock.appendSessionEvents.mockRejectedValueOnce(
      new Error("ORGII_CONFLICT")
    );
    syncMock.getSessionEventSegments.mockImplementation(async () => {
      store.set(collabSessionAccessSettingsAtom, [
        accessSettings(COLLAB_SESSION_ACCESS_MODE.OFF),
      ]);
      return { epoch: 5, frozenSeq: 0, tailHash: "t", count: 1, segments: [] };
    });
    const upsertsBeforeConflict =
      syncMock.upsertSessionMetadata.mock.calls.length;
    fireEventStoreChange("session-1");
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(30);

    // No re-anchor rewrite, and no metadata republished from stale settings
    // (the single new upsert happened before the append, while still shared).
    expect(syncMock.rewriteSessionEvents).toHaveBeenCalledTimes(1);
    expect(syncMock.upsertSessionMetadata.mock.calls.length).toBe(
      upsertsBeforeConflict + 1
    );

    // The sweep (settings change) tombstones the session and purges the
    // cursor; the aborted push must not have resurrected either.
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(30);
    expect(syncMock.removeSessionMetadata).toHaveBeenCalledTimes(1);
    expect(
      store.get(collabSessionPushCursorsAtom)["org-1:session-1"]
    ).toBeUndefined();
  });

  it("cancels an in-flight push when the sweep tombstones the session", async () => {
    seedConnection();
    store.set(sessionsAtom, [LOCAL_SESSION]);
    eventStoreMock.getPersistedEvents.mockResolvedValue([
      makeEvent("e1", "running"),
    ]);
    let resolveRewrite!: () => void;
    syncMock.rewriteSessionEvents.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRewrite = resolve;
        })
    );

    engine.start(store);
    await settle();

    fireEventStoreChange("session-1");
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(30);
    expect(syncMock.rewriteSessionEvents).toHaveBeenCalledTimes(1); // in flight

    // Sharing turns OFF while the rewrite is on the wire; the sweep
    // tombstones the session (evidence: the initial metadata publish).
    store.set(collabSessionAccessSettingsAtom, [
      accessSettings(COLLAB_SESSION_ACCESS_MODE.OFF),
    ]);
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(30);
    expect(syncMock.removeSessionMetadata).toHaveBeenCalledTimes(1);

    // The push completes AFTER the tombstone — its completion must not
    // write the cursor back and re-anchor the unshared session.
    resolveRewrite();
    await settle(30);
    expect(store.get(collabSessionPushCursorsAtom)["org-1:session-1"]).toBe(
      undefined
    );
  });

  it("drops in-flight pull writes and purges org-scoped push gates when the org leaves", async () => {
    seedConnection();
    store.set(sessionsAtom, [LOCAL_SESSION]);
    let resolvePull!: (state: CollabOrgState) => void;
    syncMock.listOrgState.mockImplementationOnce(
      () =>
        new Promise<CollabOrgState>((resolve) => {
          resolvePull = resolve;
        })
    );

    engine.start(store);
    await settle();
    expect(syncMock.upsertSessionMetadata).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0); // pull cycle hangs on listOrgState
    await settle();
    expect(syncMock.verifySetup).toHaveBeenCalledTimes(1);

    // The org leaves while the pull is in flight.
    store.set(collabOrgsAtom, []);
    await settle();

    // The delayed response must not resurrect purged org state or advance
    // the org's delta cursor.
    resolvePull({ ...emptyOrgState(), sessions: [remoteSession()] });
    await settle(20);
    expect(store.get(remoteTeammateSessionsAtom)).toHaveLength(0);
    expect(store.get(collabLastSyncTimestampsAtom)["org-1"]).toBeUndefined();

    // Rejoin: org-prefixed in-memory gates (metadata hashes, verify cache)
    // were purged, so the publish and setup verification run fresh instead
    // of being suppressed by stale entries.
    store.set(collabOrgsAtom, [ORG]);
    await vi.advanceTimersByTimeAsync(0);
    await settle(20);
    expect(syncMock.upsertSessionMetadata).toHaveBeenCalledTimes(2);
    expect(syncMock.verifySetup).toHaveBeenCalledTimes(2);
  });

  it("publishes legacy snapshots from the persisted history and denies when it reads empty", async () => {
    seedConnection();
    store.set(sessionsAtom, [LOCAL_SESSION]);
    syncMock.listOrgState.mockImplementation(async () => ({
      ...emptyOrgState(),
      snapshotRequests: [
        {
          requestId: "req-1",
          orgId: "org-1",
          requesterMemberId: "m2",
          ownerMemberId: "m1",
          sourceSessionId: "session-1",
          status: "pending" as const,
          createdAt: "2026-07-01T11:00:00.000Z",
        },
      ],
    }));
    // Cold session: the persisted read returns nothing although the session
    // metadata shows history (status completed) — publishing would ship an
    // empty transcript the requester permanently marks completed.
    eventStoreMock.getPersistedEvents.mockResolvedValue([]);

    engine.start(store);
    await vi.advanceTimersByTimeAsync(0);
    await settle(20);

    expect(syncMock.denySessionSnapshot).toHaveBeenCalledTimes(1);
    expect(syncMock.denySessionSnapshot.mock.calls[0][0]).toMatchObject({
      requestId: "req-1",
      reason: expect.stringContaining("history is unavailable"),
    });
    expect(syncMock.publishSessionSnapshot).not.toHaveBeenCalled();
    // The windowed in-memory view is never consulted for the publish.
    expect(eventStoreMock.getEvents).not.toHaveBeenCalled();

    // Once the persisted read works, the FULL history is published.
    eventStoreMock.getPersistedEvents.mockResolvedValue([
      makeEvent("e1"),
      makeEvent("e2"),
    ]);
    // Cycle 1 finished while idle (no focus, no activity) - the next pull
    // lands on the 60s idle cadence.
    await vi.advanceTimersByTimeAsync(60_000);
    await settle(20);
    expect(syncMock.publishSessionSnapshot).toHaveBeenCalledTimes(1);
    const published = syncMock.publishSessionSnapshot.mock.calls[0][0];
    expect(published.events.map((event) => event.id)).toEqual(["e1", "e2"]);
  });

  it("imports a legacy snapshot only after the durable write succeeds, retrying on failure", async () => {
    seedConnection();
    store.set(collabSessionSnapshotRequestsAtom, [
      {
        requestId: "req-2",
        orgId: "org-1",
        requesterMemberId: "m1",
        ownerMemberId: "m2",
        sourceSessionId: "remote-9",
        createdAt: "2026-07-01T11:00:00.000Z",
        status: "sent",
      },
    ]);
    const payloadSession = remoteSession({
      id: "org-1:m2:remote-9",
      sourceSessionId: "remote-9",
    });
    syncMock.listOrgState.mockImplementation(async () => ({
      ...emptyOrgState(),
      snapshotRequests: [
        {
          requestId: "req-2",
          orgId: "org-1",
          requesterMemberId: "m1",
          ownerMemberId: "m2",
          sourceSessionId: "remote-9",
          status: "completed" as const,
          createdAt: "2026-07-01T11:00:00.000Z",
          session: payloadSession,
          events: [makeEvent("e1")],
        },
      ],
    }));
    // Cycle 1: the durable cache write fails.
    eventStoreMock.saveToCache.mockResolvedValueOnce(0);

    engine.start(store);
    await vi.advanceTimersByTimeAsync(0);
    await settle(20);

    // No session record was persisted (the old order persisted it BEFORE
    // the event write, marking the request done over an empty transcript),
    // the orphaned events were dropped, the request status is untouched for
    // retry, and the delta cursor held.
    expect(eventStoreMock.set).toHaveBeenCalledTimes(1);
    const failedId = eventStoreMock.set.mock.calls[0][1] as string;
    expect(eventStoreMock.clear).toHaveBeenCalledWith(failedId);
    expect(store.get(sessionsAtom)).toHaveLength(0);
    expect(store.get(collabSessionSnapshotRequestsAtom)[0]?.status).toBe(
      "sent"
    );
    expect(store.get(collabPendingOpenSessionAtom)).toBeNull();
    expect(store.get(collabLastSyncTimestampsAtom)["org-1"]).toBeUndefined();

    // Cycle 2: the write succeeds → the import completes exactly once.
    // Cycle 1 finished while idle (no focus, no activity) - the next pull
    // lands on the 60s idle cadence.
    await vi.advanceTimersByTimeAsync(60_000);
    await settle(20);
    const imported = store
      .get(sessionsAtom)
      .find((session) => session.importedFrom?.sourceSessionId === "remote-9");
    expect(imported?.importedFrom).toMatchObject({
      orgId: "org-1",
      epoch: 0,
      count: 1,
    });
    expect(store.get(collabSessionSnapshotRequestsAtom)[0]?.status).toBe(
      "completed"
    );
    expect(store.get(collabPendingOpenSessionAtom)?.sessionId).toBe(
      imported?.session_id
    );
    expect(store.get(collabLastSyncTimestampsAtom)["org-1"]).toBeDefined();
  });

  it("persists published-session keys and tombstones a session deleted while the app was closed", async () => {
    seedConnection();
    store.set(sessionsAtom, [LOCAL_SESSION]);

    engine.start(store);
    await settle();
    expect(syncMock.upsertSessionMetadata).toHaveBeenCalledTimes(1);
    // Publish evidence is persisted next to the push cursors.
    expect(
      store.get(collabPublishedSessionKeysAtom)["org-1:session-1"]
    ).toBeDefined();

    // Simulated restart: a NEW engine instance (all in-memory maps gone);
    // the session was deleted while the app was closed.
    engine.stop();
    store.set(sessionsAtom, []);
    syncMock.removeSessionMetadata.mockClear();
    engine = new CollabSyncEngine();
    engine.start(store);
    await settle(20);

    // The first sweep diffs the PERSISTED published keys against
    // sessionsAtom and tombstones the gone session.
    expect(syncMock.removeSessionMetadata).toHaveBeenCalledTimes(1);
    expect(syncMock.removeSessionMetadata.mock.calls[0][0]).toMatchObject({
      orgId: "org-1",
      sourceSessionId: "session-1",
    });
    expect(
      store.get(collabPublishedSessionKeysAtom)["org-1:session-1"]
    ).toBeUndefined();

    // Exactly once — later sweeps stay silent.
    store.set(sessionsAtom, []);
    await vi.advanceTimersByTimeAsync(3_000);
    await settle();
    expect(syncMock.removeSessionMetadata).toHaveBeenCalledTimes(1);
  });

  it("keeps ERROR status and holds the delta cursor when a teammate import fails", async () => {
    seedConnection();
    const remote = remoteSession({
      eventsEpoch: 1,
      eventsFrozenSeq: 1,
      eventsCount: 1,
    });
    syncMock.listOrgState.mockImplementation(async () => ({
      ...emptyOrgState(),
      sessions: [remote],
    }));
    syncMock.getSessionEventSegments
      .mockRejectedValueOnce(new Error("segments fetch failed"))
      .mockResolvedValue({
        epoch: 1,
        frozenSeq: 1,
        tailHash: null,
        count: 1,
        segments: [
          {
            seq: 1,
            isTail: false,
            events: [makeEvent("e1")],
            eventCount: 1,
            segmentHash: "h1",
          },
        ],
      });

    engine.start(store);
    await vi.advanceTimersByTimeAsync(0);
    await settle(20);

    // Cycle 1: the import failed → ERROR is not overwritten by CONNECTED in
    // the same cycle, and the cursor did NOT advance (the session must stay
    // in the next delta window — advancing would drop it forever).
    const afterFailure = store
      .get(collabConnectionStatesAtom)
      .find((s) => s.orgId === "org-1");
    expect(afterFailure?.status).toBe(COLLAB_CONNECTION_STATUS.ERROR);
    expect(afterFailure?.error).toContain("remote-1");
    expect(store.get(collabLastSyncTimestampsAtom)["org-1"]).toBeUndefined();

    // Cycle 2: the delta re-delivers the session; the import succeeds.
    // Cycle 1 finished while idle (no focus, no activity) - the next pull
    // lands on the 60s idle cadence.
    await vi.advanceTimersByTimeAsync(60_000);
    await settle(20);
    expect(
      store.get(collabConnectionStatesAtom).find((s) => s.orgId === "org-1")
        ?.status
    ).toBe(COLLAB_CONNECTION_STATUS.CONNECTED);
    expect(store.get(collabLastSyncTimestampsAtom)["org-1"]).toBeDefined();
    expect(
      store
        .get(sessionsAtom)
        .some((session) => session.importedFrom?.sourceSessionId === "remote-1")
    ).toBe(true);
  });

  it("re-arms a failed segments push with bounded backoff", async () => {
    seedConnection();
    store.set(sessionsAtom, [LOCAL_SESSION]);
    eventStoreMock.getPersistedEvents.mockResolvedValue([
      makeEvent("e1", "running"),
    ]);
    syncMock.rewriteSessionEvents
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(undefined);

    engine.start(store);
    await settle();

    fireEventStoreChange("session-1");
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(30);
    expect(syncMock.rewriteSessionEvents).toHaveBeenCalledTimes(1);

    // First retry fires after the 5s backoff step (the old engine waited
    // for the NEXT local event — a finished session never retried)...
    await vi.advanceTimersByTimeAsync(4_999);
    await settle(30);
    expect(syncMock.rewriteSessionEvents).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle(30);
    expect(syncMock.rewriteSessionEvents).toHaveBeenCalledTimes(2);

    // ...the second after 15s; it succeeds and writes the cursor.
    await vi.advanceTimersByTimeAsync(15_000);
    await settle(30);
    expect(syncMock.rewriteSessionEvents).toHaveBeenCalledTimes(3);
    expect(
      store.get(collabSessionPushCursorsAtom)["org-1:session-1"]
    ).toMatchObject({ epoch: 1, pushedCount: 1 });

    // Success clears the retry loop.
    await vi.advanceTimersByTimeAsync(60_000);
    await settle(30);
    expect(syncMock.rewriteSessionEvents).toHaveBeenCalledTimes(3);
  });

  it("resumes an interrupted segments push on start when the cursor lags the persisted history", async () => {
    seedConnection();
    store.set(sessionsAtom, [LOCAL_SESSION]);
    store.set(collabSessionPushCursorsAtom, {
      "org-1:session-1": {
        orgId: "org-1",
        sessionId: "session-1",
        epoch: 1,
        frozenSeq: 0,
        pushedCount: 1,
        frozenEventCount: 0,
        frozenChainHash: "",
        tailHash: "stale-tail",
      },
    });
    // Two persisted events vs a cursor covering one: the app stopped between
    // the event write and the push.
    eventStoreMock.getPersistedEvents.mockResolvedValue([
      makeEvent("e1", "running"),
      makeEvent("e2", "running"),
    ]);

    engine.start(store);
    await settle(20);
    // No local event fires — the reconcile-time sweep re-arms the push.
    await vi.advanceTimersByTimeAsync(3_000);
    await settle(30);

    expect(syncMock.appendSessionEvents).toHaveBeenCalledTimes(1);
    expect(syncMock.appendSessionEvents.mock.calls[0][0]).toMatchObject({
      expectedEpoch: 1,
      expectedFrozenSeq: 0,
      totalCount: 2,
    });
  });
});
