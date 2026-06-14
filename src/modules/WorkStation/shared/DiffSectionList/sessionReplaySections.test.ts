import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  type SessionReplayDiffEntryLike,
  buildConsolidatedSessionReplayDiffSectionItems,
  buildSessionReplayDiffSectionItems,
} from "./sessionReplaySections";

function minimalSessionEvent(
  overrides: Partial<SessionEvent> = {}
): SessionEvent {
  return {
    chunk_id: null,
    id: "evt-1",
    sessionId: "sess-1",
    createdAt: "2026-06-10T00:00:00.000Z",
    functionName: "edit_file",
    uiCanonical: "",
    actionType: "tool_call",
    args: {},
    result: {},
    source: "assistant",
    displayText: "",
    displayStatus: "completed",
    displayVariant: "tool_call",
    activityStatus: "agent",
    ...overrides,
  };
}

function diffEntry(
  entryId: string,
  diff: string,
  filePath = "src/foo.ts"
): SessionReplayDiffEntryLike {
  return {
    entryId,
    filePath,
    fileName: "foo.ts",
    event: minimalSessionEvent({
      id: entryId,
      result: {
        content: `Edit applied\n\n\`\`\`diff\n--- a/${filePath}\n+++ b/${filePath}\n${diff}\n\`\`\``,
      },
    }),
  };
}

describe("session replay diff sections", () => {
  it("preserves unified diff hunk start lines for focused entries", () => {
    const sections = buildSessionReplayDiffSectionItems(
      diffEntry("edit-1", "@@ -42,3 +43,4 @@\n context\n-old\n+new\n+next")
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].file.oldStartLine).toBe(42);
    expect(sections[0].file.newStartLine).toBe(43);
    expect(sections[0].file.oldContent).toBe("context\nold");
    expect(sections[0].file.newContent).toBe("context\nnew\nnext");
  });

  it("keeps hunk line starts when consolidating repeated edits by file", () => {
    const sections = buildConsolidatedSessionReplayDiffSectionItems([
      diffEntry("edit-1", "@@ -42,1 +42,1 @@\n-old\n+new"),
      diffEntry("edit-2", "@@ -50,1 +51,1 @@\n-before\n+after"),
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0].file.oldStartLine).toBe(42);
    expect(sections[0].file.newStartLine).toBe(51);
    expect(sections[0].entryIds).toEqual(["edit-1", "edit-2"]);
  });

  it("excludes pathless diff events instead of using the tool name as a fake file", () => {
    const sections = buildSessionReplayDiffSectionItems({
      entryId: "empty-1",
      filePath: "",
      fileName: "edit_file_by_replace",
      event: minimalSessionEvent({
        id: "empty-1",
        functionName: "edit_file_by_replace",
        result: {},
      }),
    });

    expect(sections).toEqual([]);
  });

  it("excludes non-delete sections with no old or new content", () => {
    const sections = buildSessionReplayDiffSectionItems({
      entryId: "empty-2",
      filePath: "src/empty.inc",
      fileName: "empty.inc",
      event: minimalSessionEvent({
        id: "empty-2",
        args: { file_path: "src/empty.inc" },
        result: {},
      }),
    });

    expect(sections).toEqual([]);
  });

  it("splits distant hunks into per-hunk pairs without phantom gap lines", () => {
    const sections = buildSessionReplayDiffSectionItems(
      diffEntry(
        "edit-1",
        "@@ -42,2 +42,2 @@\n context\n-old\n+new\n@@ -180,2 +180,2 @@\n tail\n-foo\n+bar"
      )
    );

    expect(sections).toHaveLength(1);
    const { hunks } = sections[0].file;
    expect(hunks).toHaveLength(2);
    expect(hunks?.[0]).toMatchObject({
      oldStartLine: 42,
      newStartLine: 42,
      oldValue: "context\nold",
      newValue: "context\nnew",
    });
    expect(hunks?.[1]).toMatchObject({
      oldStartLine: 180,
      newStartLine: 180,
      oldValue: "tail\nfoo",
      newValue: "tail\nbar",
    });
    // No fabricated blank gap lines between the two hunks.
    expect(hunks?.[0].oldValue).not.toContain("\n\n");
    expect(hunks?.[1].oldValue).not.toContain("\n\n");
  });

  it("recomputes per-hunk pairs when consolidating multi-hunk edits", () => {
    const sections = buildConsolidatedSessionReplayDiffSectionItems([
      diffEntry("edit-1", "@@ -42,1 +42,1 @@\n-old\n+new"),
      diffEntry("edit-2", "@@ -180,1 +180,1 @@\n-before\n+after"),
    ]);

    expect(sections).toHaveLength(1);
    const { hunks } = sections[0].file;
    expect(hunks).toHaveLength(2);
    expect(hunks?.[0].oldStartLine).toBe(42);
    expect(hunks?.[1].oldStartLine).toBe(180);
  });
});
