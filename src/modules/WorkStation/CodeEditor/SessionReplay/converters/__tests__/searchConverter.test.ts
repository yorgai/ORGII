/**
 * Golden paths for search / list_dir / glob → ExploreOperationEntry.
 */
import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { convertToExploreOperation } from "../exploreConverter";

function minimalSessionEvent(
  overrides: Partial<SessionEvent> = {}
): SessionEvent {
  return {
    chunk_id: null,
    id: "search-evt-1",
    sessionId: "sess-1",
    createdAt: "2026-03-29T12:00:00.000Z",
    functionName: "code_search",
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

describe("convertToExploreOperation", () => {
  it("returns null for non-search tool names", () => {
    expect(
      convertToExploreOperation(
        minimalSessionEvent({ functionName: "read_file" }),
        false
      )
    ).toBeNull();
  });

  it("maps codebase search with structured results", () => {
    const event = minimalSessionEvent({
      functionName: "code_search",
      args: { query: "foo" },
      result: {
        output: {
          success: {
            results: [{ file: "src/a.ts", line: 10, content: "hit" }],
          },
        },
      },
    });
    const op = convertToExploreOperation(event, true);
    expect(op).not.toBeNull();
    expect(op?.exploreType).toBe("code_search");
    expect(op?.query).toContain("foo");
    expect(op?.results).toHaveLength(1);
    expect(op?.results[0].file).toBe("src/a.ts");
    expect(op?.isCurrent).toBe(true);
  });

  it("handles null args from replay cache for code_search events", () => {
    const event = minimalSessionEvent({
      functionName: "code_search",
      args: null as unknown as SessionEvent["args"],
      result: {
        content: "No matches found.",
        observation: "No matches found.",
      },
    });

    const op = convertToExploreOperation(event, false);
    expect(op).not.toBeNull();
    expect(op?.exploreType).toBe("code_search");
    expect(op?.query).toBe("");
    expect(op?.results).toEqual([]);
    expect(op?.event.args).toEqual({});
  });

  it("marks live grep events loading from displayStatus", () => {
    const event = minimalSessionEvent({
      functionName: "code_search",
      args: { action: "grep", pattern: "token" },
      displayStatus: "running",
    });

    const op = convertToExploreOperation(event, true);
    expect(op).not.toBeNull();
    expect(op?.isLoading).toBe(true);
    expect(op?.isCurrent).toBe(true);
    expect(op?.query).toBe("token");
  });

  it("does not synthesize rows for Rust agent grep no-match output", () => {
    const event = minimalSessionEvent({
      functionName: "code_search",
      args: {
        action: "grep",
        max_results: 30,
        pattern: "interactive[_-]?terminal",
      },
      result: {
        content: "No matches found.",
        observation: "No matches found.",
      },
    });

    const op = convertToExploreOperation(event, false);
    expect(op).not.toBeNull();
    expect(op?.exploreType).toBe("code_search");
    expect(op?.exploreAction).toBe("grep");
    expect(op?.query).toBe("interactive[_-]?terminal");
    expect(op?.results).toEqual([]);
    expect(op?.files).toEqual([]);
    expect(op?.totalMatches).toBe(0);
  });

  it("extracts code search query from nested rust tool args", () => {
    const event = minimalSessionEvent({
      functionName: "code_search",
      args: {
        input: {
          action: "grep",
          pattern: "interactive terminal",
          repo_path: "/Users/laptop-h/Documents/GitHub/yorg_frontend",
        },
      },
      result: {
        output: {
          success: {
            content:
              "/Users/laptop-h/Documents/GitHub/yorg_frontend/src-tauri/crates/agent-core/src/core/tools/impls/coding/exec/pty.rs:126:The command continues in the interactive terminal",
          },
        },
      },
    });

    const op = convertToExploreOperation(event, true);
    expect(op).not.toBeNull();
    expect(op?.exploreType).toBe("code_search");
    expect(op?.query).toBe("interactive terminal");
    expect(op?.directory).toBe(
      "/Users/laptop-h/Documents/GitHub/yorg_frontend"
    );
    expect(op?.results).toHaveLength(1);
    expect(op?.event.args).toEqual({});
    expect(op?.event.result).toEqual({});
  });

  it("parses list_dir output from plain-text bracket lines", () => {
    const event = minimalSessionEvent({
      functionName: "list_directory",
      args: { path: "/proj" },
      result: {
        output: "[file] README.md\n[dir] src/",
      },
    });
    const op = convertToExploreOperation(event, false);
    expect(op).not.toBeNull();
    expect(op?.exploreType).toBe("list_dir");
    expect(op?.files?.length).toBeGreaterThan(0);
    expect(op?.query).toContain("ls");
  });

  it("routes raw Cursor Glob File events to glob results", () => {
    const event = minimalSessionEvent({
      functionName: "Glob File",
      args: { globPattern: "**/*.ts" },
      result: {
        directories: [
          {
            absPath: "/repo/src",
            files: [{ relPath: "a.ts" }, { relPath: "nested/b.ts" }],
          },
        ],
      },
    });
    const op = convertToExploreOperation(event, false);
    expect(op).not.toBeNull();
    expect(op?.exploreType).toBe("glob");
    expect(op?.files).toEqual(["a.ts", "nested/b.ts"]);
  });

  it("maps glob search to file list results when present", () => {
    const event = minimalSessionEvent({
      functionName: "glob_file_search",
      args: { glob_pattern: "**/*.ts" },
      result: {
        success: {
          files: ["/repo/a.ts", "/repo/b.ts"],
        },
      },
    });
    const op = convertToExploreOperation(event, false);
    expect(op).not.toBeNull();
    expect(op?.exploreType).toBe("glob");
    expect(op?.files).toEqual(["/repo/a.ts", "/repo/b.ts"]);
  });

  it("maps code_search find_files action to glob exploreType and reads rustExtracted files", () => {
    const event = minimalSessionEvent({
      functionName: "code_search",
      args: { action: "find_files", pattern: "tokenRefresh.ts" },
      // Rust pipeline pre-computes this typed payload and attaches it to the
      // event via `extracted`. The converter must prefer it over raw JSON.
      extracted: {
        kind: "glob",
        pattern: "tokenRefresh.ts",
        files: ["src/api/http/client/tokenRefresh.ts"],
        totalFiles: 1,
      },
      // Raw result is the flat text blob produced by `file_search_formatted`;
      // the converter should not need to parse it when `extracted` is present.
      result: {
        output: {
          success: {
            content: "src/api/http/client/tokenRefresh.ts",
          },
        },
      },
    });

    const op = convertToExploreOperation(event, true);
    expect(op).not.toBeNull();
    expect(op?.exploreType).toBe("glob");
    expect(op?.files).toEqual(["src/api/http/client/tokenRefresh.ts"]);
    expect(op?.totalMatches).toBe(1);
  });

  it("falls back to text file list when rustExtracted glob is empty", () => {
    const event = minimalSessionEvent({
      functionName: "code_search",
      args: { action: "find_files", pattern: "package.json" },
      extracted: {
        kind: "glob",
        pattern: "package.json",
        files: [],
        totalFiles: 0,
      },
      result: {
        content:
          "/repo/install/package.json\n" +
          "/repo/test/mocks/plugin_modules/nodebb-plugin-xyz/package.json",
      },
    });

    const op = convertToExploreOperation(event, false);
    expect(op).not.toBeNull();
    expect(op?.exploreType).toBe("glob");
    expect(op?.files).toEqual([
      "/repo/install/package.json",
      "/repo/test/mocks/plugin_modules/nodebb-plugin-xyz/package.json",
    ]);
    expect(op?.totalMatches).toBe(2);
  });

  it("prefers rustExtracted.search results for code_search grep action", () => {
    const event = minimalSessionEvent({
      functionName: "code_search",
      args: { action: "grep", pattern: "hosted_service_proxy" },
      extracted: {
        kind: "search",
        query: "hosted_service_proxy",
        results: [
          {
            file: "src/api/http/client/hostedServiceApi.ts",
            line: 125,
            content: "hosted_service_proxy",
          },
        ],
        totalMatches: 1,
      },
      result: {},
    });

    const op = convertToExploreOperation(event, false);
    expect(op).not.toBeNull();
    expect(op?.exploreType).toBe("code_search");
    expect(op?.results).toHaveLength(1);
    expect(op?.results[0].file).toBe("src/api/http/client/hostedServiceApi.ts");
    expect(op?.results[0].line).toBe(125);
  });

  it("falls back to ripgrep text when rustExtracted.search has no rows", () => {
    const event = minimalSessionEvent({
      functionName: "code_search",
      args: {
        action: "grep",
        pattern: "mget|methods|require\\('../../src/database|databasemock",
        repo_path: "/Users/laptop-h/Documents/GitHub/NodeBB/test/mocks",
      },
      extracted: {
        kind: "search",
        query: "mget|methods|require\\('../../src/database|databasemock",
        results: [],
        totalMatches: 77,
      },
      result: {
        content:
          "/Users/laptop-h/Documents/GitHub/NodeBB/test/mocks/databasemock.js-127-winston.info(`environment ${global.env}`);\n" +
          "/Users/laptop-h/Documents/GitHub/NodeBB/test/mocks/databasemock.js-128-\n" +
          "/Users/laptop-h/Documents/GitHub/NodeBB/test/mocks/databasemock.js:129:const db = require('../../src/database');\n" +
          "/Users/laptop-h/Documents/GitHub/NodeBB/test/mocks/databasemock.js-130-\n" +
          "/Users/laptop-h/Documents/GitHub/NodeBB/test/mocks/databasemock.js-131-module.exports = db;",
      },
    });

    const op = convertToExploreOperation(event, false);
    expect(op).not.toBeNull();
    expect(op?.exploreType).toBe("code_search");
    expect(op?.exploreAction).toBe("grep");
    expect(op?.results).toHaveLength(1);
    expect(op?.files).toEqual([]);
    expect(op?.totalMatches).toBe(1);
    expect(op?.results[0]).toEqual({
      file: "/Users/laptop-h/Documents/GitHub/NodeBB/test/mocks/databasemock.js",
      line: 129,
      content: "const db = require('../../src/database');",
    });
  });

  it("parses Cursor pruned grep topFiles summaries", () => {
    const event = minimalSessionEvent({
      functionName: "grep",
      args: { pattern: "dedupe", path: "src" },
      result: {
        isPruned: true,
        totalFiles: 1,
        totalMatches: 13,
        topFiles: [
          {
            uri: "src/modules/WorkStation/CodeEditor/SessionReplay/__tests__/deduplication.test.ts",
            matchCount: 13,
          },
        ],
      },
    });

    const op = convertToExploreOperation(event, false);
    expect(op).not.toBeNull();
    expect(op?.exploreType).toBe("code_search");
    expect(op?.totalMatches).toBe(13);
    expect(op?.results).toHaveLength(1);
    expect(op?.results[0].file).toBe(
      "src/modules/WorkStation/CodeEditor/SessionReplay/__tests__/deduplication.test.ts"
    );
    expect(op?.results[0].content).toBe("13 matches");
  });

  it("parses Cursor grep summaries from explicit cursorAdditionalData", () => {
    const event = minimalSessionEvent({
      functionName: "grep",
      args: {
        pattern: "TodoKanban|replay-todo-kanban|planner.todoList|todo-kanban",
        path: "/Users/laptop-h/Documents/GitHub/yorg_frontend/src/modules/WorkStation/Chat",
      },
      result: {
        cursorAdditionalData: {
          isPruned: true,
          totalFiles: 2,
          totalMatches: 15,
          topFiles: [
            {
              uri: "src/modules/WorkStation/Chat/Communication/TodoKanban.tsx",
              matchCount: 13,
            },
            {
              uri: "src/modules/WorkStation/Chat/Communication/MessageViewer.tsx",
              matchCount: 2,
            },
          ],
        },
      },
    });

    const op = convertToExploreOperation(event, false);
    expect(op).not.toBeNull();
    expect(op?.totalMatches).toBe(15);
    expect(op?.results).toHaveLength(2);
    expect(op?.results[0]).toEqual({
      file: "src/modules/WorkStation/Chat/Communication/TodoKanban.tsx",
      line: 0,
      content: "13 matches",
    });
  });

  it("does not synthesize fake grep results when result details are missing", () => {
    const event = minimalSessionEvent({
      functionName: "code_search",
      args: { query: "formatToolName", target_directory: "SessionReplay" },
      result: {},
    });

    const op = convertToExploreOperation(event, false);
    expect(op).not.toBeNull();
    expect(op?.exploreType).toBe("code_search");
    expect(op?.results).toHaveLength(0);
    expect(op?.totalMatches).toBe(0);
  });

  it("parses array-shaped search content", () => {
    const event = minimalSessionEvent({
      functionName: "code_search",
      args: { pattern: "api" },
      result: {
        content: [
          {
            name: "src/api.ts",
            lineNumber: 4,
            content: "export function api() {}",
          },
        ],
      },
    });

    const op = convertToExploreOperation(event, false);
    expect(op).not.toBeNull();
    expect(op?.results).toHaveLength(1);
    expect(op?.results[0]).toEqual({
      file: "src/api.ts",
      line: 4,
      content: "export function api() {}",
    });
  });

  it("parses array-shaped glob content", () => {
    const event = minimalSessionEvent({
      functionName: "glob_file_search",
      args: { glob_pattern: "**/*.ts" },
      result: {
        content: [{ name: "src/api.ts" }, { path: "src/main.ts" }],
      },
    });

    const op = convertToExploreOperation(event, false);
    expect(op).not.toBeNull();
    expect(op?.exploreType).toBe("glob");
    expect(op?.files).toEqual(["src/api.ts", "src/main.ts"]);
  });

  it("parses array-shaped LSP text content", () => {
    const event = minimalSessionEvent({
      functionName: "query_lsp",
      args: { file_path: "src/api.ts" },
      result: {
        message: {
          content: [
            {
              type: "text",
              text: "Diagnostics for src/api.ts:\nNo diagnostics.",
            },
          ],
        },
      },
    });

    const op = convertToExploreOperation(event, false);
    expect(op).not.toBeNull();
    expect(op?.exploreType).toBe("query_lsp");
    expect(op?.results).toHaveLength(1);
    expect(op?.results[0].content).toContain("Diagnostics for src/api.ts");
    expect(op?.files).toEqual(["src/api.ts"]);
    expect(op?.event.args).toEqual({});
    expect(op?.event.result).toEqual({});
  });

  it("parses raw LSP diagnostics text into deduped rows", () => {
    const diagnosticText = `Diagnostics for /repo/src/lintTest.ts:
  L5:9 [error] Type 'number' is not assignable to type 'string'. (typescript)
  L6:3 [error] Type 'string' is not assignable to type 'number'. (typescript)
  L10:19 [error] Cannot find name 'missingIdentifier'. (typescript)
  L3:32 [hint] 'input' is declared but its value is never read. (typescript)
  L4:9 [hint] 'unusedVariable' is declared but its value is never read. (typescript)
Diagnostics for /repo/src/lintTest.ts:
  L5:9 [error] Type 'number' is not assignable to type 'string'. (typescript)
  L6:3 [error] Type 'string' is not assignable to type 'number'. (typescript)
  L10:19 [error] Cannot find name 'missingIdentifier'. (typescript)
  L3:32 [hint] 'input' is declared but its value is never read. (typescript)
  L4:9 [hint] 'unusedVariable' is declared but its value is never read. (typescript)`;

    const event = minimalSessionEvent({
      functionName: "query_lsp",
      result: { content: diagnosticText },
    });

    const op = convertToExploreOperation(event, false);
    expect(op).not.toBeNull();
    expect(op?.exploreType).toBe("query_lsp");
    expect(op?.files).toEqual(["/repo/src/lintTest.ts"]);
    expect(op?.results).toHaveLength(5);
    expect(op?.results[0]).toEqual({
      file: "/repo/src/lintTest.ts",
      line: 5,
      content:
        "[error] Type 'number' is not assignable to type 'string'. (typescript)",
    });
    expect(op?.totalMatches).toBe(5);
  });

  it("shows checked files for Cursor read_lints results without diagnostics text", () => {
    const event = minimalSessionEvent({
      functionName: "query_lsp",
      args: { paths: ["src/ReplayTabBar.tsx"] },
      result: {
        linterErrorsByFile: [
          {
            relativeWorkspacePath: "src/ReplayTabBar.tsx",
          },
        ],
      },
    });

    const op = convertToExploreOperation(event, false);
    expect(op).not.toBeNull();
    expect(op?.exploreType).toBe("query_lsp");
    expect(op?.results).toHaveLength(1);
    expect(op?.results[0].content).toContain("Checked files:");
    expect(op?.results[0].content).toContain("src/ReplayTabBar.tsx");
    expect(op?.files).toEqual(["src/ReplayTabBar.tsx"]);
    expect(op?.event.args).toEqual({});
    expect(op?.event.result).toEqual({});
  });
});
