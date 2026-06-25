import { describe, expect, it } from "vitest";

import {
  normalizeHtmlLiveSource,
  normalizeReactLiveSource,
} from "./ReactArtifactRunner";

describe("ReactArtifactRunner", () => {
  it("converts a default App export into a react-live render call", () => {
    const source = normalizeReactLiveSource(
      "export default function App() { return <button>Hi</button>; }"
    );

    expect(source).toContain("function App()");
    expect(source).toContain("render(<App />);");
    expect(source).not.toContain("iframe");
    expect(source).not.toContain("srcDoc");
  });

  it("supports declared App components without module syntax", () => {
    const source = normalizeReactLiveSource(
      "function App() { return <div>Hi</div>; }"
    );

    expect(source).toContain("render(<App />);");
  });

  it("wraps HTML snippets as sanitized react-live preview code", () => {
    const source = normalizeHtmlLiveSource(
      '<p>Hello</p><script>alert("xss")</script>'
    );

    expect(source).toContain("render(<div");
    expect(source).toContain("dangerouslySetInnerHTML");
    expect(source).toContain("<p>Hello</p>");
    expect(source).not.toContain("script");
    expect(source).not.toContain("iframe");
    expect(source).not.toContain("srcDoc");
  });
});
