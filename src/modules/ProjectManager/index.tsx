/**
 * ProjectManagerPage - Top-level page for the Project Manager view mode.
 *
 * Mounted persistently by modules/index.tsx (same pattern as WorkStationPage).
 * Visibility is controlled via CSS, not mounting/unmounting.
 */
import React from "react";

import ProjectManagerShell from "@src/modules/ProjectManager/ProjectManagerShell";

export interface ProjectManagerPageProps {
  isActive?: boolean;
  isFullMode?: boolean;
}

const ProjectManagerPage: React.FC<ProjectManagerPageProps> = ({
  isActive = true,
  isFullMode = false,
}) => {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <ProjectManagerShell isActive={isActive} isFullMode={isFullMode} />
    </div>
  );
};

export default ProjectManagerPage;
