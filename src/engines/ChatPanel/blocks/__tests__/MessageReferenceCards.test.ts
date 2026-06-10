import { describe, expect, it, vi } from "vitest";

import {
  collapseRelativePathSegments,
  extractMessageReferences,
  resolveOpenPath,
} from "../MessageReferenceCards";

vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn(async () => "/Users/tester"),
}));

describe("collapseRelativePathSegments", () => {
  it("returns paths without parent/current segments unchanged", () => {
    expect(collapseRelativePathSegments("/Users/me/project/src/file.ts")).toBe(
      "/Users/me/project/src/file.ts"
    );
    expect(collapseRelativePathSegments("")).toBe("");
  });

  it("collapses parent-directory segments in absolute paths", () => {
    expect(
      collapseRelativePathSegments("/Users/me/proj/../sibling/file.ts")
    ).toBe("/Users/me/sibling/file.ts");
    expect(
      collapseRelativePathSegments(
        "/Users/vinceorz/Projects/ORGII/../openai_compat/types.rs"
      )
    ).toBe("/Users/vinceorz/Projects/openai_compat/types.rs");
  });

  it("collapses single-dot current-directory segments", () => {
    expect(collapseRelativePathSegments("/A/./B/./C")).toBe("/A/B/C");
  });

  it("treats absolute root as the upper bound", () => {
    expect(collapseRelativePathSegments("/..")).toBe("/");
    expect(collapseRelativePathSegments("/../foo")).toBe("/foo");
    expect(collapseRelativePathSegments("/A/../../B")).toBe("/B");
  });

  it("preserves leading .. segments in relative paths", () => {
    expect(collapseRelativePathSegments("../foo/bar")).toBe("../foo/bar");
    expect(collapseRelativePathSegments("A/B/../../../C")).toBe("../C");
  });

  it("preserves trailing slashes for directory-style paths", () => {
    expect(collapseRelativePathSegments("/A/B/../C/")).toBe("/A/C/");
    expect(collapseRelativePathSegments("/")).toBe("/");
  });

  it("collapses trailing dot-segments", () => {
    expect(collapseRelativePathSegments("/A/B/..")).toBe("/A");
    expect(collapseRelativePathSegments("/A/B/.")).toBe("/A/B");
  });
});

describe("resolveOpenPath", () => {
  it("expands ~/ to the home directory", async () => {
    await expect(resolveOpenPath("~/Documents/file.txt")).resolves.toBe(
      "/Users/tester/Documents/file.txt"
    );
  });

  it("collapses parent-directory segments even on ~/-prefixed inputs", async () => {
    await expect(resolveOpenPath("~/Projects/A/../B/file.ts")).resolves.toBe(
      "/Users/tester/Projects/B/file.ts"
    );
  });

  it("collapses parent-directory segments on non-~ paths without invoking homeDir", async () => {
    await expect(
      resolveOpenPath(
        "/Users/vinceorz/Projects/ORGII/../openai_compat/types.rs"
      )
    ).resolves.toBe("/Users/vinceorz/Projects/openai_compat/types.rs");
  });

  it("passes already-clean paths through unchanged", async () => {
    await expect(resolveOpenPath("/Users/me/proj/src/main.ts")).resolves.toBe(
      "/Users/me/proj/src/main.ts"
    );
  });
});

describe("extractMessageReferences", () => {
  it("extracts agent commit lines into commit reference cards", () => {
    const references = extractMessageReferences(`
Committed the diff-view work.

Commit:

4e7c7b77 fix(diff): align replay line numbers and submission filters
Pre-commit checks passed, including:

lint-staged
scoped TypeScript check
staged file lint stats
`);

    expect(references[0]).toMatchObject({
      kind: "git_commit",
      value: "4e7c7b77",
      title: "fix(diff): align replay line numbers and submission filters",
      subtitle: "4e7c7b77",
      sha: "4e7c7b77",
      shortSha: "4e7c7b77",
    });
  });

  it("upgrades GitHub commit URLs to commit reference cards", () => {
    const references = extractMessageReferences(
      "Commit: https://github.com/orgii/app/commit/abcdef1234567890"
    );

    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      kind: "git_commit",
      value: "abcdef1234567890",
      title: "Commit abcdef1",
      subtitle: "abcdef1 · orgii/app",
      url: "https://github.com/orgii/app/commit/abcdef1234567890",
    });
  });

  it("keeps non-GitHub URLs as generic web URL cards", () => {
    const references = extractMessageReferences(
      "Docs: https://example.com/docs"
    );

    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      kind: "web_url",
      value: "https://example.com/docs",
    });
  });
});
