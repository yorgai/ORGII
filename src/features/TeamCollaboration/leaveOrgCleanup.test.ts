import { describe, expect, it } from "vitest";

import {
  COLLAB_CONNECTION_STATUS,
  COLLAB_IDENTITY_KIND,
  COLLAB_REPO_JOIN_STATUS,
  COLLAB_ROLE,
  COLLAB_SESSION_ACCESS_MODE,
  COLLAB_WORKSPACE_SCOPE,
} from "@src/store/collaboration/types";
import type { Session } from "@src/store/session/sessionAtom/types";

import { computeLeaveOrgCleanup } from "./leaveOrgCleanup";
import type { CollabOrgLocalState } from "./leaveOrgCleanup";

const LEFT_ORG = "org-left";
const OTHER_ORG = "org-kept";

function createSession(overrides: Partial<Session>): Session {
  return {
    session_id: "session-x",
    status: "completed",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function createState(): CollabOrgLocalState {
  const member = (orgId: string, id: string) => ({
    id,
    orgId,
    displayName: id,
    avatar: { initials: "AA", variant: "a" },
    role: COLLAB_ROLE.MEMBER,
    identityKind: COLLAB_IDENTITY_KIND.HUMAN,
    joinedAt: "2026-07-01T00:00:00.000Z",
  });
  return {
    orgs: [
      { id: LEFT_ORG, name: "Left", createdAt: "2026-07-01T00:00:00.000Z" },
      { id: OTHER_ORG, name: "Kept", createdAt: "2026-07-01T00:00:00.000Z" },
    ],
    members: [member(LEFT_ORG, "m-1"), member(OTHER_ORG, "m-2")],
    invites: [
      {
        id: "inv-1",
        orgId: LEFT_ORG,
        usageLimit: 1,
        usageCount: 0,
        createdAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "inv-2",
        orgId: OTHER_ORG,
        usageLimit: 1,
        usageCount: 0,
        createdAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    accessSettings: [
      {
        orgId: LEFT_ORG,
        memberId: "m-1",
        accessMode: COLLAB_SESSION_ACCESS_MODE.OFF,
        workspaceScope: COLLAB_WORKSPACE_SCOPE.SELECTED_WORKSPACES,
        workspacePaths: [],
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        orgId: OTHER_ORG,
        memberId: "m-2",
        accessMode: COLLAB_SESSION_ACCESS_MODE.OFF,
        workspaceScope: COLLAB_WORKSPACE_SCOPE.SELECTED_WORKSPACES,
        workspacePaths: [],
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    repoJoinRequests: [
      {
        requestId: "req-1",
        orgId: LEFT_ORG,
        requesterMemberId: "m-1",
        repoPath: "/repo/a",
        status: COLLAB_REPO_JOIN_STATUS.PENDING,
        createdAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    chatMessages: [
      {
        id: "chat-1",
        orgId: LEFT_ORG,
        authorMemberId: "m-1",
        authorDisplayName: "m-1",
        authorIdentityKind: COLLAB_IDENTITY_KIND.HUMAN,
        body: "hello",
        createdAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "chat-2",
        orgId: OTHER_ORG,
        authorMemberId: "m-2",
        authorDisplayName: "m-2",
        authorIdentityKind: COLLAB_IDENTITY_KIND.HUMAN,
        body: "hi",
        createdAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    snapshotRequests: [
      {
        requestId: "snap-1",
        orgId: LEFT_ORG,
        requesterMemberId: "m-1",
        ownerMemberId: "m-9",
        sourceSessionId: "s-9",
        createdAt: "2026-07-01T00:00:00.000Z",
        status: "pending",
      },
    ],
    remoteSessions: [
      {
        id: `${LEFT_ORG}:m-9:s-9`,
        orgId: LEFT_ORG,
        ownerMemberId: "m-9",
        ownerUserId: "m-9",
        ownerDisplayName: "m-9",
        ownerIdentityKind: COLLAB_IDENTITY_KIND.HUMAN,
        sourceSessionId: "s-9",
        title: "remote",
        eventsEpoch: undefined,
        eventsFrozenSeq: undefined,
        eventsCount: undefined,
        eventsTailHash: undefined,
      },
      {
        id: `${OTHER_ORG}:m-2:s-2`,
        orgId: OTHER_ORG,
        ownerMemberId: "m-2",
        ownerUserId: "m-2",
        ownerDisplayName: "m-2",
        ownerIdentityKind: COLLAB_IDENTITY_KIND.HUMAN,
        sourceSessionId: "s-2",
        title: "kept remote",
        eventsEpoch: undefined,
        eventsFrozenSeq: undefined,
        eventsCount: undefined,
        eventsTailHash: undefined,
      },
    ],
    connectionStates: [
      {
        orgId: LEFT_ORG,
        status: COLLAB_CONNECTION_STATUS.CONNECTED,
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        orgId: OTHER_ORG,
        status: COLLAB_CONNECTION_STATUS.CONNECTED,
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    pushCursors: {
      [`${LEFT_ORG}:s-1`]: {
        orgId: LEFT_ORG,
        sessionId: "s-1",
        epoch: 1,
        frozenSeq: 0,
        pushedCount: 3,
        frozenEventCount: 0,
        frozenChainHash: "hash",
        tailHash: null,
      },
      [`${OTHER_ORG}:s-2`]: {
        orgId: OTHER_ORG,
        sessionId: "s-2",
        epoch: 1,
        frozenSeq: 0,
        pushedCount: 3,
        frozenEventCount: 0,
        frozenChainHash: "hash",
        tailHash: null,
      },
    },
    lastSyncTimestamps: {
      [LEFT_ORG]: "2026-07-01T00:00:00.000Z",
      [OTHER_ORG]: "2026-07-01T00:00:00.000Z",
    },
    sessions: [
      createSession({ session_id: "local-own" }),
      createSession({
        session_id: "imported-from-left",
        category: "external_history",
        importedFrom: {
          orgId: LEFT_ORG,
          sourceSessionId: "s-9",
          ownerMemberId: "m-9",
          ownerDisplayName: "m-9",
          epoch: 1,
          seq: 1,
          count: 3,
          frozenCount: 0,
          importedAt: "2026-07-01T00:00:00.000Z",
        },
      }),
      createSession({
        session_id: "imported-from-kept",
        category: "external_history",
        importedFrom: {
          orgId: OTHER_ORG,
          sourceSessionId: "s-2",
          ownerMemberId: "m-2",
          ownerDisplayName: "m-2",
          epoch: 1,
          seq: 1,
          count: 3,
          frozenCount: 0,
          importedAt: "2026-07-01T00:00:00.000Z",
        },
      }),
    ],
  };
}

describe("computeLeaveOrgCleanup", () => {
  it("removes every org-keyed record of the left org and keeps other orgs intact", () => {
    const result = computeLeaveOrgCleanup(createState(), LEFT_ORG, {
      removeImportedSessions: false,
    });

    expect(result.orgs.map((org) => org.id)).toEqual([OTHER_ORG]);
    expect(result.members.map((member) => member.orgId)).toEqual([OTHER_ORG]);
    expect(result.invites.map((invite) => invite.orgId)).toEqual([OTHER_ORG]);
    expect(result.accessSettings.map((settings) => settings.orgId)).toEqual([
      OTHER_ORG,
    ]);
    expect(result.repoJoinRequests).toEqual([]);
    expect(result.chatMessages.map((message) => message.orgId)).toEqual([
      OTHER_ORG,
    ]);
    expect(result.snapshotRequests).toEqual([]);
    expect(result.remoteSessions.map((session) => session.orgId)).toEqual([
      OTHER_ORG,
    ]);
    expect(result.connectionStates.map((state) => state.orgId)).toEqual([
      OTHER_ORG,
    ]);
    expect(Object.keys(result.pushCursors)).toEqual([`${OTHER_ORG}:s-2`]);
    expect(Object.keys(result.lastSyncTimestamps)).toEqual([OTHER_ORG]);
  });

  it("keeps imported session copies by default (design §8.4)", () => {
    const state = createState();
    const result = computeLeaveOrgCleanup(state, LEFT_ORG, {
      removeImportedSessions: false,
    });
    expect(result.removedSessionIds).toEqual([]);
    // Identity: callers can skip the sessionsAtom write + persistSessions.
    expect(result.sessions).toBe(state.sessions);
  });

  it("removes only the left org's imported copies when opted in", () => {
    const result = computeLeaveOrgCleanup(createState(), LEFT_ORG, {
      removeImportedSessions: true,
    });
    expect(result.removedSessionIds).toEqual(["imported-from-left"]);
    expect(result.sessions.map((session) => session.session_id)).toEqual([
      "local-own",
      "imported-from-kept",
    ]);
  });

  it("is a no-op for an unknown org id", () => {
    const state = createState();
    const result = computeLeaveOrgCleanup(state, "org-unknown", {
      removeImportedSessions: true,
    });
    expect(result.orgs).toHaveLength(2);
    expect(result.removedSessionIds).toEqual([]);
    expect(result.sessions).toBe(state.sessions);
    expect(Object.keys(result.pushCursors)).toHaveLength(2);
  });
});
