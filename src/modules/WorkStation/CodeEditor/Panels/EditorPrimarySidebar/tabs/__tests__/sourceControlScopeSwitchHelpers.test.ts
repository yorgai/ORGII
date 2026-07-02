import { describe, expect, it } from "vitest";

import {
  isScopeIdentityChanging,
  scopeIdentityKey,
  shouldShowScopePaneLoading,
} from "../sourceControlScopeSwitchHelpers";

describe("scopeIdentityKey", () => {
  it("returns local for the main checkout scope", () => {
    expect(scopeIdentityKey({ kind: "local" })).toBe("local");
  });

  it("normalizes worktree paths for stable identity", () => {
    expect(
      scopeIdentityKey({ kind: "worktree", path: "/tmp/orgii/agent-a/" })
    ).toBe("/tmp/orgii/agent-a");
  });
});

describe("isScopeIdentityChanging", () => {
  it("detects when the scope identity changed", () => {
    expect(isScopeIdentityChanging("local", "local")).toBe(false);
    expect(isScopeIdentityChanging("local", "/tmp/wt-a")).toBe(true);
    expect(isScopeIdentityChanging("/tmp/wt-a", "/tmp/wt-b")).toBe(true);
  });
});

describe("shouldShowScopePaneLoading", () => {
  it("shows loading while the worktree list is still resolving the scope", () => {
    expect(
      shouldShowScopePaneLoading({
        pendingWorktreeScope: true,
        scopeIdentityChanging: false,
        paneLoading: false,
      })
    ).toBe(true);
  });

  it("shows loading immediately when the scope identity is changing", () => {
    expect(
      shouldShowScopePaneLoading({
        pendingWorktreeScope: false,
        scopeIdentityChanging: true,
        paneLoading: false,
      })
    ).toBe(true);
  });

  it("shows loading while the active pane is fetching git status", () => {
    expect(
      shouldShowScopePaneLoading({
        pendingWorktreeScope: false,
        scopeIdentityChanging: false,
        paneLoading: true,
      })
    ).toBe(true);
  });

  it("hides loading when the scope is stable and the pane is ready", () => {
    expect(
      shouldShowScopePaneLoading({
        pendingWorktreeScope: false,
        scopeIdentityChanging: false,
        paneLoading: false,
      })
    ).toBe(false);
  });
});
