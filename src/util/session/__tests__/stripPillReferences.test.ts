import { stripPillReferences } from "../stripPillReferences";

describe("stripPillReferences", () => {
  it("strips file pill", () => {
    expect(stripPillReferences("Hello [file:path/to/file.ts] world")).toBe(
      "Hello world"
    );
  });

  it("strips terminal pill with base64 segment", () => {
    expect(stripPillReferences("x [terminal:abc::YmFzZTY0] y")).toBe("x y");
  });

  it("strips repo pill", () => {
    expect(stripPillReferences("p [repo:my-repo] q")).toBe("p q");
  });

  it("strips branch pill", () => {
    expect(stripPillReferences("b [branch:main] c")).toBe("b c");
  });

  it("strips folder pill", () => {
    expect(stripPillReferences("f [folder:/src] g")).toBe("f g");
  });

  it("strips session pill", () => {
    expect(stripPillReferences("s [session:abc-123] t")).toBe("s t");
  });

  it("strips browser pill", () => {
    expect(stripPillReferences("open [browser:https://example.com] now")).toBe(
      "open now"
    );
  });

  it("strips fenced code blocks", () => {
    expect(stripPillReferences("a\n```\ncode\n```\nb")).toBe("a\nb");
  });

  it("preserves normal text", () => {
    expect(stripPillReferences("plain text only")).toBe("plain text only");
  });

  it("handles multiple pill references", () => {
    expect(stripPillReferences("x[file:a] y[repo:b] z")).toBe("x y z");
  });

  it("trims result", () => {
    expect(stripPillReferences("  hello  ")).toBe("hello");
  });

  it("handles mixed pills and code blocks", () => {
    expect(stripPillReferences("start [file:x.ts]\n```\nline\n```\ntail")).toBe(
      "start\ntail"
    );
  });

  it("returns empty string for pill-only input", () => {
    expect(stripPillReferences("[file:only]")).toBe("");
  });
});
