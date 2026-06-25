import { describe, expect, it } from "vitest";

import { normalizeReactLiveSource } from "./ReactArtifactRunner";

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

  it("passes expression snippets through for inline react-live rendering", () => {
    const source = normalizeReactLiveSource("<button>Hello</button>");

    expect(source).toBe("<button>Hello</button>");
  });
});
