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

  it("does not parse session ids as commits", () => {
    expect(
      parseGitArtifactsFromText(
        "queue flushed into session sdeagent-ee970f47-dfcb-4a78-97e5-fc56e3451821 after it failed"
      )
    ).toEqual([]);
  });

  it("does not parse session ids as commits even in commit-context sentences", () => {
    expect(
      parseGitArtifactsFromText(
        "已 commit。queue flush 进了死 session sdeagent-ee970f47-dfcb-4a78-97e5-fc56e3451821"
      )
    ).toEqual([]);
  });

  it("does not parse delegate worker handles as commits", () => {
    expect(
      parseGitArtifactsFromText(
        "committed nothing; see agent-builtin:explore-93edacaf-c1e2-44bb-8e13-4bf5362aaecb"
      )
    ).toEqual([]);
  });

  it("still parses a real commit next to a session id", () => {
    const artifacts = parseGitArtifactsFromText(
      "committed f55f430b; session sdeagent-9be175b5-aacb-4b2b-b23a-b46a8d4d6a35 continues"
    );

    expect(artifacts).toEqual([
      expect.objectContaining({ kind: "commit", sha: "f55f430b" }),
    ]);
  });

  it("does not parse all-letter words as commits", () => {
    expect(
      parseGitArtifactsFromText("The commit succeeded as cceeded.")
    ).toEqual([]);
    expect(parseGitArtifactsFromText("Commit succeeded.")).toEqual([]);
  });

  it("does not auto-detect hexadecimal tokens with fewer than two digits as commits", () => {
    expect(parseGitArtifactsFromText("Latest revision is deadbee.")).toEqual(
      []
    );
    expect(parseGitArtifactsFromText("Latest revision is deadbe1.")).toEqual(
      []
    );
  });

  it("does not parse all-decimal tokens (epoch millis, PR numbers) as commits", () => {
    expect(parseGitArtifactsFromText("Commit 1781462067585")).toEqual([]);
    expect(
      parseGitArtifactsFromText("committed at 1781462067585; done")
    ).toEqual([]);
    expect(parseGitArtifactsFromText("Latest revision is 1234567.")).toEqual(
      []
    );
  });

  it("does not parse a context-free bare hex token as a commit", () => {
    // No commit keyword nearby — could be a turn id, a hash, any internal id.
    // Without positive git evidence we must not render a (broken) commit card.
    expect(parseGitArtifactsFromText("The value is 74371fe5 here.")).toEqual(
      []
    );
    expect(parseGitArtifactsFromText("74371fe5")).toEqual([]);
  });

  it("does not parse turn ids as commits", () => {
    expect(parseGitArtifactsFromText("parent turn 74371fe5 started")).toEqual(
      []
    );
    expect(
      parseGitArtifactsFromText(
        "The parent turn `74371fe5` had its cancel flag set"
      )
    ).toEqual([]);
    expect(
      parseGitArtifactsFromText("Trace parent turn 74371fe5 lifecycle")
    ).toEqual([]);
  });

  it("does not partial-match hex inside bare UUIDs via commit context", () => {
    expect(
      parseGitArtifactsFromText(
        "commit failed for turn 422124fd-5d84-4572-9969-d4500011803a"
      )
    ).toEqual([]);
  });
});
