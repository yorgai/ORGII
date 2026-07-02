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

import {
  getEffectiveAccessMode,
  isRepoPathInScope,
  isSessionPushAllowed,
  toRemoteMetadata,
} from "./collabSyncUtils";

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
  accessMode: CollabSessionAccessSettings["accessMode"],
  overrides: Partial<CollabSessionAccessSettings> = {}
): CollabSessionAccessSettings {
  return {
    orgId: ORG.id,
    memberId: "member-1",
    accessMode,
    workspaceScope: COLLAB_WORKSPACE_SCOPE.SELECTED_WORKSPACES,
    workspacePaths: [],
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("getEffectiveAccessMode", () => {
  const MODES = [
    COLLAB_SESSION_ACCESS_MODE.OFF,
    COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY,
    COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY,
  ] as const;

  it("falls through to the member default when nothing else applies", () => {
    for (const mode of MODES) {
      expect(
        getEffectiveAccessMode(createSession({}), createSettings(mode))
      ).toBe(mode);
    }
  });

  it("lets a per-session override beat the member default in every direction", () => {
    for (const defaultMode of MODES) {
      for (const overrideMode of MODES) {
        expect(
          getEffectiveAccessMode(
            createSession({}),
            createSettings(defaultMode, {
              sessionOverrides: { "session-1": overrideMode },
            })
          )
        ).toBe(overrideMode);
      }
    }
  });

  it("ignores overrides keyed to other sessions", () => {
    expect(
      getEffectiveAccessMode(
        createSession({}),
        createSettings(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY, {
          sessionOverrides: { "session-2": COLLAB_SESSION_ACCESS_MODE.OFF },
        })
      )
    ).toBe(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY);
  });

  it("gates sessions created before shareSince to OFF", () => {
    expect(
      getEffectiveAccessMode(
        createSession({ created_at: "2026-06-30T23:59:59.000Z" }),
        createSettings(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY, {
          shareSince: "2026-07-01T00:00:00.000Z",
        })
      )
    ).toBe(COLLAB_SESSION_ACCESS_MODE.OFF);
  });

  it("passes sessions created at or after shareSince through to the default", () => {
    for (const createdAt of [
      "2026-07-01T00:00:00.000Z",
      "2026-07-02T00:00:00.000Z",
    ]) {
      expect(
        getEffectiveAccessMode(
          createSession({ created_at: createdAt }),
          createSettings(COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY, {
            shareSince: "2026-07-01T00:00:00.000Z",
          })
        )
      ).toBe(COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY);
    }
  });

  it("lets an explicit override re-share a pre-shareSince session (escape hatch)", () => {
    expect(
      getEffectiveAccessMode(
        createSession({ created_at: "2020-01-01T00:00:00.000Z" }),
        createSettings(COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY, {
          shareSince: "2026-07-01T00:00:00.000Z",
          sessionOverrides: {
            "session-1": COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY,
          },
        })
      )
    ).toBe(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY);
  });

  it("gates to OFF when timestamps are unparseable (privacy-first)", () => {
    expect(
      getEffectiveAccessMode(
        createSession({ created_at: "not-a-date" }),
        createSettings(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY, {
          shareSince: "2026-07-01T00:00:00.000Z",
        })
      )
    ).toBe(COLLAB_SESSION_ACCESS_MODE.OFF);
    expect(
      getEffectiveAccessMode(
        createSession({}),
        createSettings(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY, {
          shareSince: "not-a-date",
        })
      )
    ).toBe(COLLAB_SESSION_ACCESS_MODE.OFF);
  });
});

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

  it("blocks a session overridden to OFF even when the default is on", () => {
    expect(
      isSessionPushAllowed(
        createSession({}),
        ORG,
        createSettings(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY, {
          sessionOverrides: { "session-1": COLLAB_SESSION_ACCESS_MODE.OFF },
        })
      )
    ).toBe(false);
  });

  it("blocks pre-shareSince sessions and lets an override re-open them", () => {
    const gated = createSettings(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY, {
      shareSince: "2026-07-02T00:00:00.000Z",
    });
    expect(isSessionPushAllowed(createSession({}), ORG, gated)).toBe(false);
    expect(
      isSessionPushAllowed(createSession({}), ORG, {
        ...gated,
        sessionOverrides: {
          "session-1": COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY,
        },
      })
    ).toBe(true);
  });
});

describe("toRemoteMetadata sharing fields", () => {
  const MEMBER = {
    id: "member-1",
    orgId: ORG.id,
    displayName: "Ada",
    avatar: { initials: "A", variant: "v" },
    role: "member",
    identityKind: "human",
    joinedAt: "2026-07-01T00:00:00.000Z",
  } as const;

  it("publishes org visibility and a replay level derived from the effective mode", () => {
    const replay = toRemoteMetadata(
      createSession({}),
      ORG,
      MEMBER,
      createSettings(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY)
    );
    expect(replay.visibility).toBe("org");
    expect(replay.replayLevel).toBe("replay");
    expect(replay.accessMode).toBe(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY);

    const metadataOnly = toRemoteMetadata(
      createSession({}),
      ORG,
      MEMBER,
      createSettings(COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY)
    );
    expect(metadataOnly.replayLevel).toBe("metadata");
  });

  it("carries the per-session override into accessMode and replayLevel", () => {
    const overridden = toRemoteMetadata(
      createSession({}),
      ORG,
      MEMBER,
      createSettings(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY, {
        sessionOverrides: {
          "session-1": COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY,
        },
      })
    );
    expect(overridden.accessMode).toBe(
      COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY
    );
    expect(overridden.replayLevel).toBe("metadata");
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
