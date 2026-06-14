import { describe, expect, it } from "vitest";

import { groupKeyToWireCategory } from "../sessionGroupHelpers";

describe("groupKeyToWireCategory", () => {
  it("keeps imported history load-more categories source-specific", () => {
    expect(groupKeyToWireCategory("external_history:codex_app")).toBe(
      "external_history:codex_app"
    );
    expect(groupKeyToWireCategory("external_history:claude_code")).toBe(
      "external_history:claude_code"
    );
    expect(groupKeyToWireCategory("external_history:opencode")).toBe(
      "external_history:opencode"
    );
    expect(groupKeyToWireCategory("external_history:windsurf")).toBe(
      "external_history:windsurf"
    );
  });

  it("maps existing non-imported groups to their loader categories", () => {
    expect(groupKeyToWireCategory("cursor_ide")).toBe("cursor_ide");
    expect(groupKeyToWireCategory("cli")).toBe("cli_agent");
    expect(groupKeyToWireCategory("os")).toBe("rust_agent");
  });
});
