import {
  SETTINGS_SECTION_SLOT_IDS,
  type SettingsSectionSlotId,
} from "@src/config/settingsUiManifest/slotIds";
import type { SettingsCustomSectionSlot } from "@src/config/settingsUiManifest/types";
import AppearanceSection from "@src/modules/MainApp/Settings/sections/AppearanceSection";
import EditorSection from "@src/modules/MainApp/Settings/sections/EditorSection";
import GeneralSection from "@src/modules/MainApp/Settings/sections/GeneralSection";
import MonitorSection from "@src/modules/MainApp/Settings/sections/MonitorSection";

export const appSettingsSectionSlotRegistry: Partial<
  Record<SettingsSectionSlotId, SettingsCustomSectionSlot>
> = {
  [SETTINGS_SECTION_SLOT_IDS.APP_GENERAL]: GeneralSection,
  [SETTINGS_SECTION_SLOT_IDS.APP_APPEARANCE]: AppearanceSection,
  [SETTINGS_SECTION_SLOT_IDS.APP_EDITOR]: EditorSection,

  [SETTINGS_SECTION_SLOT_IDS.APP_MONITOR]: MonitorSection,
};
