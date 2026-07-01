import { describe, expect, it } from "vitest";

import { IMPORTED_HISTORY_SOURCES } from "@src/api/tauri/importedHistory";

import {
  SESSION_LIST_CATEGORIES,
  resetPaginationState,
} from "../paginationAtoms";

describe("session pagination categories", () => {
  it("includes one source-aware category per imported history source", () => {
    const importedCategories = IMPORTED_HISTORY_SOURCES.map(
      (source) => source.listCategory
    );

    expect(SESSION_LIST_CATEGORIES).toEqual([
      "cli_agent",
      "rust_agent",
      "cursor_ide",
      ...importedCategories,
    ]);
  });

  it("initializes pagination state for each source-specific imported category", () => {
    const state = resetPaginationState();

    for (const source of IMPORTED_HISTORY_SOURCES) {
      expect(state[source.listCategory]).toEqual({
        loaded: 0,
        hasMore: false,
        loading: false,
      });
    }
  });
});
