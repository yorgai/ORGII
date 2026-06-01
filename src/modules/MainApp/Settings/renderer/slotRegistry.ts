import type { SettingsSectionSlotId } from "@src/config/settingsUiManifest/slotIds";
import type { SettingsCustomSectionSlot } from "@src/config/settingsUiManifest/types";

import { agentSettingsSectionSlotRegistry } from "./slotRegistry.agent";
import { appSettingsSectionSlotRegistry } from "./slotRegistry.app";

export { settingsRowSlotRegistry } from "./slotRegistry.rows";

export const settingsSectionSlotRegistry: Partial<
  Record<SettingsSectionSlotId, SettingsCustomSectionSlot>
> = {
  ...appSettingsSectionSlotRegistry,
  ...agentSettingsSectionSlotRegistry,
};
