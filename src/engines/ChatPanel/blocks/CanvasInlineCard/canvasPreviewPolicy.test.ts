import { describe, expect, it } from "vitest";

import {
  getCanvasPreviewRenderKind,
  splitA2UIContent,
} from "./canvasPreviewPolicy";

describe("canvasPreviewPolicy", () => {
  it("routes payloads to the expected preview runtime", () => {
    expect(getCanvasPreviewRenderKind(null)).toBe("empty");
    expect(getCanvasPreviewRenderKind({ mode: "a2ui" })).toBe("empty");
    expect(
      getCanvasPreviewRenderKind({ mode: "a2ui", content: '{"type":"text"}' })
    ).toBe("a2ui");
    expect(
      getCanvasPreviewRenderKind({
        mode: "html",
        content: "<button>Hi</button>",
      })
    ).toBe("html");
    expect(
      getCanvasPreviewRenderKind({
        mode: "react",
        content: "export default function App() { return null; }",
      })
    ).toBe("react");
    expect(
      getCanvasPreviewRenderKind({ mode: "url", url: "https://example.com" })
    ).toBe("url");
  });

  it("preserves multiline JSON records while splitting A2UI JSONL", () => {
    const lines = splitA2UIContent(
      [
        JSON.stringify({ type: "text", content: "hello" }),
        JSON.stringify({ type: "code", content: "line 1\nline 2" }, null, 2),
        "{partial",
      ].join("\n")
    );

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ type: "text", content: "hello" });
    expect(JSON.parse(lines[1])).toEqual({
      type: "code",
      content: "line 1\nline 2",
    });
  });
});
