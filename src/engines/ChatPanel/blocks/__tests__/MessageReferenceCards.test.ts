import { describe, expect, it } from "vitest";

import { extractMessageReferences } from "../MessageReferenceCards";

describe("extractMessageReferences", () => {
  it("upgrades GitHub PR URLs to PR reference cards", () => {
    const references = extractMessageReferences(
      "Created PR: https://github.com/orgii/app/pull/42"
    );

    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      kind: "github_pr",
      value: "https://github.com/orgii/app/pull/42",
      title: "Pull request #42",
      subtitle: "orgii/app",
    });
  });

  it("upgrades GitHub commit URLs to commit reference cards", () => {
    const references = extractMessageReferences(
      "Commit: https://github.com/orgii/app/commit/abcdef1234567890"
    );

    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      kind: "github_commit",
      value: "https://github.com/orgii/app/commit/abcdef1234567890",
      title: "Commit abcdef1",
      subtitle: "orgii/app",
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
