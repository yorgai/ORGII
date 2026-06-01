import { formatInvokeError } from "../formatInvokeError";

describe("formatInvokeError", () => {
  it("returns trimmed message for Error instances", () => {
    expect(formatInvokeError(new Error("  hello  "))).toBe("hello");
  });

  it("falls back to error name when Error message is empty or whitespace", () => {
    expect(formatInvokeError(new Error(""))).toBe("Error");
    expect(formatInvokeError(new Error("   "))).toBe("Error");
  });

  it("trims string payloads", () => {
    expect(formatInvokeError("  plain  ")).toBe("plain");
  });

  it("reads message from object records when non-empty", () => {
    expect(formatInvokeError({ message: "  from message  " })).toBe(
      "from message"
    );
  });

  it("reads nested string error when message is missing or empty", () => {
    expect(formatInvokeError({ error: "  nested  " })).toBe("nested");
    expect(formatInvokeError({ message: "", error: "  nested  " })).toBe(
      "nested"
    );
  });

  it("returns empty string when nothing usable is present", () => {
    expect(formatInvokeError(null)).toBe("");
    expect(formatInvokeError(undefined)).toBe("");
    expect(formatInvokeError(42)).toBe("");
    expect(formatInvokeError({})).toBe("");
    expect(formatInvokeError({ message: "" })).toBe("");
  });
});
