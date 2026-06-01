import {
  extractTextFromContent,
  isOrchestratorSystemPrompt,
} from "../textExtractors";

describe("extractTextFromContent", () => {
  it("returns undefined for nullish input", () => {
    expect(extractTextFromContent(null)).toBeUndefined();
    expect(extractTextFromContent(undefined)).toBeUndefined();
  });

  it("returns decoded string for plain strings", () => {
    expect(extractTextFromContent("hello")).toBe("hello");
    expect(extractTextFromContent("\\u0041")).toBe("A");
  });

  it("joins text parts from content arrays", () => {
    const value = [
      { type: "text", text: "line1" },
      { type: "text", text: "line2" },
    ];
    expect(extractTextFromContent(value)).toBe("line1\nline2");
  });

  it("recurses into objects with content", () => {
    expect(extractTextFromContent({ content: "nested" })).toBe("nested");
  });

  it("returns undefined for empty arrays", () => {
    expect(extractTextFromContent([])).toBeUndefined();
  });
});

describe("isOrchestratorSystemPrompt", () => {
  it("returns true for orchestrator-style prefixes", () => {
    expect(
      isOrchestratorSystemPrompt(
        "Create a technical specification for the feature."
      )
    ).toBe(true);
    expect(isOrchestratorSystemPrompt("Task: do something")).toBe(true);
  });

  it("returns false for normal user text", () => {
    expect(isOrchestratorSystemPrompt("Hello world")).toBe(false);
  });

  it("returns false for empty or whitespace-only text", () => {
    expect(isOrchestratorSystemPrompt("")).toBe(false);
    expect(isOrchestratorSystemPrompt("   ")).toBe(false);
  });
});
