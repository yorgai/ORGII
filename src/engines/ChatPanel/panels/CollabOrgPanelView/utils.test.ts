import { describe, expect, it } from "vitest";

import { COLLAB_SESSION_ACCESS_MODE } from "@src/store/collaboration/types";

import { getSessionsTabBanners, shouldPromptShareOnboarding } from "./utils";

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
