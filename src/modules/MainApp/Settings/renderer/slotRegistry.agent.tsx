import React from "react";

import {
  SETTINGS_SECTION_SLOT_IDS,
  type SettingsSectionSlotId,
} from "@src/config/settingsUiManifest/slotIds";
import type { SettingsCustomSectionSlot } from "@src/config/settingsUiManifest/types";
import AgentBuiltinConfigSection from "@src/modules/MainApp/AgentOrgs/config/AgentBuiltinConfigSection";

const AgentOSConfigSlot: React.FC = () => (
  <AgentBuiltinConfigSection kind="os" />
);

const AgentSdeConfigSlot: React.FC = () => (
  <AgentBuiltinConfigSection kind="sde" />
);

export const agentSettingsSectionSlotRegistry: Partial<
  Record<SettingsSectionSlotId, SettingsCustomSectionSlot>
> = {
  [SETTINGS_SECTION_SLOT_IDS.AGENT_OS_CONFIG]: AgentOSConfigSlot,
  [SETTINGS_SECTION_SLOT_IDS.AGENT_SDE_CONFIG]: AgentSdeConfigSlot,
};
