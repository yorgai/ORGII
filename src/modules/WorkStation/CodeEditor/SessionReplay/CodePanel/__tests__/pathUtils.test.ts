/**
 * Unit tests for CodePanel path and display helpers.
 */
import { describe, expect, it } from "vitest";

import {
  getBasename,
  getDirname,
  pickWorkspaceRootForFile,
  searchSnippetOneLine,
  toRepoFirstDisplayPath,
} from "../pathUtils";

describe("getBasename", () => {
  it("returns last segment for posix-style paths", () => {
    expect(getBasename("/a/b/c.txt")).toBe("c.txt");
  });

  it("normalizes backslashes to forward slashes", () => {
    expect(getBasename("C:\\Users\\dev\\file.ts")).toBe("file.ts");
  });

  it("returns the original string when there are no segments", () => {
    expect(getBasename("")).toBe("");
  });

  it("handles trailing slash by using prior segment", () => {
    expect(getBasename("/a/b/")).toBe("b");
  });
});

describe("getDirname", () => {
  it("returns all but the final path segment", () => {
    expect(getDirname("repo/src/index.ts")).toBe("repo/src");
  });

  it("returns empty string for basename-only paths", () => {
    expect(getDirname("index.ts")).toBe("");
  });
});

describe("pickWorkspaceRootForFile", () => {
  it("returns undefined when hint is missing or blank", () => {
    expect(pickWorkspaceRootForFile("/a/b", undefined)).toBeUndefined();
    expect(pickWorkspaceRootForFile("/a/b", "   ")).toBeUndefined();
  });

  it("picks the longest matching root from comma-separated hints", () => {
    const file = "/Users/me/ws/proj/src/main.ts";
    const hint = "/Users/me/other,/Users/me/ws/proj,/Users/me";
    expect(pickWorkspaceRootForFile(file, hint)).toBe("/Users/me/ws/proj");
  });

  it("normalizes trailing slashes on hint roots", () => {
    const file = "/repo/app/index.ts";
    expect(pickWorkspaceRootForFile(file, "/repo/app/")).toBe("/repo/app");
  });

  it("returns undefined when no candidate is a prefix of the file", () => {
    expect(
      pickWorkspaceRootForFile("/other/path", "/repo/a,/repo/b")
    ).toBeUndefined();
  });
});

describe("toRepoFirstDisplayPath", () => {
  it("uses workspace hint to produce repoName/relative form", () => {
    const abs = "/Users/me/acme-app/src/index.ts";
    expect(toRepoFirstDisplayPath(abs, "/Users/me/acme-app")).toBe(
      "acme-app/src/index.ts"
    );
  });

  it("strips /github/ marker when no workspace hint matches", () => {
    const abs = "/home/u/projects/GitHub/foo/bar/baz.ts";
    expect(toRepoFirstDisplayPath(abs)).toBe("foo/bar/baz.ts");
  });

  it("returns short paths unchanged when few segments and no hint", () => {
    expect(toRepoFirstDisplayPath("a/b/c")).toBe("a/b/c");
  });

  it("truncates to last six segments for long absolute paths without hint", () => {
    const long = "/a/b/c/d/e/f/g/h/i/j/file.ts";
    expect(toRepoFirstDisplayPath(long)).toBe("f/g/h/i/j/file.ts");
  });
});

describe("searchSnippetOneLine", () => {
  it("collapses internal whitespace and trims", () => {
    expect(searchSnippetOneLine("  hello   world  \n\t")).toBe("hello world");
  });
});
