/**
 * resolveFileOperationPayload: inline vs rehydrate from SessionEvent.
 */
import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { resolveFileOperationPayload } from "../resolveFilePayload";
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

function baseFileOp(
  partial: Partial<FileOperationEntry> &
    Pick<FileOperationEntry, "eventId" | "filePath">
): FileOperationEntry {
  return {
    fileName: partial.filePath.split("/").pop() ?? partial.filePath,
    directory: "/proj",
    type: FILE_OPERATION_TYPE.READ,
    event: minimalSessionEvent({ id: partial.eventId }),
    isCurrent: true,
    ...partial,
  };
}

describe("resolveFileOperationPayload", () => {
  it("returns inline fields when any payload string is present", () => {
    const op = baseFileOp({
      eventId: "e1",
      filePath: "/a.ts",
      content: "cached",
    });
    expect(resolveFileOperationPayload(op)).toEqual({
      content: "cached",
      oldContent: undefined,
      newContent: undefined,
      language: undefined,
    });
  });

  it("returns only language when event placeholder is empty and no inline payload", () => {
    const op: FileOperationEntry = {
      ...baseFileOp({ eventId: "e2", filePath: "/b.ts" }),
      content: undefined,
      event: {} as SessionEvent,
    };
    expect(resolveFileOperationPayload(op)).toEqual({ language: undefined });
  });

  it("rehydrates from full event when payloads were stripped", () => {
    const event = minimalSessionEvent({
      id: "e3",
      functionName: "read_file",
      args: { path: "/repo/x.ts" },
      result: {
        success: {
          path: "/repo/x.ts",
          content: "full text",
        },
      },
    });

    const op: FileOperationEntry = {
      fileName: "x.ts",
      directory: "/repo",
      filePath: "/repo/x.ts",
      type: FILE_OPERATION_TYPE.READ,
      event,
      eventId: "e3",
      isCurrent: false,
    };

    expect(resolveFileOperationPayload(op).content).toBe("full text");
  });

  it("parses inline diff-only write payloads into old and new content", () => {
    const op = baseFileOp({
      eventId: "e4",
      filePath: "/repo/y.ts",
      type: FILE_OPERATION_TYPE.WRITE,
      diff: "--- a/repo/y.ts\n+++ b/repo/y.ts\n@@ -10,2 +10,2 @@\n context\n-old\n+new",
    });

    const payload = resolveFileOperationPayload(op);

    expect(payload.oldContent).toBe("context\nold");
    expect(payload.newContent).toBe("context\nnew");
    expect(payload.oldStartLine).toBe(10);
    expect(payload.newStartLine).toBe(10);
  });

  it("keeps normalized inline old and new content without reparsing diff", () => {
    const op = baseFileOp({
      eventId: "e5",
      filePath: "/repo/z.ts",
      type: FILE_OPERATION_TYPE.WRITE,
      oldContent: "normalized old",
      newContent: "normalized new",
      diff: "--- a/repo/z.ts\n+++ b/repo/z.ts\n@@ -1,1 +1,1 @@\n-legacy old\n+legacy new",
      oldStartLine: 20,
      newStartLine: 21,
    });

    const payload = resolveFileOperationPayload(op);

    expect(payload.oldContent).toBe("normalized old");
    expect(payload.newContent).toBe("normalized new");
    expect(payload.oldStartLine).toBe(20);
    expect(payload.newStartLine).toBe(21);
  });
});
