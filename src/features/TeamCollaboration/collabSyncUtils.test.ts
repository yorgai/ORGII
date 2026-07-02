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
  createDefaultAccessSettings,
  getEffectiveAccessMode,
  getSessionVisibility,
  getShareCapableOrgsForSession,
  isRepoPathInScope,
  isSessionPushAllowed,
  normalizeRepoScopeKey,
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

  it("publishes 'restricted' when the owner explicitly picked it (M4b rule)", () => {
    const restricted = toRemoteMetadata(
      createSession({}),
      ORG,
      MEMBER,
      createSettings(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY, {
        sessionVisibility: { "session-1": "restricted" },
      })
    );
    expect(restricted.visibility).toBe("restricted");
  });

  it("keeps 'org' visibility when the restricted entry targets another session", () => {
    const other = toRemoteMetadata(
      createSession({}),
      ORG,
      MEMBER,
      createSettings(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY, {
        sessionVisibility: { "session-2": "restricted" },
      })
    );
    expect(other.visibility).toBe("org");
  });
});

describe("getSessionVisibility", () => {
  it("defaults to org and honors only an explicit 'restricted' entry", () => {
    const settings = createSettings(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY);
    expect(getSessionVisibility(createSession({}), settings)).toBe("org");
    expect(
      getSessionVisibility(
        createSession({}),
        createSettings(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY, {
          sessionVisibility: { "session-1": "restricted" },
        })
      )
    ).toBe("restricted");
    expect(
      getSessionVisibility(
        createSession({}),
        createSettings(COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY, {
          sessionVisibility: { "session-1": "org" },
        })
      )
    ).toBe("org");
  });
});

describe("createDefaultAccessSettings", () => {
  it("defaults to OFF (design §6.3, fix S8 — sharing is opt-in)", () => {
    expect(createDefaultAccessSettings("org-1", "member-1").accessMode).toBe(
      COLLAB_SESSION_ACCESS_MODE.OFF
    );
  });
});

describe("getShareCapableOrgsForSession", () => {
  const CONNECTED_ORG: CollabOrgRecord = {
    ...ORG,
    syncBackend: "supabase",
    supabaseUrl: "https://team.supabase.co",
    supabaseAnonKey: "anon-key",
    memberToken: "member-token",
    localMemberId: "member-1",
  };

  it("returns orgs with a usable credential whose scope contains the repo", () => {
    expect(
      getShareCapableOrgsForSession(createSession({}), [CONNECTED_ORG])
    ).toEqual([CONNECTED_ORG]);
  });

  it("excludes orgs without sync credentials (plain local org)", () => {
    expect(getShareCapableOrgsForSession(createSession({}), [ORG])).toEqual([]);
  });

  it("excludes orgs whose repoScopes miss the session repo", () => {
    expect(
      getShareCapableOrgsForSession(
        createSession({ repoPath: "/repo/private" }),
        [CONNECTED_ORG]
      )
    ).toEqual([]);
  });

  it("never offers sharing for imported teammate sessions", () => {
    expect(
      getShareCapableOrgsForSession(
        createSession({ category: "external_history" }),
        [CONNECTED_ORG]
      )
    ).toEqual([]);
    expect(
      getShareCapableOrgsForSession(
        createSession({
          importedFrom: {
            orgId: "org-1",
            sourceSessionId: "src-1",
            ownerMemberId: "m2",
            epoch: 1,
            seq: 0,
            count: 0,
          },
        }),
        [CONNECTED_ORG]
      )
    ).toEqual([]);
  });
});

describe("normalizeRepoScopeKey", () => {
  it("collapses the three canonical remote forms to host/path (design §8.3)", () => {
    expect(normalizeRepoScopeKey("git@github.com:org/x.git")).toBe(
      "github.com/org/x"
    );
    expect(normalizeRepoScopeKey("https://github.com/org/x.git")).toBe(
      "github.com/org/x"
    );
    expect(normalizeRepoScopeKey("ssh://git@github.com/org/x")).toBe(
      "github.com/org/x"
    );
  });

  it("normalizes remote-form variants: no .git, trailing slash, host case, http, git://", () => {
    expect(normalizeRepoScopeKey("https://github.com/org/x")).toBe(
      "github.com/org/x"
    );
    expect(normalizeRepoScopeKey("https://github.com/org/x/")).toBe(
      "github.com/org/x"
    );
    expect(normalizeRepoScopeKey("https://GitHub.COM/org/x.git")).toBe(
      "github.com/org/x"
    );
    expect(normalizeRepoScopeKey("http://github.com/org/x.git")).toBe(
      "github.com/org/x"
    );
    expect(normalizeRepoScopeKey("git://github.com/org/x.git")).toBe(
      "github.com/org/x"
    );
    expect(normalizeRepoScopeKey("ssh://git@github.com/org/x.git")).toBe(
      "github.com/org/x"
    );
    expect(normalizeRepoScopeKey("git@GitHub.com:org/x")).toBe(
      "github.com/org/x"
    );
    // scp-like with an absolute server path keeps a single leading slash.
    expect(normalizeRepoScopeKey("git@server.local:/srv/git/x.git")).toBe(
      "server.local/srv/git/x"
    );
  });

  it("drops the scheme's default port so an explicit :443/:80/:22 does not split the key", () => {
    expect(normalizeRepoScopeKey("https://github.com:443/org/x.git")).toBe(
      "github.com/org/x"
    );
    expect(normalizeRepoScopeKey("http://github.com:80/org/x")).toBe(
      "github.com/org/x"
    );
    expect(normalizeRepoScopeKey("ssh://git@github.com:22/org/x")).toBe(
      "github.com/org/x"
    );
    // A non-default port is preserved (it identifies a distinct endpoint).
    expect(normalizeRepoScopeKey("https://ghe.corp:8443/org/x")).toBe(
      "ghe.corp:8443/org/x"
    );
  });

  it("folds owner/repo case on case-insensitive hosts but not elsewhere", () => {
    expect(normalizeRepoScopeKey("git@github.com:MyOrg/MyRepo.git")).toBe(
      "github.com/myorg/myrepo"
    );
    expect(normalizeRepoScopeKey("https://GitLab.com/Group/Sub/Repo")).toBe(
      "gitlab.com/group/sub/repo"
    );
    // A self-hosted (case-sensitive) host keeps path case.
    expect(normalizeRepoScopeKey("git@git.corp.local:Team/Repo.git")).toBe(
      "git.corp.local/Team/Repo"
    );
  });

  it("preserves path case on case-sensitive hosts (only the host is lowercased)", () => {
    // Self-hosted git servers are path-case-sensitive, so casing is kept.
    expect(normalizeRepoScopeKey("git@Git.Corp:Org/X.git")).toBe(
      "git.corp/Org/X"
    );
  });

  it("returns non-URL inputs trimmed minus trailing slashes", () => {
    expect(normalizeRepoScopeKey("  /repo/shared/  ")).toBe("/repo/shared");
    expect(normalizeRepoScopeKey("/repo/shared///")).toBe("/repo/shared");
    expect(normalizeRepoScopeKey("/Users/me/my.git.tools")).toBe(
      "/Users/me/my.git.tools"
    );
    expect(normalizeRepoScopeKey("")).toBe("");
    expect(normalizeRepoScopeKey("   ")).toBe("");
  });

  it("does not treat Windows drive letters as scp hosts", () => {
    expect(normalizeRepoScopeKey("C:\\repos\\x")).toBe("C:\\repos\\x");
  });

  it("is idempotent over already-normalized keys", () => {
    expect(normalizeRepoScopeKey("github.com/org/x")).toBe("github.com/org/x");
    expect(
      normalizeRepoScopeKey(normalizeRepoScopeKey("git@github.com:org/x.git"))
    ).toBe("github.com/org/x");
  });
});

describe("isRepoPathInScope", () => {
  it("matches after trailing-slash normalization", () => {
    expect(isRepoPathInScope("/repo/shared/", ["/repo/shared"])).toBe(true);
  });

  it("rejects when scope list is empty", () => {
    expect(isRepoPathInScope("/repo/shared", [])).toBe(false);
  });

  it("keeps path-vs-path matching backward compatible", () => {
    expect(isRepoPathInScope("/repo/shared", ["/repo/shared/"])).toBe(true);
    expect(isRepoPathInScope("/repo/other", ["/repo/shared"])).toBe(false);
  });

  it("matches remote keys across formats (scope stored ≠ format submitted)", () => {
    expect(
      isRepoPathInScope("git@github.com:org/x.git", ["github.com/org/x"])
    ).toBe(true);
    expect(
      isRepoPathInScope("https://github.com/org/x.git", [
        "ssh://git@github.com/org/x",
      ])
    ).toBe(true);
    expect(
      isRepoPathInScope("git@github.com:org/y.git", ["github.com/org/x"])
    ).toBe(false);
  });

  it("does not cross-match a local path against a remote scope key (resolution is submission-side)", () => {
    expect(isRepoPathInScope("/Users/me/x", ["github.com/org/x"])).toBe(false);
  });

  it("matches mixed scope lists on the right entry", () => {
    expect(
      isRepoPathInScope("https://github.com/org/x", [
        "/repo/shared",
        "git@github.com:org/x.git",
      ])
    ).toBe(true);
    expect(
      isRepoPathInScope("/repo/shared/", ["github.com/org/x", "/repo/shared"])
    ).toBe(true);
  });
});
