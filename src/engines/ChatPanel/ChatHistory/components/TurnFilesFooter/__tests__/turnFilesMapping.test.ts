import { describe, expect, it } from "vitest";

import type { TurnModifiedFile } from "@src/engines/SessionCore/storage/sqliteCache";

import { mapTurnModifiedFilesToFileChanges } from "../turnFilesMapping";

function createFile(overrides?: Partial<TurnModifiedFile>): TurnModifiedFile {
  return {
    path: "src/foo.ts",
    fileName: "foo.ts",
    status: "modified",
    additions: 3,
    deletions: 1,
    ...overrides,
  };
}

describe("mapTurnModifiedFilesToFileChanges", () => {
  it("returns an empty array for empty/null/undefined input", () => {
    expect(mapTurnModifiedFilesToFileChanges([])).toEqual([]);
    expect(mapTurnModifiedFilesToFileChanges(null)).toEqual([]);
    expect(mapTurnModifiedFilesToFileChanges(undefined)).toEqual([]);
  });

  it("maps a single file with line stats and lineCount=0", () => {
    const result = mapTurnModifiedFilesToFileChanges([createFile()]);
    expect(result).toEqual([
      {
        path: "src/foo.ts",
        fileName: "foo.ts",
        status: "modified",
        additions: 3,
        deletions: 1,
        lineCount: 0,
      },
    ]);
  });

  it("preserves order across multiple files", () => {
    const result = mapTurnModifiedFilesToFileChanges([
      createFile({ path: "a.ts", fileName: "a.ts" }),
      createFile({ path: "b.ts", fileName: "b.ts" }),
      createFile({ path: "c.ts", fileName: "c.ts" }),
    ]);
    expect(result.map((file) => file.path)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("derives fileName from path when missing", () => {
    const result = mapTurnModifiedFilesToFileChanges([
      createFile({ path: "src/deep/nested/bar.rs", fileName: "" }),
    ]);
    expect(result[0].fileName).toBe("bar.rs");
  });

  it("drops entries without a usable path", () => {
    const result = mapTurnModifiedFilesToFileChanges([
      createFile({ path: "" }),
      createFile({ path: "kept.ts", fileName: "kept.ts" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("kept.ts");
  });

  it("clamps non-finite or negative line counts to 0", () => {
    const result = mapTurnModifiedFilesToFileChanges([
      createFile({
        additions: Number.NaN as unknown as number,
        deletions: -5,
      }),
    ]);
    expect(result[0].additions).toBe(0);
    expect(result[0].deletions).toBe(0);
  });

  it("passes created/deleted status through", () => {
    const result = mapTurnModifiedFilesToFileChanges([
      createFile({ path: "new.ts", status: "created" }),
      createFile({ path: "old.ts", status: "deleted" }),
    ]);
    expect(result[0].status).toBe("created");
    expect(result[1].status).toBe("deleted");
  });
});
