/**
 * Pure result-parser helpers — unit tests.
 *
 * These functions convert raw tool result objects (JSON from Rust IPC) into
 * the structured shapes consumed by the ChatPanel block renderers.
 */
import { describe, expect, it } from "vitest";

import { parseWebsiteCardResult } from "../cardParsers";
import {
  buildWorkspaceInfoRows,
  extractResultText,
  hasNonEmptyResultValues,
  isErrorResult,
  parseManageWorkspaceResult,
  parseSearchFilesResult,
} from "../resultParsers";

// ── parseWebsiteCardResult ───────────────────────────────────────────────────

describe("parseWebsiteCardResult", () => {
  it("rejects malformed URL card data", () => {
    const card = parseWebsiteCardResult(
      "browser",
      { url: "https://exa*mple.com/docs" },
      {}
    );

    expect(card).toBeNull();
  });
});

// ── extractResultText ─────────────────────────────────────────────────────────

describe("extractResultText", () => {
  it("extracts from 'content' field first", () => {
    expect(extractResultText({ content: "hello", output: "world" })).toBe(
      "hello"
    );
  });

  it("extracts from 'output' when content is absent", () => {
    expect(extractResultText({ output: "result text" })).toBe("result text");
  });

  it("falls back through: observation, message, stdout, data, response", () => {
    expect(extractResultText({ observation: "observed" })).toBe("observed");
    expect(extractResultText({ message: "msg" })).toBe("msg");
    expect(extractResultText({ stdout: "out" })).toBe("out");
    expect(extractResultText({ data: "raw data" })).toBe("raw data");
    expect(extractResultText({ response: "resp" })).toBe("resp");
  });

  it("returns null when all text fields are empty or absent", () => {
    expect(extractResultText({ content: "", output: "  " })).toBeNull();
    expect(extractResultText({})).toBeNull();
  });

  it("returns error field when no text fields match", () => {
    expect(extractResultText({ error: "something went wrong" })).toBe(
      "something went wrong"
    );
  });

  it("returns null for whitespace-only text fields", () => {
    expect(extractResultText({ content: "   " })).toBeNull();
  });

  it("strips [screenshot:ID] markers from content", () => {
    const result = extractResultText({
      content: "page loaded [screenshot:a1b2c3d4]",
    });
    expect(result).toBe("page loaded");
  });

  it("parses browser JSON output and returns .text", () => {
    const result = extractResultText({
      output: JSON.stringify({ text: "DOM content", screenshot: "data:..." }),
    });
    expect(result).toBe("DOM content");
  });
});

// ── isErrorResult ─────────────────────────────────────────────────────────────

describe("isErrorResult", () => {
  it("detects success: false", () => {
    expect(isErrorResult({ success: false })).toBe(true);
  });

  it("detects is_error: true", () => {
    expect(isErrorResult({ is_error: true })).toBe(true);
  });

  it("detects error field presence", () => {
    expect(isErrorResult({ error: "timeout" })).toBe(true);
  });

  it("detects error_message field presence", () => {
    expect(isErrorResult({ error_message: "not found" })).toBe(true);
  });

  it("detects 'error:' prefix in content", () => {
    expect(isErrorResult({ content: "Error: file not found" })).toBe(true);
  });

  it("returns false for a clean success result", () => {
    expect(isErrorResult({ success: true, content: "all good" })).toBe(false);
  });

  it("returns false for empty result", () => {
    expect(isErrorResult({})).toBe(false);
  });
});

// ── hasNonEmptyResultValues ───────────────────────────────────────────────────

describe("hasNonEmptyResultValues", () => {
  it("returns false for empty object", () => {
    expect(hasNonEmptyResultValues({})).toBe(false);
  });

  it("returns false when all values are null / undefined / whitespace", () => {
    expect(hasNonEmptyResultValues({ a: null, b: undefined, c: "   " })).toBe(
      false
    );
  });

  it("returns true when at least one value is a non-empty string", () => {
    expect(hasNonEmptyResultValues({ content: "data" })).toBe(true);
  });

  it("returns true for non-string non-null values (including 0 and false)", () => {
    // Any non-null, non-undefined, non-whitespace-string value counts as non-empty.
    expect(hasNonEmptyResultValues({ count: 0 })).toBe(true);
    expect(hasNonEmptyResultValues({ count: 1 })).toBe(true);
    expect(hasNonEmptyResultValues({ flag: true })).toBe(true);
    expect(hasNonEmptyResultValues({ flag: false })).toBe(true);
  });
});

// ── parseSearchFilesResult ────────────────────────────────────────────────────

describe("parseSearchFilesResult", () => {
  it("returns empty array for 'No files found.' sentinel", () => {
    expect(parseSearchFilesResult("No files found.")).toEqual([]);
  });

  it("extracts file paths when all lines contain separators", () => {
    const text = ["/repo/src/index.ts", "/repo/src/utils/helpers.ts"].join(
      "\n"
    );
    const result = parseSearchFilesResult(text);
    expect(result).toEqual([
      "/repo/src/index.ts",
      "/repo/src/utils/helpers.ts",
    ]);
  });

  it("returns null for lines that don't look like file paths", () => {
    expect(parseSearchFilesResult("some plain text\nno separators")).toBeNull();
  });

  it("ignores 'Watched' lines", () => {
    const text = "Watched directories: /repo\n/repo/src/a.ts";
    const result = parseSearchFilesResult(text);
    expect(result).toContain("/repo/src/a.ts");
    expect(result).not.toContain(expect.stringContaining("Watched"));
  });
});

// ── parseManageWorkspaceResult ────────────────────────────────────────────────

describe("parseManageWorkspaceResult", () => {
  it("returns null when the text contains no '→' arrows", () => {
    expect(parseManageWorkspaceResult("no arrows here")).toBeNull();
  });

  it("parses git repo entries", () => {
    const text = "[git] my-repo → /repos/my-repo";
    const result = parseManageWorkspaceResult(text);
    expect(result).not.toBeNull();
    expect(result![0].kind).toBe("git");
    expect(result![0].name).toBe("my-repo");
    expect(result![0].path).toBe("/repos/my-repo");
  });

  it("parses folder entries", () => {
    const text = "[folder] docs → /repos/my-repo/docs";
    const result = parseManageWorkspaceResult(text);
    expect(result![0].kind).toBe("folder");
    expect(result![0].name).toBe("docs");
  });

  it("defaults unknown kind to 'git'", () => {
    const text = "[unknown] repo → /path";
    const result = parseManageWorkspaceResult(text);
    expect(result![0].kind).toBe("git");
  });
});

// ── buildWorkspaceInfoRows ────────────────────────────────────────────────────

describe("buildWorkspaceInfoRows", () => {
  it("returns null for unrecognised action", () => {
    expect(buildWorkspaceInfoRows({ action: "inspect" })).toBeNull();
  });

  it("builds rows for 'add' action", () => {
    const rows = buildWorkspaceInfoRows({
      action: "add",
      path: "/repos/x",
      name: "x",
    });
    expect(rows).not.toBeNull();
    const ops = rows!.find((r) => r.key === "operation");
    expect(ops?.value).toBe("Add local repo");
    const pathRow = rows!.find((r) => r.key === "path");
    expect(pathRow?.value).toBe("/repos/x");
  });

  it("builds rows for 'clone' action", () => {
    const rows = buildWorkspaceInfoRows({
      action: "clone",
      url: "https://github.com/org/repo",
      target_dir: "/repos",
    });
    expect(rows!.find((r) => r.key === "operation")?.value).toBe(
      "Clone from GitHub"
    );
    expect(rows!.find((r) => r.key === "url")?.value).toBe(
      "https://github.com/org/repo"
    );
  });

  it("builds 'Create git repo' for 'create' with git:true (default)", () => {
    const rows = buildWorkspaceInfoRows({
      action: "create",
      path: "/repos/new",
    });
    expect(rows!.find((r) => r.key === "operation")?.value).toBe(
      "Create git repo"
    );
  });

  it("builds 'Create folder' for 'create' with git:false", () => {
    const rows = buildWorkspaceInfoRows({
      action: "create",
      path: "/folder",
      git: false,
    });
    expect(rows!.find((r) => r.key === "operation")?.value).toBe(
      "Create folder"
    );
  });

  it("builds rows for 'remove' action with path", () => {
    const rows = buildWorkspaceInfoRows({
      action: "remove",
      path: "/repos/old",
    });
    expect(rows!.find((r) => r.key === "operation")?.value).toBe(
      "Remove workspace"
    );
    expect(rows!.find((r) => r.key === "path")?.value).toBe("/repos/old");
  });
});
