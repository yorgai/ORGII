import React from "react";
import { useTranslation } from "react-i18next";

import { getSettingsSectionById } from "@src/config/settingsUiManifest";
import { createLogger } from "@src/hooks/logger";

import SettingsContainerRenderer from "./SettingsContainerRenderer";
import { settingsSectionSlotRegistry } from "./slotRegistry";

const log = createLogger("SettingsRenderer");

interface SettingsSectionRendererProps {
  sectionId: string;
  activeTab?: string;
}

const SettingsSectionRenderer: React.FC<SettingsSectionRendererProps> = ({
  sectionId,
  activeTab,
}) => {
  const { t } = useTranslation("settings");
  const section = getSettingsSectionById(sectionId);

  if (!section) {
    return null;
  }

  const SectionSlot = section.customSectionSlotId
    ? settingsSectionSlotRegistry[section.customSectionSlotId]
    : undefined;
  const hasContainers = Boolean(section.containers?.length);

  if (section.customSectionSlotId && !SectionSlot) {
    log.error(
      "[SettingsRenderer] Missing section slot for id:",
      section.customSectionSlotId
    );
  }

  return (
    <div id={section.id} className="scroll-mt-4">
      <div className="flex flex-col gap-3">
        {SectionSlot ? (
          <SectionSlot activeTab={activeTab} />
        ) : hasContainers ? (
          section.containers?.map((container) => (
            <SettingsContainerRenderer
              key={container.id}
              sectionId={section.id}
              container={container}
            />
          ))
        ) : (
          <div className="text-xs text-danger-6">
            {t("common:status.error", "Error")}: section renderer is not
            configured.
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsSectionRenderer;
