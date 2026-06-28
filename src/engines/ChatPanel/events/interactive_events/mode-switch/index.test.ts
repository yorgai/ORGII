import { describe, expect, it } from "vitest";

import { resolveModeSwitchChoiceFromResultContent } from "./helpers";

describe("resolveModeSwitchChoiceFromResultContent", () => {
  it("recognizes deferred mode-switch sentinel tool results", () => {
    expect(
      resolveModeSwitchChoiceFromResultContent(
        "MODE_SWITCH_DEFERRED:The user wants to keep chatting."
      )
    ).toBe("defer");
  });

  it("keeps existing switch and skip fallbacks", () => {
    expect(
      resolveModeSwitchChoiceFromResultContent("MODE_SWITCH_ACCEPTED:plan")
    ).toBe("switch");
    expect(
      resolveModeSwitchChoiceFromResultContent(
        "User chose to stay in the current mode."
      )
    ).toBe("skip");
  });
});
