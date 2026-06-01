import { describe, expect, it } from "vitest";

import type { SnapshotRecord } from "@src/api/tauri/agent";

import {
  isReviewableSnapshotRecord,
  toRegistryEntries,
} from "../useFileReview";

function snapshot(toolCallId: string): SnapshotRecord {
  return {
    sessionId: "agent-session-1",
    toolCallId,
    hash: `hash-${toolCallId}`,
    createdAt: "2026-05-27T00:00:00Z",
  };
}

describe("file review snapshot registry", () => {
  it("excludes redo control records from user-actionable review entries", () => {
    const records = [
      snapshot("tool-edit-1"),
      snapshot("redo:rewind"),
      snapshot("redo:restore"),
      snapshot("__pre_message__"),
    ];

    expect(
      isReviewableSnapshotRecord(snapshot("redo:rewind"), {
        includePreMessageSnapshot: true,
      })
    ).toBe(false);
    expect(
      toRegistryEntries(records, { includePreMessageSnapshot: false }).map(
        (entry) => entry.callId
      )
    ).toEqual(["agent-session-1__tool-edit-1__2026-05-27T00:00:00Z"]);
  });
});
