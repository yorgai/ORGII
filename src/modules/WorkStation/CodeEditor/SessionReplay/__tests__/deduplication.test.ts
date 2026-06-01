/**
 * Unit tests for SessionReplay operation deduplication.
 */
import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  dedupeExploreOperations,
  dedupeFileOperations,
  dedupeShellOperations,
} from "../deduplication";
import { FILE_OPERATION_TYPE } from "../types";
import type {
  ExploreOperationEntry,
  FileOperationEntry,
  ShellOperationEntry,
} from "../types";

function minimalSessionEvent(
  overrides: Partial<SessionEvent> = {}
): SessionEvent {
  return {
    chunk_id: null,
    id: "evt-minimal",
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
    type: FILE_OPERATION_TYPE.WRITE,
    event: minimalSessionEvent({ id: partial.eventId }),
    isCurrent: false,
    ...partial,
  };
}

function baseShellOp(
  partial: Partial<ShellOperationEntry> &
    Pick<ShellOperationEntry, "eventId" | "command">
): ShellOperationEntry {
  return {
    shortCommand: partial.command.split(" ")[0] ?? partial.command,
    commandKeywords: partial.command,
    event: minimalSessionEvent({ id: partial.eventId }),
    isCurrent: false,
    ...partial,
  };
}

function baseSearchOp(
  partial: Partial<ExploreOperationEntry> &
    Pick<ExploreOperationEntry, "eventId" | "query" | "exploreType">
): ExploreOperationEntry {
  return {
    results: [],
    totalMatches: 0,
    event: minimalSessionEvent({ id: partial.eventId }),
    isCurrent: false,
    ...partial,
  };
}

describe("dedupeFileOperations", () => {
  it("strips content fields for a single operation", () => {
    const input: FileOperationEntry[] = [
      baseFileOp({
        eventId: "e1",
        filePath: "/proj/a.ts",
        content: "read body",
        oldContent: "old",
        newContent: "new",
        linesAdded: 2,
        linesRemoved: 1,
      }),
    ];
    const [out] = dedupeFileOperations(input);
    expect(out.content).toBeUndefined();
    expect(out.oldContent).toBeUndefined();
    expect(out.newContent).toBeUndefined();
    expect(out.filePath).toBe("/proj/a.ts");
    expect(out.linesAdded).toBe(2);
    expect(out.linesRemoved).toBe(1);
    expect(out.relatedEventIds).toBeUndefined();
    expect(out.editCount).toBeUndefined();
  });

  it("consolidates same filePath+type: sums lines, merges relatedEventIds, editCount, any isCurrent", () => {
    const input: FileOperationEntry[] = [
      baseFileOp({
        eventId: "e1",
        filePath: "/proj/x.ts",
        linesAdded: 1,
        linesRemoved: 2,
        isCurrent: false,
        newContent: "first",
      }),
      baseFileOp({
        eventId: "e2",
        filePath: "/proj/x.ts",
        linesAdded: 3,
        linesRemoved: 1,
        isCurrent: true,
        newContent: "second",
      }),
    ];
    const [out] = dedupeFileOperations(input);
    expect(out.linesAdded).toBe(4);
    expect(out.linesRemoved).toBe(3);
    expect(out.relatedEventIds).toEqual(["e1", "e2"]);
    expect(out.editCount).toBe(2);
    expect(out.isCurrent).toBe(true);
    expect(out.eventId).toBe("e2");
    expect(out.content).toBeUndefined();
    expect(out.oldContent).toBeUndefined();
    expect(out.newContent).toBeUndefined();
    expect(out.relatedOperations).toHaveLength(2);
    for (const related of out.relatedOperations ?? []) {
      expect(related.content).toBeUndefined();
      expect(related.oldContent).toBeUndefined();
      expect(related.newContent).toBeUndefined();
    }
  });

  it("prefers operation with content when latest has no content payloads", () => {
    const input: FileOperationEntry[] = [
      baseFileOp({
        eventId: "e1",
        filePath: "/proj/y.ts",
        newContent: "from-earlier",
        linesAdded: 1,
      }),
      baseFileOp({
        eventId: "e2",
        filePath: "/proj/y.ts",
        linesAdded: 1,
        isCurrent: true,
      }),
    ];
    const [out] = dedupeFileOperations(input);
    expect(out.newContent).toBeUndefined();
    expect(out.event.id).toBe("e1");
    expect(out.relatedOperations?.[0].eventId).toBe("e1");
    expect(out.relatedOperations?.[1].eventId).toBe("e2");
  });

  it("keeps different filePath entries separate", () => {
    const input: FileOperationEntry[] = [
      baseFileOp({ eventId: "a", filePath: "/p/one.ts" }),
      baseFileOp({ eventId: "b", filePath: "/p/two.ts" }),
    ];
    const out = dedupeFileOperations(input);
    expect(out).toHaveLength(2);
    expect(out.map((op) => op.filePath).sort()).toEqual([
      "/p/one.ts",
      "/p/two.ts",
    ]);
  });

  it("keeps same path but different type separate", () => {
    const input: FileOperationEntry[] = [
      baseFileOp({
        eventId: "r1",
        filePath: "/p/x.ts",
        type: FILE_OPERATION_TYPE.READ,
        content: "c",
      }),
      baseFileOp({
        eventId: "w1",
        filePath: "/p/x.ts",
        type: FILE_OPERATION_TYPE.WRITE,
        newContent: "n",
      }),
    ];
    const out = dedupeFileOperations(input);
    expect(out).toHaveLength(2);
    const readEntry = out.find((op) => op.type === FILE_OPERATION_TYPE.READ);
    const writeEntry = out.find((op) => op.type === FILE_OPERATION_TYPE.WRITE);
    expect(readEntry?.eventId).toBe("r1");
    expect(writeEntry?.eventId).toBe("w1");
  });
});

describe("dedupeShellOperations", () => {
  it("dedupes identical commands and prefers op with output or exitCode when not current", () => {
    const input: ShellOperationEntry[] = [
      baseShellOp({ eventId: "s1", command: "npm test" }),
      baseShellOp({
        eventId: "s2",
        command: "npm test",
        output: "PASS",
        exitCode: 0,
      }),
    ];
    const out = dedupeShellOperations(input);
    expect(out).toHaveLength(1);
    expect(out[0].eventId).toBe("s2");
    expect(out[0].output).toBe("PASS");
  });

  it("prefers isCurrent over completed when both exist", () => {
    const input: ShellOperationEntry[] = [
      baseShellOp({
        eventId: "done",
        command: "ls",
        output: "a",
        exitCode: 0,
      }),
      baseShellOp({
        eventId: "cur",
        command: "ls",
        isCurrent: true,
      }),
    ];
    const out = dedupeShellOperations(input);
    expect(out).toHaveLength(1);
    expect(out[0].eventId).toBe("cur");
  });

  it("dedupes shell lifecycle rows by callId even when command differs", () => {
    const input: ShellOperationEntry[] = [
      baseShellOp({
        eventId: "shell-call",
        command: "npm test",
        event: minimalSessionEvent({ id: "shell-call", callId: "call-1" }),
      }),
      baseShellOp({
        eventId: "shell-result",
        command: "",
        output: "PASS",
        event: minimalSessionEvent({ id: "shell-result", callId: "call-1" }),
      }),
    ];
    const out = dedupeShellOperations(input);
    expect(out).toHaveLength(1);
    expect(out[0].eventId).toBe("shell-result");
  });

  it("keeps repeated identical commands separate when callIds differ", () => {
    const input: ShellOperationEntry[] = [
      baseShellOp({
        eventId: "first",
        command: "npm test",
        event: minimalSessionEvent({ id: "first", callId: "call-1" }),
      }),
      baseShellOp({
        eventId: "second",
        command: "npm test",
        event: minimalSessionEvent({ id: "second", callId: "call-2" }),
      }),
    ];
    const out = dedupeShellOperations(input);
    expect(out).toHaveLength(2);
    expect(out.map((op) => op.eventId)).toEqual(["first", "second"]);
  });

  it("groups empty command by eventId so each remains a singleton", () => {
    const input: ShellOperationEntry[] = [
      baseShellOp({ eventId: "empty-a", command: "" }),
      baseShellOp({ eventId: "empty-b", command: "" }),
    ];
    const out = dedupeShellOperations(input);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((op) => op.eventId)).size).toBe(2);
  });
});

describe("dedupeExploreOperations", () => {
  it("dedupes same query+exploreType and prefers completed with results", () => {
    const input: ExploreOperationEntry[] = [
      baseSearchOp({
        eventId: "q1",
        query: "foo",
        exploreType: "code_search",
        isLoading: true,
        results: [],
        totalMatches: 0,
      }),
      baseSearchOp({
        eventId: "q2",
        query: "foo",
        exploreType: "code_search",
        isLoading: false,
        results: [{ file: "a.ts", line: 1, content: "hit" }],
        totalMatches: 1,
      }),
    ];
    const out = dedupeExploreOperations(input);
    expect(out).toHaveLength(1);
    expect(out[0].eventId).toBe("q2");
    expect(out[0].results).toHaveLength(1);
  });

  it("prefers isCurrent over completed when both match same key", () => {
    const input: ExploreOperationEntry[] = [
      baseSearchOp({
        eventId: "done",
        query: "bar",
        exploreType: "glob",
        files: ["x.ts"],
        totalMatches: 1,
      }),
      baseSearchOp({
        eventId: "cur",
        query: "bar",
        exploreType: "glob",
        isCurrent: true,
        results: [],
        totalMatches: 0,
      }),
    ];
    const out = dedupeExploreOperations(input);
    expect(out).toHaveLength(1);
    expect(out[0].eventId).toBe("cur");
  });

  it("keeps empty-query operations separate even with the same exploreType", () => {
    const input: ExploreOperationEntry[] = [
      baseSearchOp({ eventId: "lint-a", query: "", exploreType: "query_lsp" }),
      baseSearchOp({ eventId: "lint-b", query: "", exploreType: "query_lsp" }),
    ];
    const out = dedupeExploreOperations(input);
    expect(out).toHaveLength(2);
    expect(out.map((op) => op.eventId)).toEqual(["lint-a", "lint-b"]);
  });

  it("empty query with different exploreType stays separate", () => {
    const input: ExploreOperationEntry[] = [
      baseSearchOp({ eventId: "ea", query: "", exploreType: "code_search" }),
      baseSearchOp({ eventId: "eb", query: "", exploreType: "glob" }),
    ];
    const out = dedupeExploreOperations(input);
    expect(out).toHaveLength(2);
  });

  it("dedupes empty-query code_search lifecycle duplicates", () => {
    const input: ExploreOperationEntry[] = [
      baseSearchOp({
        eventId: "search-start",
        query: "",
        exploreType: "code_search",
        event: minimalSessionEvent({
          id: "search-start",
          functionName: "code_search",
        }),
      }),
      baseSearchOp({
        eventId: "search-done",
        query: "",
        exploreType: "code_search",
        results: [{ file: "src/a.ts", line: 1, content: "hit" }],
        totalMatches: 1,
        event: minimalSessionEvent({
          id: "search-done",
          functionName: "code_search",
        }),
      }),
    ];
    const out = dedupeExploreOperations(input);
    expect(out).toHaveLength(1);
    expect(out[0].eventId).toBe("search-done");
  });
});
