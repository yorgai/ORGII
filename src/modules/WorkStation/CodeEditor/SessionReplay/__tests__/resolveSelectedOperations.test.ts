import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { resolveSelectedFileOperation } from "../resolveSelectedOperations";
import { FILE_OPERATION_TYPE, type FileOperationEntry } from "../types";

function minimalSessionEvent(
  overrides: Partial<SessionEvent> = {}
): SessionEvent {
  return {
    chunk_id: null,
    id: "evt-1",
    sessionId: "sess-1",
    createdAt: "2026-03-29T12:00:00.000Z",
    functionName: "read_file",
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

function fileOperation(
  overrides: Partial<FileOperationEntry> = {}
): FileOperationEntry {
  const event = minimalSessionEvent({ id: overrides.eventId ?? "read-1" });
  return {
    filePath: "/repo/a.ts",
    fileName: "a.ts",
    directory: "/repo",
    type: FILE_OPERATION_TYPE.READ,
    event,
    eventId: event.id,
    isCurrent: false,
    ...overrides,
  };
}

describe("resolveSelectedFileOperation", () => {
  it("prioritizes a running read over a stale manual selection", () => {
    const manualSelection = fileOperation({
      eventId: "read-old",
      filePath: "/repo/old.ts",
      fileName: "old.ts",
      content: "old content",
    });
    const runningRead = fileOperation({
      eventId: "read-running",
      filePath: "/repo/live.ts",
      fileName: "live.ts",
      isCurrent: true,
      isLoading: true,
      content: undefined,
    });

    const selected = resolveSelectedFileOperation(
      [manualSelection, runningRead],
      [manualSelection, runningRead],
      null,
      "read-old",
      "read-running"
    );

    expect(selected?.eventId).toBe("read-running");
    expect(selected?.filePath).toBe("/repo/live.ts");
    expect(selected?.isLoading).toBe(true);
  });
});
