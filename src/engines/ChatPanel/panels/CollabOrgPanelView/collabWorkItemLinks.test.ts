import { describe, expect, it } from "vitest";

import type { LinkedSession } from "@src/api/http/project";
import {
  COLLAB_IDENTITY_KIND,
  COLLAB_ROLE,
} from "@src/store/collaboration/types";
import type {
  CollabMemberRecord,
  RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";

import {
  LINKED_SESSION_RESOLUTION,
  resolveLinkedSession,
  resolveLockHolder,
  resolveWorkItemLinkedSessions,
} from "./collabWorkItemLinks";

function linked(overrides: Partial<LinkedSession>): LinkedSession {
  return {
    session_id: "sess-1",
    session_type: "native",
    agent_role: "coding",
    started_at: "2026-07-01T00:00:00.000Z",
    status: "completed",
    cost_usd: 0,
    total_tokens: 0,
    ...overrides,
  };
}

function remote(
  overrides: Partial<RemoteTeammateSessionMetadata>
): RemoteTeammateSessionMetadata {
  return {
    id: "org-1:member-2:sess-1",
    orgId: "org-1",
    ownerMemberId: "member-2",
    ownerUserId: "user-2",
    ownerDisplayName: "Bob",
    ownerIdentityKind: COLLAB_IDENTITY_KIND.HUMAN,
    sourceSessionId: "sess-1",
    title: "Refactor auth",
    eventsEpoch: undefined,
    eventsFrozenSeq: undefined,
    eventsCount: undefined,
    eventsTailHash: undefined,
    ...overrides,
  };
}

function member(overrides: Partial<CollabMemberRecord>): CollabMemberRecord {
  return {
    id: "member-1",
    orgId: "org-1",
    displayName: "Alice",
    avatar: { initials: "AL", variant: "a" },
    role: COLLAB_ROLE.MEMBER,
    identityKind: COLLAB_IDENTITY_KIND.HUMAN,
    joinedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveLinkedSession", () => {
  it("returns replay when a shared record has published segments", () => {
    const resolved = resolveLinkedSession(linked({}), "org-1", [
      remote({ eventsEpoch: 1, eventsCount: 42 }),
    ]);
    expect(resolved.kind).toBe(LINKED_SESSION_RESOLUTION.REPLAY);
    expect(resolved.remoteSession?.sourceSessionId).toBe("sess-1");
    expect(resolved.ownerDisplayName).toBe("Bob");
  });

  it("returns metadata when a shared record exists but has no segments", () => {
    const resolved = resolveLinkedSession(linked({}), "org-1", [
      remote({ eventsEpoch: undefined }),
    ]);
    expect(resolved.kind).toBe(LINKED_SESSION_RESOLUTION.METADATA);
    expect(resolved.remoteSession).toBeDefined();
  });

  it("returns none when no shared record matches the session id", () => {
    const resolved = resolveLinkedSession(
      linked({ session_id: "sess-x" }),
      "org-1",
      [remote({ eventsEpoch: 1 })]
    );
    expect(resolved.kind).toBe(LINKED_SESSION_RESOLUTION.NONE);
    expect(resolved.remoteSession).toBeUndefined();
  });

  it("scopes matching to the org (no cross-org leakage)", () => {
    const resolved = resolveLinkedSession(linked({}), "org-1", [
      remote({ orgId: "org-2", eventsEpoch: 1 }),
    ]);
    expect(resolved.kind).toBe(LINKED_SESSION_RESOLUTION.NONE);
  });

  it("ignores tombstoned shared records", () => {
    const resolved = resolveLinkedSession(linked({}), "org-1", [
      remote({ eventsEpoch: 1, deletedAt: "2026-07-01T01:00:00.000Z" }),
    ]);
    expect(resolved.kind).toBe(LINKED_SESSION_RESOLUTION.NONE);
  });

  it("treats eventsEpoch 0 as replay-capable (published, empty history)", () => {
    const resolved = resolveLinkedSession(linked({}), "org-1", [
      remote({ eventsEpoch: 0, eventsCount: 0 }),
    ]);
    expect(resolved.kind).toBe(LINKED_SESSION_RESOLUTION.REPLAY);
  });
});

describe("resolveWorkItemLinkedSessions", () => {
  it("resolves every linked session, preserving order", () => {
    const workItem = {
      linkedSessions: [
        linked({ session_id: "a" }),
        linked({ session_id: "b" }),
        linked({ session_id: "c" }),
      ],
    };
    const resolved = resolveWorkItemLinkedSessions(workItem, "org-1", [
      remote({ id: "r-a", sourceSessionId: "a", eventsEpoch: 1 }),
      remote({ id: "r-c", sourceSessionId: "c" }),
    ]);
    expect(resolved.map((entry) => entry.kind)).toEqual([
      LINKED_SESSION_RESOLUTION.REPLAY,
      LINKED_SESSION_RESOLUTION.NONE,
      LINKED_SESSION_RESOLUTION.METADATA,
    ]);
  });

  it("returns an empty list when the work item has no linked sessions", () => {
    expect(
      resolveWorkItemLinkedSessions({ linkedSessions: [] }, "org-1", [])
    ).toEqual([]);
  });
});

describe("resolveLockHolder", () => {
  const members = [
    member({ id: "member-1", displayName: "Alice" }),
    member({ id: "member-2", displayName: "Bob" }),
  ];

  it("flags a lock held by a different member and resolves the name", () => {
    const holder = resolveLockHolder("member-2", "member-1", members);
    expect(holder.heldByOther).toBe(true);
    expect(holder.holderName).toBe("Bob");
    expect(holder.holderMemberId).toBe("member-2");
  });

  it("does not flag a lock held by the current member", () => {
    const holder = resolveLockHolder("member-1", "member-1", members);
    expect(holder.heldByOther).toBe(false);
    expect(holder.holderName).toBe("Alice");
  });

  it("treats an absent lockedByMemberId as an un-held (local) lock", () => {
    for (const value of [undefined, null, ""] as const) {
      const holder = resolveLockHolder(value, "member-1", members);
      expect(holder.heldByOther).toBe(false);
      expect(holder.holderMemberId).toBeNull();
      expect(holder.holderName).toBeNull();
    }
  });

  it("falls back to the raw id when the holder is not a known member", () => {
    const holder = resolveLockHolder("ghost", "member-1", members);
    expect(holder.heldByOther).toBe(true);
    expect(holder.holderName).toBe("ghost");
  });
});
