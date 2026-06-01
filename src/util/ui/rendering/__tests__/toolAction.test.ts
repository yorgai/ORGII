import { deriveToolAction, isBrowserCliTool } from "../toolAction";

describe("deriveToolAction", () => {
  it("prefers explicit action fields", () => {
    expect(deriveToolAction("worktree", { action: "list" })).toBe("list");
    expect(deriveToolAction("tool", { action_type: "snapshot" })).toBe(
      "snapshot"
    );
  });

  it("derives browser CLI action from the raw command", () => {
    expect(
      deriveToolAction("control_browser_with_agent_browser", {
        command: "open https://example.com",
      })
    ).toBe("open");
    expect(
      deriveToolAction("control_browser_with_playwright", {
        command: "snapshot",
      })
    ).toBe("snapshot");
  });

  it("does not derive command action for non-browser CLI tools", () => {
    expect(
      deriveToolAction("await_output", { command: "list" })
    ).toBeUndefined();
  });
});

describe("isBrowserCliTool", () => {
  it("detects raw browser CLI tools", () => {
    expect(isBrowserCliTool("control_browser_with_agent_browser")).toBe(true);
    expect(isBrowserCliTool("control_browser_with_playwright")).toBe(true);
    expect(isBrowserCliTool("control_internal_browser")).toBe(false);
  });
});
