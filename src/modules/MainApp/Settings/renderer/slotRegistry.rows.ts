import type { SettingsCustomRowSlot } from "@src/config/settingsUiManifest/types";

/**
 * Custom row slot registry. Currently empty — kept so the renderer's
 * `row.kind === "custom"` branch can still look up a component when a
 * new slot is added without touching the renderer.
 */
export const settingsRowSlotRegistry: Record<string, SettingsCustomRowSlot> =
  {};
