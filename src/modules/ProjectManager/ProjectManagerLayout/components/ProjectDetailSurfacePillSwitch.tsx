import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import TabPill from "@src/components/TabPill";
import type { TabPillItem } from "@src/components/TabPill";
import {
  PROJECT_DETAIL_SURFACE_VIEW,
  type ProjectDetailSurfaceView,
} from "@src/store/workstation/tabs";

export interface ProjectDetailSurfacePillSwitchProps {
  projectView: ProjectDetailSurfaceView;
  onProjectViewChange: (view: ProjectDetailSurfaceView) => void;
}

export const ProjectDetailSurfacePillSwitch: React.FC<
  ProjectDetailSurfacePillSwitchProps
> = ({ projectView, onProjectViewChange }) => {
  const { t } = useTranslation("projects");

  const surfaceTabs = useMemo<TabPillItem[]>(
    () => [
      {
        key: PROJECT_DETAIL_SURFACE_VIEW.OVERVIEW,
        label: t("workItems.tabs.overview"),
      },
      {
        key: PROJECT_DETAIL_SURFACE_VIEW.WORK_ITEMS,
        label: t("workspace.workItems"),
      },
    ],
    [t]
  );

  return (
    <TabPill
      tabs={surfaceTabs}
      activeTab={projectView}
      onChange={(key) => onProjectViewChange(key as ProjectDetailSurfaceView)}
      variant="pill"
      color="fill"
      fillWidth={false}
      size="small"
    />
  );
};

export default ProjectDetailSurfacePillSwitch;
