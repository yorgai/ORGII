import { describe, expect, it } from "vitest";

import { parseGitArtifactsFromText } from "../sessionGitArtifacts";

describe("parseGitArtifactsFromText", () => {
  it("parses commit label with short SHA and dash subject", () => {
    const artifacts = parseGitArtifactsFromText(
      "Commit: ffd49273 — refactor: remove sticky notes feature"
    );

    expect(artifacts).toEqual([
      expect.objectContaining({
        kind: "commit",
        sha: "ffd49273",
        shortSha: "ffd49273",
        subject: "refactor: remove sticky notes feature",
      }),
    ]);
  });

  it("parses bare short SHA with dash subject", () => {
    const artifacts = parseGitArtifactsFromText(
      "ffd49273 — refactor: remove sticky notes feature"
    );

    expect(artifacts).toEqual([
      expect.objectContaining({
        kind: "commit",
        sha: "ffd49273",
        shortSha: "ffd49273",
        subject: "refactor: remove sticky notes feature",
      }),
    ]);
  });

  it("parses contextual branch-tip SHA with nearest subject", () => {
    const artifacts = parseGitArtifactsFromText(`
- \`fix(chat): align session creator pinned actions\`

After rebase/push, the branch tip is synced at \`1a4a01d3\`.
`);

    expect(artifacts).toEqual([
      expect.objectContaining({
        kind: "commit",
        sha: "1a4a01d3",
        shortSha: "1a4a01d3",
        subject: "fix(chat): align session creator pinned actions",
      }),
    ]);
  });

  it("parses bare short SHA tokens", () => {
    const artifacts = parseGitArtifactsFromText("Latest revision is 4e7c7b77.");

    expect(artifacts).toEqual([
      expect.objectContaining({
        kind: "commit",
        sha: "4e7c7b77",
        shortSha: "4e7c7b77",
      }),
    ]);
  });

  it("does not parse SHA-like UUID fragments", () => {
    expect(
      parseGitArtifactsFromText(
        "trace id: 0eb48858-5a26-4a58-8386-d811c0afd143"
      )
    ).toEqual([]);
  });
});
