import { describe, expect, it } from "vitest";

import { extractMessageReferences } from "../MessageReferenceCards";

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
