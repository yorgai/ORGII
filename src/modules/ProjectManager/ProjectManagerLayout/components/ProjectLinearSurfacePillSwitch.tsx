import React, { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import TabPill from "@src/components/TabPill";
import type { TabPillItem } from "@src/components/TabPill";
import {
  PROJECT_LINEAR_SURFACE_VIEW,
  type ProjectLinearSurfaceView,
} from "@src/store/workstation/tabs";

export interface ProjectLinearSurfacePillSwitchProps {
  linearSurface: ProjectLinearSurfaceView;
  onLinearSurfaceChange: (surface: ProjectLinearSurfaceView) => void;
}

export const ProjectLinearSurfacePillSwitch: React.FC<ProjectLinearSurfacePillSwitchProps> =
  memo(({ linearSurface, onLinearSurfaceChange }) => {
    const { t } = useTranslation("projects");

    const surfaceTabs = useMemo<TabPillItem[]>(
      () => [
        {
          key: PROJECT_LINEAR_SURFACE_VIEW.PROJECTS,
          label: t("workspace.projects"),
        },
        {
          key: PROJECT_LINEAR_SURFACE_VIEW.WORK_ITEMS,
          label: t("workspace.workItems"),
        },
      ],
      [t]
    );

    const handleChange = useCallback(
      (key: string) => {
        onLinearSurfaceChange(key as ProjectLinearSurfaceView);
      },
      [onLinearSurfaceChange]
    );

    return (
      <TabPill
        tabs={surfaceTabs}
        activeTab={linearSurface}
        onChange={handleChange}
        variant="pill"
        color="fill"
        fillWidth={false}
        size="small"
      />
    );
  });

ProjectLinearSurfacePillSwitch.displayName = "ProjectLinearSurfacePillSwitch";

export default ProjectLinearSurfacePillSwitch;
