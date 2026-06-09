import { describe, expect, it } from "vitest";

import type {
  ExtractedGitArtifactData,
  SessionEvent,
} from "@src/engines/SessionCore/core/types";

import { deriveGitArtifactStats } from "./gitArtifactStats";

function baseEvent(
  id: string,
  overrides: Partial<SessionEvent> = {}
): SessionEvent {
  return {
    chunk_id: id,
    id,
    sessionId: "session-1",
    createdAt: "2026-06-09T00:00:00.000Z",
    functionName: "run_shell",
    uiCanonical: "run_shell",
    actionType: "tool_call",
    args: {},
    result: {},
    source: "assistant",
    displayText: "git log --oneline",
    displayStatus: "completed",
    displayVariant: "tool_call",
    activityStatus: "processed",
    ...overrides,
  };
}

function shellEvent(
  id: string,
  gitArtifacts: ExtractedGitArtifactData[],
  overrides: Partial<SessionEvent> = {}
): SessionEvent {
  return baseEvent(id, {
    extracted: {
      kind: "shell",
      command: "git log --oneline",
      isFailure: false,
      gitArtifacts,
    },
    ...overrides,
  });
}

describe("deriveGitArtifactStats", () => {
  it("deduplicates commits and pull requests across shell events", () => {
    const stats = deriveGitArtifactStats([
      shellEvent("event-1", [
        {
          kind: "commit",
          sha: "abc123456789",
          shortSha: "abc1234",
        },
        {
          kind: "pullRequest",
          repoFullName: "org/repo",
          prNumber: 42,
        },
      ]),
      shellEvent("event-2", [
        {
          kind: "commit",
          sha: "abc123456789",
          shortSha: "abc1234",
        },
        {
          kind: "commit",
          url: "https://github.com/org/repo/commit/def456",
          sha: "def456",
        },
        {
          kind: "pullRequest",
          repoFullName: "org/repo",
          prNumber: 42,
        },
      ]),
    ]);

    expect(stats).toEqual({ commitCount: 2, pullRequestCount: 1 });
  });

  it("ignores running, failed, and unsuccessful shell events", () => {
    const stats = deriveGitArtifactStats([
      shellEvent("running", [{ kind: "commit", sha: "aaa111" }], {
        displayStatus: "running",
      }),
      shellEvent("failed-status", [{ kind: "commit", sha: "bbb222" }], {
        displayStatus: "failed",
      }),
      shellEvent(
        "failure",
        [{ kind: "pullRequest", url: "https://github.com/org/repo/pull/7" }],
        {
          extracted: {
            kind: "shell",
            command: "gh pr create",
            isFailure: true,
            gitArtifacts: [
              {
                kind: "pullRequest",
                url: "https://github.com/org/repo/pull/7",
              },
            ],
          },
        }
      ),
    ]);

    expect(stats).toEqual({ commitCount: 0, pullRequestCount: 0 });
  });

  it("counts commit summaries from assistant text when no shell artifact exists", () => {
    const stats = deriveGitArtifactStats([
      baseEvent("assistant-summary", {
        functionName: "assistant",
        uiCanonical: "assistant",
        actionType: "assistant",
        displayVariant: "message",
        displayText:
          "Committed the fix.\n\nCommit:\n\n- 240e89dd fix(session): parse cursor terminal descriptions",
        extracted: {
          kind: "message",
          content:
            "Committed the fix.\n\nCommit:\n\n- 240e89dd fix(session): parse cursor terminal descriptions",
          isUser: false,
        },
      }),
    ]);

    expect(stats).toEqual({ commitCount: 1, pullRequestCount: 0 });
  });
});
