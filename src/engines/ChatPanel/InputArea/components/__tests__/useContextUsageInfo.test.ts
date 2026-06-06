import { describe, expect, it } from "vitest";

import { filterContextRules, resolveRulesTokens } from "../useContextUsageInfo";

describe("useContextUsageInfo helpers", () => {
  it("excludes personal rules from workspace context accounting", () => {
    expect(
      filterContextRules([
        {
          name: "global-rule",
          enabled: true,
          estimatedTokens: 10,
          source: "global",
        },
        {
          name: "workspace-rule",
          enabled: true,
          estimatedTokens: 20,
          source: "workspace",
        },
        {
          name: "personal-e2e-rule",
          enabled: true,
          estimatedTokens: 900,
          source: "personal",
        },
        {
          name: "disabled-workspace-rule",
          enabled: false,
          estimatedTokens: 30,
          source: "workspace",
        },
      ]).map((rule) => rule.name)
    ).toEqual(["global-rule", "workspace-rule"]);
  });

  it("prefers live backend rules tokens when available", () => {
    expect(resolveRulesTokens({ rulesTokens: 42 }, 900)).toBe(42);
    expect(resolveRulesTokens({}, 900)).toBe(900);
    expect(resolveRulesTokens(null, 900)).toBe(900);
  });
});
