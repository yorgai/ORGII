import { formatToolName } from "../formatToolName";
import { getToolDisplayLabelFromRegistry } from "../registryToolLabel";

describe("formatToolName", () => {
  it("only title-cases unregistered fallback tool names", () => {
    expect(formatToolName("unknown_custom_tool")).toBe("Unknown Custom Tool");
  });

  it("resolves browser CLI action labels from the Rust registry fixture", () => {
    expect(
      getToolDisplayLabelFromRegistry(
        "control_browser_with_agent_browser",
        "open"
      )
    ).toBe("Open Page");
    expect(
      getToolDisplayLabelFromRegistry(
        "control_browser_with_agent_browser",
        "click"
      )
    ).toBe("Click");
    expect(
      getToolDisplayLabelFromRegistry(
        "control_browser_with_playwright",
        "close"
      )
    ).toBe("Close Browser Session");
  });

  it("resolves non-browser built-in tool labels from the Rust registry fixture", () => {
    expect(getToolDisplayLabelFromRegistry("query_lsp")).toBe(
      "Queried LSP diagnostics"
    );
    expect(getToolDisplayLabelFromRegistry("read_file", "read_pdf")).toBe(
      "Analyzed PDF {{name}}"
    );
    expect(getToolDisplayLabelFromRegistry("manage_workspace", "add")).toBe(
      "Added workspace"
    );
    expect(getToolDisplayLabelFromRegistry("code_search", "grep")).toBe("Grep");
    expect(getToolDisplayLabelFromRegistry("worktree", "list")).toBe(
      "Listed Worktrees"
    );
  });
});
