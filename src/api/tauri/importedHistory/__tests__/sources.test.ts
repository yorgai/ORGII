import { describe, expect, it } from "vitest";

import {
  IMPORTED_HISTORY_SOURCES,
  getImportedHistorySourceByListCategory,
  getImportedHistorySourceBySessionId,
  isImportedHistoryListCategory,
} from "@src/api/tauri/importedHistory";

describe("imported history source registry", () => {
  it("registers source-specific external history providers", () => {
    expect(IMPORTED_HISTORY_SOURCES.map((source) => source.sourceId)).toEqual([
      "codex_app",
      "claude_code",
      "cursor_agent",
      "opencode",
      "windsurf",
      "workbuddy",
      "gemini",
    ]);
    expect(
      IMPORTED_HISTORY_SOURCES.map((source) => source.listCategory)
    ).toEqual([
      "external_history:codex_app",
      "external_history:claude_code",
      "external_history:cursor_agent",
      "external_history:opencode",
      "external_history:windsurf",
      "external_history:workbuddy",
      "external_history:gemini",
    ]);
  });

  it("resolves source metadata by session id prefix", () => {
    expect(
      getImportedHistorySourceBySessionId("codexapp-rollout-1")?.sourceId
    ).toBe("codex_app");
    expect(
      getImportedHistorySourceBySessionId("claudecodeapp-session-1")?.sourceId
    ).toBe("claude_code");
    expect(
      getImportedHistorySourceBySessionId("cursoragentapp-session-1")?.sourceId
    ).toBe("cursor_agent");
    expect(
      getImportedHistorySourceBySessionId("opencodeapp-session-1")?.sourceId
    ).toBe("opencode");
    expect(
      getImportedHistorySourceBySessionId("windsurfapp-session-1")?.sourceId
    ).toBe("windsurf");
    expect(
      getImportedHistorySourceBySessionId("workbuddyapp-session-1")?.sourceId
    ).toBe("workbuddy");
    expect(
      getImportedHistorySourceBySessionId("geminiapp-session-1")?.sourceId
    ).toBe("gemini");
    expect(
      getImportedHistorySourceBySessionId("cursoride-session-1")
    ).toBeUndefined();
  });

  it("resolves source metadata by list category", () => {
    const expectedGroupLabels = [
      ["external_history:codex_app", "Codex App"],
      ["external_history:claude_code", "Claude Code"],
      ["external_history:cursor_agent", "Cursor Agent"],
      ["external_history:opencode", "OpenCode"],
      ["external_history:windsurf", "Windsurf"],
      ["external_history:workbuddy", "WorkBuddy"],
      ["external_history:gemini", "Gemini"],
    ] as const;

    for (const [category, groupLabel] of expectedGroupLabels) {
      expect(getImportedHistorySourceByListCategory(category)?.groupLabel).toBe(
        groupLabel
      );
    }
  });

  it("narrows source-aware list categories", () => {
    for (const source of IMPORTED_HISTORY_SOURCES) {
      expect(isImportedHistoryListCategory(source.listCategory)).toBe(true);
    }
    expect(isImportedHistoryListCategory("external_history")).toBe(false);
  });
});
