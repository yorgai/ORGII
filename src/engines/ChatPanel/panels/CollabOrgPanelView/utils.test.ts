import { describe, expect, it } from "vitest";

import { COLLAB_SESSION_ACCESS_MODE } from "@src/store/collaboration/types";
import type { CollabInviteRecord } from "@src/store/collaboration/types";

import {
  getActiveOrgInvites,
  getSessionsTabBanners,
  isCollabLastAdminError,
  isInviteActive,
  shouldPromptShareOnboarding,
} from "./utils";

describe("shouldPromptShareOnboarding", () => {
  it("asks exactly on the OFF → shared transition", () => {
    expect(
      shouldPromptShareOnboarding(
        COLLAB_SESSION_ACCESS_MODE.OFF,
        COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY
      )
    ).toBe(true);
    expect(
      shouldPromptShareOnboarding(
        COLLAB_SESSION_ACCESS_MODE.OFF,
        COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY
      )
    ).toBe(true);
  });

  it("does not re-ask when moving between non-OFF levels", () => {
    expect(
      shouldPromptShareOnboarding(
        COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY,
        COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY
      )
    ).toBe(false);
    expect(
      shouldPromptShareOnboarding(
        COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY,
        COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY
      )
    ).toBe(false);
  });

  it("does not ask when switching off or staying off", () => {
    expect(
      shouldPromptShareOnboarding(
        COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY,
        COLLAB_SESSION_ACCESS_MODE.OFF
      )
    ).toBe(false);
    expect(
      shouldPromptShareOnboarding(
        COLLAB_SESSION_ACCESS_MODE.OFF,
        COLLAB_SESSION_ACCESS_MODE.OFF
      )
    ).toBe(false);
  });

  it("does not ask when the current mode is unknown (no settings row yet)", () => {
    // The default settings are OFF, but a missing row means the selection UI
    // has not resolved yet — the caller passes the resolved default instead.
    expect(
      shouldPromptShareOnboarding(
        undefined,
        COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY
      )
    ).toBe(false);
  });
});

describe("getSessionsTabBanners", () => {
  it("reports the OFF gate and the empty-repo-scope gate separately", () => {
    expect(
      getSessionsTabBanners({
        accessMode: COLLAB_SESSION_ACCESS_MODE.OFF,
        repoScopes: [],
      })
    ).toEqual({
      showAccessOffBanner: true,
      showRepoScopesEmptyBanner: true,
    });
  });

  it("shows no banners for a shared member in a scoped org", () => {
    expect(
      getSessionsTabBanners({
        accessMode: COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY,
        repoScopes: ["/repo/shared"],
      })
    ).toEqual({
      showAccessOffBanner: false,
      showRepoScopesEmptyBanner: false,
    });
  });

  it("treats missing repoScopes as empty", () => {
    expect(
      getSessionsTabBanners({
        accessMode: COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY,
        repoScopes: undefined,
      }).showRepoScopesEmptyBanner
    ).toBe(true);
  });

  it("does not show the OFF banner while settings are unresolved", () => {
    expect(
      getSessionsTabBanners({
        accessMode: undefined,
        repoScopes: ["/repo/shared"],
      }).showAccessOffBanner
    ).toBe(false);
  });
});

const NOW_MS = Date.parse("2026-07-01T12:00:00.000Z");

function createInvite(
  overrides: Partial<CollabInviteRecord>
): CollabInviteRecord {
  return {
    id: "inv-1",
    orgId: "org-1",
    usageLimit: 1,
    usageCount: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("isInviteActive", () => {
  it("accepts a fresh invite with uses left and a future expiry", () => {
    expect(
      isInviteActive(
        createInvite({ expiresAt: "2026-07-08T00:00:00.000Z" }),
        NOW_MS
      )
    ).toBe(true);
  });

  it("rejects revoked, exhausted, and expired invites", () => {
    expect(
      isInviteActive(
        createInvite({ revokedAt: "2026-07-01T01:00:00.000Z" }),
        NOW_MS
      )
    ).toBe(false);
    expect(
      isInviteActive(createInvite({ usageLimit: 1, usageCount: 1 }), NOW_MS)
    ).toBe(false);
    expect(
      isInviteActive(
        createInvite({ expiresAt: "2026-07-01T11:59:59.000Z" }),
        NOW_MS
      )
    ).toBe(false);
  });

  it("treats a missing expiry as never expiring", () => {
    expect(isInviteActive(createInvite({}), NOW_MS)).toBe(true);
  });
});

describe("getActiveOrgInvites", () => {
  it("filters to the org's active invites, newest first", () => {
    const invites = [
      createInvite({ id: "old", createdAt: "2026-06-30T00:00:00.000Z" }),
      createInvite({ id: "other-org", orgId: "org-2" }),
      createInvite({ id: "revoked", revokedAt: "2026-07-01T01:00:00.000Z" }),
      createInvite({ id: "new", createdAt: "2026-07-01T02:00:00.000Z" }),
    ];
    expect(
      getActiveOrgInvites(invites, "org-1", NOW_MS).map((invite) => invite.id)
    ).toEqual(["new", "old"]);
  });
});

describe("isCollabLastAdminError", () => {
  it("detects the ORGII_LAST_ADMIN server code and nothing else", () => {
    expect(isCollabLastAdminError(new Error("ORGII_LAST_ADMIN"))).toBe(true);
    expect(isCollabLastAdminError(new Error("ORGII_UNAUTHORIZED"))).toBe(false);
    expect(isCollabLastAdminError("ORGII_LAST_ADMIN")).toBe(false);
  });
});
