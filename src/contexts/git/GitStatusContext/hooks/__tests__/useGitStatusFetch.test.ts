import { describe, expect, it } from "vitest";

import { shouldStartGitStatusFetch } from "../useGitStatusFetch";

describe("shouldStartGitStatusFetch", () => {
  it("starts when no git status fetch is in progress", () => {
    expect(
      shouldStartGitStatusFetch({
        fetchInProgress: false,
        activeFetchRepoId: null,
        selectedRepoId: "repo-a",
      })
    ).toBe(true);
  });

  it("skips duplicate fetches for the same selected repo", () => {
    expect(
      shouldStartGitStatusFetch({
        fetchInProgress: true,
        activeFetchRepoId: "repo-a",
        selectedRepoId: "repo-a",
      })
    ).toBe(false);
  });

  it("allows the final repo switch to supersede an older in-flight fetch", () => {
    expect(
      shouldStartGitStatusFetch({
        fetchInProgress: true,
        activeFetchRepoId: "repo-a",
        selectedRepoId: "repo-b",
      })
    ).toBe(true);
  });
});
