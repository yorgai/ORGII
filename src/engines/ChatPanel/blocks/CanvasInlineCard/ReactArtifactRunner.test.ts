import { describe, expect, it } from "vitest";

import { buildReactArtifactFactorySource } from "./ReactArtifactRunner";

describe("ReactArtifactRunner", () => {
  it("converts a default App export into a host-side factory", () => {
    const factorySource = buildReactArtifactFactorySource(
      "export default function App() { return React.createElement('button', null, 'Hi'); }"
    );

    expect(factorySource).toContain("function App()");
    expect(factorySource).toContain("return App");
    expect(factorySource).not.toContain("iframe");
    expect(factorySource).not.toContain("srcDoc");
  });

  it("supports declared App components without module syntax", () => {
    const factorySource = buildReactArtifactFactorySource(
      "function App() { return React.createElement('div', null, 'Hi'); }"
    );

    expect(factorySource).toContain(
      'return typeof App !== "undefined" ? App : undefined'
    );
  });
});
