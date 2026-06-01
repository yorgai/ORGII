import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import TabPill from "@src/components/TabPill";
import type { TabPillItem } from "@src/components/TabPill";
import {
  PROJECT_ORG_SURFACE_VIEW,
  type ProjectOrgSurfaceView,
} from "@src/store/workstation/tabs";

export interface ProjectOrgSurfacePillSwitchProps {
  orgView: ProjectOrgSurfaceView;
  onOrgViewChange: (view: ProjectOrgSurfaceView) => void;
}

export const ProjectOrgSurfacePillSwitch: React.FC<
  ProjectOrgSurfacePillSwitchProps
> = ({ orgView, onOrgViewChange }) => {
  const { t } = useTranslation("projects");
  const { t: tCommon } = useTranslation("common");

  const surfaceTabs = useMemo<TabPillItem[]>(
    () => [
      {
        key: PROJECT_ORG_SURFACE_VIEW.PROJECTS,
        label: t("projects.dashboardTitle"),
      },
      {
        key: PROJECT_ORG_SURFACE_VIEW.WORK_ITEMS,
        label: t("workspace.workItems"),
      },
      {
        key: PROJECT_ORG_SURFACE_VIEW.SETTINGS,
        label: tCommon("tabs.settings"),
      },
    ],
    [t, tCommon]
  );

  return (
    <TabPill
      tabs={surfaceTabs}
      activeTab={orgView}
      onChange={(key) => onOrgViewChange(key as ProjectOrgSurfaceView)}
      variant="pill"
      color="fill"
      fillWidth={false}
      size="small"
    />
  );
};

export default ProjectOrgSurfacePillSwitch;
