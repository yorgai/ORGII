import { describe, expect, it } from "vitest";

import { formatRepoPathForDisplay } from "./repoPathDisplay";

describe("formatRepoPathForDisplay", () => {
  it("formats absolute paths relative to a disambiguating root label", () => {
    expect(
      formatRepoPathForDisplay({
        path: "/tmp/workspace-a/app/src/index.ts",
        repoPath: "/tmp/workspace-a/app",
      }).displayPath
    ).toBe("workspace-a/app/src/index.ts");

    expect(
      formatRepoPathForDisplay({
        path: "/tmp/workspace-b/app/src/index.ts",
        repoPath: "/tmp/workspace-b/app",
      }).displayPath
    ).toBe("workspace-b/app/src/index.ts");
  });

  it("keeps relative paths root-qualified when repo context exists", () => {
    const display = formatRepoPathForDisplay({
      path: "src/index.ts",
      repoPath: "/tmp/workspace-a/app",
    });

    expect(display.displayPath).toBe("workspace-a/app/src/index.ts");
    expect(display.title).toBe("/tmp/workspace-a/app/src/index.ts");
  });

  it("does not strip sibling paths with a shared prefix", () => {
    const display = formatRepoPathForDisplay({
      path: "/tmp/repo-other/src/index.ts",
      repoPath: "/tmp/repo",
    });

    expect(display.displayPath).toBe("/tmp/repo-other/src/index.ts");
  });

  it("normalizes Windows separators for display", () => {
    const display = formatRepoPathForDisplay({
      path: "C:\\work\\repo\\src\\index.ts",
      repoPath: "C:\\work\\repo",
    });

    expect(display.displayPath).toBe("work/repo/src/index.ts");
  });
});
