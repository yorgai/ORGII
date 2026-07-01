import { describe, expect, it } from "vitest";

import { IMPORTED_HISTORY_SOURCES } from "@src/api/tauri/importedHistory";

import { groupKeyToWireCategory } from "../sessionGroupHelpers";

describe("groupKeyToWireCategory", () => {
  it("keeps imported history load-more categories source-specific", () => {
    for (const source of IMPORTED_HISTORY_SOURCES) {
      expect(groupKeyToWireCategory(source.listCategory)).toBe(
        source.listCategory
      );
    }
  });

  it("maps existing non-imported groups to their loader categories", () => {
    expect(groupKeyToWireCategory("cursor_ide")).toBe("cursor_ide");
    expect(groupKeyToWireCategory("cli")).toBe("cli_agent");
    expect(groupKeyToWireCategory("os")).toBe("rust_agent");
  });
});
