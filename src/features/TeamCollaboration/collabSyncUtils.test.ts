import { describe, expect, it } from "vitest";

import {
  COLLAB_SESSION_ACCESS_MODE,
  COLLAB_WORKSPACE_SCOPE,
} from "@src/store/collaboration/types";
import type {
  CollabOrgRecord,
  CollabSessionAccessSettings,
} from "@src/store/collaboration/types";
import type { Session } from "@src/store/session/sessionAtom/types";

import { isRepoPathInScope, isSessionPushAllowed } from "./collabSyncUtils";

const ORG: CollabOrgRecord = {
  id: "org-1",
  name: "Team Alpha",
  repoScopes: ["/repo/shared"],
  createdAt: "2026-07-01T00:00:00.000Z",
};

function createSession(overrides: Partial<Session>): Session {
  return {
    session_id: "session-1",
    status: "completed",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    repoPath: "/repo/shared",
    ...overrides,
  };
}

function createSettings(
  accessMode: CollabSessionAccessSettings["accessMode"]
): CollabSessionAccessSettings {
  return {
    orgId: ORG.id,
    memberId: "member-1",
    accessMode,
    workspaceScope: COLLAB_WORKSPACE_SCOPE.SELECTED_WORKSPACES,
    workspacePaths: [],
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("isSessionPushAllowed", () => {
  it("allows an in-scope local session when access mode is on", () => {
    expect(
      isSessionPushAllowed(
        createSession({}),
        ORG,
        createSettings(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY)
      )
    ).toBe(true);
  });

  it("never pushes imported external_history sessions (echo loop guard)", () => {
    expect(
      isSessionPushAllowed(
        createSession({ category: "external_history" }),
        ORG,
        createSettings(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY)
      )
    ).toBe(false);
  });

  it("blocks pushes when access mode is off", () => {
    expect(
      isSessionPushAllowed(
        createSession({}),
        ORG,
        createSettings(COLLAB_SESSION_ACCESS_MODE.OFF)
      )
    ).toBe(false);
  });

  it("blocks sessions outside the org repo scope", () => {
    expect(
      isSessionPushAllowed(
        createSession({ repoPath: "/repo/private" }),
        ORG,
        createSettings(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY)
      )
    ).toBe(false);
  });
});

describe("isRepoPathInScope", () => {
  it("matches after trailing-slash normalization", () => {
    expect(isRepoPathInScope("/repo/shared/", ["/repo/shared"])).toBe(true);
  });

  it("rejects when scope list is empty", () => {
    expect(isRepoPathInScope("/repo/shared", [])).toBe(false);
  });
});
