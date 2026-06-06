import { describe, expect, it } from "vitest";

import {
  mapNativeFileResultsForRoot,
  mergeFileModeResults,
} from "../fileModeSearch";

const primaryRoot = {
  path: "/workspace/primary",
  name: "primary",
};
const secondaryRoot = {
  path: "/workspace/secondary",
  name: "secondary",
};

describe("EditorPalette file mode multi-root search", () => {
  it("preserves repo metadata and relative directories for secondary workspace results", () => {
    const [result] = mapNativeFileResultsForRoot(
      [
        {
          path: "/workspace/secondary/packages/app/src/index.tsx",
          filename: "index.tsx",
          type: "file",
          score: 88,
        },
      ],
      secondaryRoot
    );

    expect(result).toEqual({
      path: "/workspace/secondary/packages/app/src/index.tsx",
      name: "index.tsx",
      directory: "packages/app/src",
      score: 88,
      repoPath: "/workspace/secondary",
      repoName: "secondary",
    });
  });

  it("merges results across roots by score without collapsing same relative path from different repos", () => {
    const merged = mergeFileModeResults(
      [
        [
          {
            path: "/workspace/primary/src/index.tsx",
            name: "index.tsx",
            directory: "src",
            score: 70,
            repoPath: primaryRoot.path,
            repoName: primaryRoot.name,
          },
        ],
        [
          {
            path: "/workspace/secondary/src/index.tsx",
            name: "index.tsx",
            directory: "src",
            score: 95,
            repoPath: secondaryRoot.path,
            repoName: secondaryRoot.name,
          },
        ],
      ],
      20
    );

    expect(merged.map((item) => item.path)).toEqual([
      "/workspace/secondary/src/index.tsx",
      "/workspace/primary/src/index.tsx",
    ]);
  });
});
