import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type { ExploreOperationEntry } from "../types";
import {
  getExploreDisplayName,
  getExploreDisplayParts,
} from "../utils/exploreDisplayUtils";

function minimalSessionEvent(
  overrides: Partial<SessionEvent> = {}
): SessionEvent {
  return {
    chunk_id: null,
    id: "lsp-evt-1",
    sessionId: "sess-1",
    createdAt: "2026-05-16T12:00:00.000Z",
    functionName: "query_lsp",
    uiCanonical: "query_lsp",
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

function minimalExploreOperation(
  overrides: Partial<ExploreOperationEntry> = {}
): ExploreOperationEntry {
  return {
    query: "",
    exploreType: "query_lsp",
    results: [],
    totalMatches: 0,
    event: minimalSessionEvent(),
    eventId: "lsp-evt-1",
    isCurrent: false,
    ...overrides,
  };
}

describe("getExploreDisplayName", () => {
  it("shows grep action as a specific sidebar tool label", () => {
    const op = minimalExploreOperation({
      query: "interactive[_-]?terminal",
      exploreType: "code_search",
      exploreAction: "grep",
      event: minimalSessionEvent({
        functionName: "code_search",
        uiCanonical: "code_search",
      }),
    });

    expect(getExploreDisplayName(op)).toBe("Grep · interactive[_-]?terminal");
    expect(getExploreDisplayParts(op)).toEqual({
      primary: "Grep",
      secondary: "interactive[_-]?terminal",
    });
  });

  it("shows Glob as the short sidebar tool label", () => {
    const op = minimalExploreOperation({
      query: "**/*.ts",
      exploreType: "glob",
      event: minimalSessionEvent({
        functionName: "glob_file_search",
        uiCanonical: "glob_file_search",
        args: { globPattern: "**/*.ts" },
      }),
    });

    expect(getExploreDisplayName(op)).toBe("Glob · **/*.ts");
  });

  it("shows list directory entries as concise ls labels", () => {
    const op = minimalExploreOperation({
      query: "ls /repo/src/content",
      exploreType: "list_dir",
      directory: "/repo/src/content",
      event: minimalSessionEvent({
        functionName: "list_dir",
        uiCanonical: "list_dir",
        args: { path: "/repo/src/content" },
      }),
    });

    expect(getExploreDisplayName(op)).toBe("Listed directory · content/");
  });

  it("shows LSP checked file count in the primary sidebar label", () => {
    const op = minimalExploreOperation({
      files: ["src/a.ts", "src/b.ts"],
    });

    expect(getExploreDisplayName(op)).toBe("Queried LSP diagnostics · 2 files");
  });

  it("uses singular file label for one LSP checked file", () => {
    const op = minimalExploreOperation({
      files: ["src/a.ts"],
    });

    expect(getExploreDisplayName(op)).toBe("Queried LSP diagnostics · 1 file");
  });
});
