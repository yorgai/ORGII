import { beforeEach, describe, expect, it, vi } from "vitest";

import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  COLLAB_IDENTITY_KIND,
  COLLAB_SESSION_ACCESS_MODE,
  COLLAB_WORKSPACE_SCOPE,
} from "@src/store/collaboration/types";
import type {
  CollabOrgRecord,
  CollabSessionAccessSettings,
  RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";
import { sessionsAtom } from "@src/store/session/sessionAtom/atoms";
import type { Session } from "@src/store/session/sessionAtom/types";
import { createInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { isSessionPushAllowed } from "../collabSyncUtils";
import type {
  CollabSyncBackendClient,
  SessionEventSegmentsSnapshot,
} from "../sync/CollabSyncBackend";
import {
  computeSessionMetadataHash,
  deriveImportedSessionId,
  forkSession,
  importRemoteSession,
  splitFrozenIntoSegments,
} from "./collabSyncEngineHelpers";

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

const eventStoreMock = vi.mocked(eventStoreProxy);

const SESSION: Session = {
  session_id: "session-1",
  status: "completed",
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
  name: "Local session",
  repoPath: "/repo/shared",
};

function createSettings(
  overrides: Partial<CollabSessionAccessSettings> = {}
): CollabSessionAccessSettings {
  return {
    orgId: "org-1",
    memberId: "member-1",
    accessMode: COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY,
    workspaceScope: COLLAB_WORKSPACE_SCOPE.SELECTED_WORKSPACES,
    workspacePaths: [],
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeSessionMetadataHash sharing inputs", () => {
  it("changes when the published visibility flips org ↔ restricted (M4b)", () => {
    const orgVisible = computeSessionMetadataHash(SESSION, createSettings());
    const restricted = computeSessionMetadataHash(
      SESSION,
      createSettings({ sessionVisibility: { "session-1": "restricted" } })
    );
    expect(restricted).not.toBe(orgVisible);
    // The hash gate must re-push exactly this session — an entry for another
    // session leaves the hash untouched.
    const otherSessionRestricted = computeSessionMetadataHash(
      SESSION,
      createSettings({ sessionVisibility: { "session-2": "restricted" } })
    );
    expect(otherSessionRestricted).toBe(orgVisible);
  });

  it("changes when a per-session override changes the effective mode", () => {
    const base = computeSessionMetadataHash(SESSION, createSettings());
    const overridden = computeSessionMetadataHash(
      SESSION,
      createSettings({
        sessionOverrides: {
          "session-1": COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY,
        },
      })
    );
    expect(overridden).not.toBe(base);
  });

  it("changes on status / branch / lastActivityAt but not on a repoPath move", () => {
    const settings = createSettings();
    const base = computeSessionMetadataHash(SESSION, settings);

    expect(
      computeSessionMetadataHash({ ...SESSION, status: "running" }, settings)
    ).not.toBe(base);
    expect(
      computeSessionMetadataHash({ ...SESSION, branch: "feat/x" }, settings)
    ).not.toBe(base);
    // updated_at is bucketed to the minute — a full-minute move crosses the
    // bucket boundary and changes the hash (a sub-minute move would not).
    expect(
      computeSessionMetadataHash(
        { ...SESSION, updated_at: "2026-07-01T00:01:00.000Z" },
        settings
      )
    ).not.toBe(base);
    // repoPath is DELIBERATELY excluded — a local path move must not re-push.
    expect(
      computeSessionMetadataHash(
        { ...SESSION, repoPath: "/repo/moved" },
        settings
      )
    ).toBe(base);
  });
});

describe("splitFrozenIntoSegments 256KB packing", () => {
  const SEGMENT_MAX_BYTES = 256 * 1024;

  function makeEvent(id: string, payload = ""): SessionEvent {
    return {
      id,
      sessionId: "session-1",
      displayStatus: "completed",
      payload,
    } as unknown as SessionEvent;
  }

  it("packs a >256KB event stream into multiple ≤256KB segments that round-trip", () => {
    // ~50KB per event so a handful crosses the 256KB cap and forces >1 segment.
    const bigPayload = "x".repeat(50 * 1024);
    const events = Array.from({ length: 12 }, (_unused, index) =>
      makeEvent(`e${index}`, bigPayload)
    );
    const totalBytes = events.reduce(
      (sum, event) => sum + JSON.stringify(event).length,
      0
    );
    expect(totalBytes).toBeGreaterThan(SEGMENT_MAX_BYTES);

    const segments = splitFrozenIntoSegments(events, 1);

    // More than one frozen segment was produced.
    expect(segments.length).toBeGreaterThan(1);
    // Each segment is within the byte cap (an event's own size can be counted,
    // but no segment packs beyond the cap once it holds >1 event).
    for (const segment of segments) {
      const segmentBytes = segment.events.reduce(
        (sum, event) => sum + JSON.stringify(event).length,
        0
      );
      expect(segmentBytes).toBeLessThanOrEqual(SEGMENT_MAX_BYTES);
    }
    // Seqs are contiguous from the requested start.
    expect(segments.map((segment) => segment.seq)).toEqual(
      segments.map((_unused, index) => 1 + index)
    );
    // Concatenating the segments' events round-trips the full input in order.
    const flattened = segments.flatMap((segment) => segment.events);
    expect(flattened.map((event) => event.id)).toEqual(
      events.map((event) => event.id)
    );
    expect(flattened).toEqual(events);
  });

  it("ships an oversized single event as its own segment (never drops it)", () => {
    // A single event larger than the cap must still ship — at least one event
    // per segment (design §7.3 step 3a).
    const oversized = makeEvent("huge", "y".repeat(SEGMENT_MAX_BYTES + 1_000));
    const segments = splitFrozenIntoSegments([oversized], 5);
    expect(segments).toHaveLength(1);
    expect(segments[0].seq).toBe(5);
    expect(segments[0].events).toHaveLength(1);
    expect(segments[0].events[0].id).toBe("huge");
  });
});

describe("deriveImportedSessionId", () => {
  it("is deterministic per (orgId, sourceSessionId) and keeps the imported-session prefix", async () => {
    const first = await deriveImportedSessionId("org-1", "remote-1");
    const second = await deriveImportedSessionId("org-1", "remote-1");
    const otherSession = await deriveImportedSessionId("org-1", "remote-2");
    const otherOrg = await deriveImportedSessionId("org-2", "remote-1");
    expect(first).toBe(second);
    expect(first).toMatch(/^imported-session-[0-9a-f]{32}$/);
    expect(otherSession).not.toBe(first);
    expect(otherOrg).not.toBe(first);
  });
});

describe("importRemoteSession", () => {
  const store = createInstrumentedStore();
  const profile = { supabaseUrl: "https://team.supabase.co", anonKey: "k" };

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
      eventsCount: 1,
      eventsTailHash: undefined,
      ...overrides,
    };
  }

  function makeSnapshot(): SessionEventSegmentsSnapshot {
    return {
      epoch: 1,
      frozenSeq: 1,
      tailHash: null,
      count: 1,
      segments: [
        {
          seq: 1,
          isTail: false,
          events: [
            {
              id: "e1",
              sessionId: "remote-1",
              displayStatus: "completed",
            } as unknown as SessionEvent,
          ],
          eventCount: 1,
          segmentHash: "h1",
        },
      ],
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    store.set(sessionsAtom, []);
    eventStoreMock.set.mockResolvedValue(undefined);
    eventStoreMock.clear.mockResolvedValue(undefined);
    eventStoreMock.getPersistedEvents.mockResolvedValue([]);
    eventStoreMock.saveToCache.mockResolvedValue(1);
  });

  it("rejects on a failed durable write, clears the orphan, and reuses the deterministic id on retry", async () => {
    const client = {
      getSessionEventSegments: vi.fn(async () => makeSnapshot()),
    } satisfies Pick<CollabSyncBackendClient, "getSessionEventSegments">;
    // The durable cache write fails (transient SQLite lock → swallowed → 0).
    eventStoreMock.saveToCache.mockResolvedValueOnce(0);

    await expect(
      importRemoteSession({
        client,
        profile,
        orgId: "org-1",
        remoteSession: makeRemote(),
      })
    ).rejects.toThrow(/durably persist/);

    const expectedId = await deriveImportedSessionId("org-1", "remote-1");
    // The events landed on the deterministic id and the orphaned store
    // entry was removed again (no session record points at it).
    expect(eventStoreMock.set).toHaveBeenCalledTimes(1);
    expect(eventStoreMock.set.mock.calls[0][1]).toBe(expectedId);
    expect(eventStoreMock.clear).toHaveBeenCalledWith(expectedId);
    expect(store.get(sessionsAtom)).toHaveLength(0);

    // The retry lands on the SAME id — one orphan slot, not one per cycle.
    const result = await importRemoteSession({
      client,
      profile,
      orgId: "org-1",
      remoteSession: makeRemote(),
    });
    expect(result?.localSessionId).toBe(expectedId);
    expect(result?.updated).toBe(true);
    expect(eventStoreMock.set).toHaveBeenCalledTimes(2);
    expect(eventStoreMock.set.mock.calls[1][1]).toBe(expectedId);
  });

  it("dedups concurrent imports of the same remote session in flight", async () => {
    let resolveFirstFetch!: (snapshot: SessionEventSegmentsSnapshot) => void;
    const client = {
      getSessionEventSegments: vi
        .fn<() => Promise<SessionEventSegmentsSnapshot>>()
        .mockImplementationOnce(
          () =>
            new Promise<SessionEventSegmentsSnapshot>((resolve) => {
              resolveFirstFetch = resolve;
            })
        )
        .mockResolvedValue({
          ...makeSnapshot(),
          frozenSeq: 2,
          count: 2,
          segments: [
            ...makeSnapshot().segments,
            {
              seq: 2,
              isTail: false,
              events: [
                {
                  id: "e2",
                  sessionId: "remote-1",
                  displayStatus: "completed",
                } as unknown as SessionEvent,
              ],
              eventCount: 1,
              segmentHash: "h2",
            },
          ],
        }),
    } satisfies Pick<CollabSyncBackendClient, "getSessionEventSegments">;

    // Engine PullLoop and a panel replay click race on the same session:
    // the second call must share the first call's in-flight promise.
    const first = importRemoteSession({
      client,
      profile,
      orgId: "org-1",
      remoteSession: makeRemote(),
    });
    const second = importRemoteSession({
      client,
      profile,
      orgId: "org-1",
      remoteSession: makeRemote(),
    });
    expect(client.getSessionEventSegments).toHaveBeenCalledTimes(1);

    resolveFirstFetch(makeSnapshot());
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult?.localSessionId).toBe(secondResult?.localSessionId);
    expect(eventStoreMock.set).toHaveBeenCalledTimes(1);

    // The in-flight entry is cleared afterwards: a later call with a newer
    // remote summary fetches again instead of returning the stale promise.
    const third = await importRemoteSession({
      client,
      profile,
      orgId: "org-1",
      remoteSession: makeRemote({ eventsFrozenSeq: 2, eventsCount: 2 }),
    });
    expect(client.getSessionEventSegments).toHaveBeenCalledTimes(2);
    expect(third?.updated).toBe(true);
  });
});

describe("forkSession (design §16.11, fork & continue)", () => {
  const store = createInstrumentedStore();
  const profile = { supabaseUrl: "https://team.supabase.co", anonKey: "k" };
  const org: CollabOrgRecord = {
    id: "org-1",
    name: "Org",
    repoScopes: ["/repo/shared"],
    createdAt: "2026-07-01T00:00:00.000Z",
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

  function makeSnapshot(): SessionEventSegmentsSnapshot {
    return {
      epoch: 1,
      frozenSeq: 1,
      tailHash: null,
      count: 2,
      segments: [
        {
          seq: 1,
          isTail: false,
          events: [
            {
              id: "e1",
              sessionId: "remote-1",
              displayStatus: "completed",
            } as unknown as SessionEvent,
            {
              id: "e2",
              sessionId: "remote-1",
              displayStatus: "completed",
            } as unknown as SessionEvent,
          ],
          eventCount: 2,
          segmentHash: "h1",
        },
      ],
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    store.set(sessionsAtom, []);
    eventStoreMock.set.mockResolvedValue(undefined);
    eventStoreMock.clear.mockResolvedValue(undefined);
    eventStoreMock.getPersistedEvents.mockResolvedValue([]);
    eventStoreMock.saveToCache.mockResolvedValue(1);
  });

  it("creates a WRITABLE session with forkedFrom provenance and persisted events", async () => {
    const client = {
      getSessionEventSegments: vi.fn(async () => makeSnapshot()),
    } satisfies Pick<CollabSyncBackendClient, "getSessionEventSegments">;

    const result = await forkSession({
      client,
      profile,
      orgId: "org-1",
      remoteSession: makeRemote(),
    });

    expect(result).not.toBeNull();
    // A fresh NORMAL runnable id — not the read-only import namespace.
    expect(result!.localSessionId).toMatch(/^agentsession-/);
    expect(result!.localSessionId).not.toMatch(/^imported-session-/);
    expect(result!.eventCount).toBe(2);

    // Events were rewritten onto the fork id and durably cached.
    expect(eventStoreMock.set).toHaveBeenCalledTimes(1);
    const [writtenEvents, writtenId] = eventStoreMock.set.mock.calls[0];
    expect(writtenId).toBe(result!.localSessionId);
    expect(
      (writtenEvents as SessionEvent[]).map((event) => event.sessionId)
    ).toEqual([result!.localSessionId, result!.localSessionId]);
    expect(eventStoreMock.saveToCache).toHaveBeenCalledWith(
      result!.localSessionId
    );

    const record = (store.get(sessionsAtom) as Session[]).find(
      (session) => session.session_id === result!.localSessionId
    );
    expect(record).toBeDefined();
    // Writable, runnable, NOT a read-only replay copy.
    expect(record!.category).toBe("rust_agent");
    expect(record!.importedFrom).toBeUndefined();
    expect(record!.forkedFrom).toEqual({
      orgId: "org-1",
      sourceSessionId: "remote-1",
      ownerMemberId: "m2",
      ownerDisplayName: "Bob",
      atCount: 2,
      forkedAt: expect.any(String),
    });
    expect(record!.repoPath).toBe("/repo/shared");
    expect(record!.name).toBe("⑂ Remote session");
  });

  it("is push-eligible (unlike an import): the continuation syncs back as MY session", async () => {
    const client = {
      getSessionEventSegments: vi.fn(async () => makeSnapshot()),
    } satisfies Pick<CollabSyncBackendClient, "getSessionEventSegments">;

    const result = await forkSession({
      client,
      profile,
      orgId: "org-1",
      remoteSession: makeRemote(),
    });
    const record = (store.get(sessionsAtom) as Session[]).find(
      (session) => session.session_id === result!.localSessionId
    )!;

    // isSessionPushAllowed excludes only category==='external_history' and
    // importedFrom-bearing sessions — a fork has neither, so with an
    // in-scope repo + FULL_REPLAY it pushes under MY member id (§16.11).
    expect(isSessionPushAllowed(record, org, createSettings())).toBe(true);

    // Contrast: the read-only import of the SAME remote session is excluded
    // (echo-loop guard P6) — the fork deliberately is not.
    const imported = await importRemoteSession({
      client,
      profile,
      orgId: "org-1",
      remoteSession: makeRemote(),
    });
    const importedRecord = (store.get(sessionsAtom) as Session[]).find(
      (session) => session.session_id === imported!.localSessionId
    )!;
    expect(isSessionPushAllowed(importedRecord, org, createSettings())).toBe(
      false
    );
  });

  it("returns null for a metadata-only session without fetching anything", async () => {
    const client = {
      getSessionEventSegments: vi.fn(async () => makeSnapshot()),
    } satisfies Pick<CollabSyncBackendClient, "getSessionEventSegments">;

    const result = await forkSession({
      client,
      profile,
      orgId: "org-1",
      remoteSession: makeRemote({
        eventsEpoch: undefined,
        eventsFrozenSeq: undefined,
        eventsCount: undefined,
      }),
    });

    expect(result).toBeNull();
    expect(client.getSessionEventSegments).not.toHaveBeenCalled();
    expect(store.get(sessionsAtom)).toHaveLength(0);
  });

  it("throws on a failed durable write and leaves no session record behind", async () => {
    const client = {
      getSessionEventSegments: vi.fn(async () => makeSnapshot()),
    } satisfies Pick<CollabSyncBackendClient, "getSessionEventSegments">;
    // The durable cache write fails (swallowed error → 0 rows saved).
    eventStoreMock.saveToCache.mockResolvedValueOnce(0);

    await expect(
      forkSession({
        client,
        profile,
        orgId: "org-1",
        remoteSession: makeRemote(),
      })
    ).rejects.toThrow(/durably persist/);

    // The orphaned event-store entry was dropped again and no record claims
    // the fork exists (events-first ordering, mirroring the importer).
    const forkId = eventStoreMock.set.mock.calls[0][1];
    expect(eventStoreMock.clear).toHaveBeenCalledWith(forkId);
    expect(store.get(sessionsAtom)).toHaveLength(0);
  });
});
