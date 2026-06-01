import { assertSettingsUiParity } from "@src/config/settingsSchema/assertSettingsUiParity";

describe("settings UI parity", () => {
  it("keeps SETTINGS_REGISTRY, UI manifest, and covered keys in sync", () => {
    expect(() => assertSettingsUiParity()).not.toThrow();
  });
});
