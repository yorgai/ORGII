import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import Switch from "@src/components/Switch";
import {
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

interface WorkspaceSettingsToggleProps {
  config: Record<string, unknown>;
  update: (path: string, value: unknown) => void;
}

const WorkspaceSettingsToggle: React.FC<WorkspaceSettingsToggleProps> = ({
  config,
  update,
}) => {
  const { t } = useTranslation("settings");
  const enabled = config.loadWorkspaceSettings !== false;

  const handleChange = useCallback(
    (nextEnabled: boolean) => {
      update("loadWorkspaceSettings", nextEnabled);
    },
    [update]
  );

  return (
    <SectionContainer>
      <SectionRow
        label={t("workspaceResources.loadWorkspaceSettings")}
        description={t("workspaceResources.loadWorkspaceSettingsDesc")}
      >
        <Switch
          checked={enabled}
          onChange={handleChange}
          dataTestId="agent-orgs-load-workspace-settings-switch"
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default WorkspaceSettingsToggle;
