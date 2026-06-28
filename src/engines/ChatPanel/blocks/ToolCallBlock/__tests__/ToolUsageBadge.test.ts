import { describe, expect, it } from "vitest";

import { formatToolUsageTokenCount } from "../ToolUsageBadge";

describe("ToolUsageBadge helpers", () => {
  it("formats compact token counts for usage badges", () => {
    expect(formatToolUsageTokenCount(999)).toBe("999");
    expect(formatToolUsageTokenCount(1_200)).toBe("1.2k");
    expect(formatToolUsageTokenCount(12_300)).toBe("12k");
  });
});
