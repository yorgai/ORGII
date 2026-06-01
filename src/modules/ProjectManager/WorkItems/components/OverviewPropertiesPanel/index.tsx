import React from "react";
import { useTranslation } from "react-i18next";

import {
  type LinkedRepoOption,
  type ProjectData,
  ProjectPropertyFields,
  PropertiesPanel,
  PropertiesRailFrame,
} from "@src/modules/ProjectManager/shared";
import type { Label, Person, Team } from "@src/types/core/shared";

interface OverviewPropertiesPanelProps {
  project: ProjectData;
  onUpdate: (updates: Partial<ProjectData>) => void;
  availableMembers: Person[];
  availableTeams: Team[];
  availableLabels: Label[];
  availableRepos: LinkedRepoOption[];
}

const OverviewPropertiesPanel: React.FC<OverviewPropertiesPanelProps> = ({
  project,
  onUpdate,
  availableMembers,
  availableTeams,
  availableLabels,
  availableRepos,
}) => {
  const { t } = useTranslation("projects");
  const projectPropsRef = React.useRef<HTMLElement>(null);

  return (
    <PropertiesRailFrame width={280} minWidth={250} maxWidth={300}>
      <PropertiesPanel
        title={t("properties.projectProperties")}
        containerRef={projectPropsRef}
      >
        <ProjectPropertyFields
          project={project}
          onUpdate={onUpdate}
          availableMembers={availableMembers}
          availableTeams={availableTeams}
          availableLabels={availableLabels}
          availableRepos={availableRepos}
          containerRef={projectPropsRef}
        />
      </PropertiesPanel>
    </PropertiesRailFrame>
  );
};

export default OverviewPropertiesPanel;
