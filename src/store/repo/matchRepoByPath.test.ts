import { describe, expect, it } from "vitest";

import {
  matchRepoByPath,
  normalizeRepoPath,
  toRepoFileSystemPath,
} from "./matchRepoByPath";
import { REPO_KIND, type Repo } from "./types";

const repo: Repo = {
  id: "repo-1",
  name: "ORGII",
  path: "/Users/laptop-h/Documents/GitHub/ORGII",
  fs_uri: "file:///Users/laptop-h/Documents/GitHub/ORGII",
  kind: REPO_KIND.GIT,
};

describe("matchRepoByPath", () => {
  it("matches file URLs against filesystem paths", () => {
    expect(
      matchRepoByPath([repo], "file:///Users/laptop-h/Documents/GitHub/ORGII/")
        ?.id
    ).toBe("repo-1");
  });

  it("preserves case for filesystem use while normalizing for comparison", () => {
    expect(toRepoFileSystemPath("file:///Users/Shared/MyRepo/")).toBe(
      "/Users/Shared/MyRepo"
    );
    expect(normalizeRepoPath("file:///Users/Shared/MyRepo/")).toBe(
      "/users/shared/myrepo"
    );
  });
});
