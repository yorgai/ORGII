import { describe, expect, it } from "vitest";

import { resolveVariantReselection } from "../variantReselect";

describe("resolveVariantReselection", () => {
  it("returns the next model id when the variant changed", () => {
    expect(resolveVariantReselection("gpt-5-high", "gpt-5-low")).toBe(
      "gpt-5-low"
    );
  });

  it("returns null when the variant is unchanged", () => {
    expect(resolveVariantReselection("gpt-5-high", "gpt-5-high")).toBeNull();
  });

  it("returns null for an empty next model id", () => {
    expect(resolveVariantReselection("gpt-5-high", "")).toBeNull();
  });

  it("re-selects from a base model to a concrete variant", () => {
    expect(resolveVariantReselection("gpt-5", "gpt-5-high")).toBe("gpt-5-high");
  });

  it("re-selects when only the fast flag toggled", () => {
    expect(resolveVariantReselection("gpt-5-high", "gpt-5-high-fast")).toBe(
      "gpt-5-high-fast"
    );
  });
});
