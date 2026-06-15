import { useSetAtom } from "jotai";
import React, { useCallback, useState } from "react";

import {
  projectApi,
  projectDataToUI,
  workItemDataToUI,
} from "@src/api/http/project";
import { createLogger } from "@src/hooks/logger";
import { ProjectOrgHubContent } from "@src/modules/ProjectManager/ProjectManagerLayout/components/ProjectOrgHubContent";
import {
  CHAT_PANEL_SURFACE_KIND,
  type ChatPanelSelectedProjectOrg,
  chatPanelNavigateAtom,
  chatPanelSelectedWorkItemAtom,
} from "@src/store/ui/chatPanelAtom";
import {
  PROJECT_ORG_SURFACE_VIEW,
  type ProjectOrgSurfaceView,
} from "@src/store/workstation/tabs";

const logger = createLogger("ProjectOrgPanelView");

interface ProjectOrgPanelViewProps {
  selectedProjectOrg: ChatPanelSelectedProjectOrg;
}

export const ProjectOrgPanelView: React.FC<ProjectOrgPanelViewProps> = ({
  selectedProjectOrg,
}) => {
  const navigateChatPanel = useSetAtom(chatPanelNavigateAtom);
  const setSelectedWorkItem = useSetAtom(chatPanelSelectedWorkItemAtom);
  const [orgView, setOrgView] = useState<ProjectOrgSurfaceView>(
    PROJECT_ORG_SURFACE_VIEW.WORK_ITEMS
  );

  const handleSelectProject = useCallback(
    async (projectId: string, projectName: string, projectSlug?: string) => {
      if (!projectSlug) return;

      try {
        const projectData = await projectApi.readProject(projectSlug);
        navigateChatPanel({
          kind: CHAT_PANEL_SURFACE_KIND.PROJECT,
          project: {
            project: projectDataToUI(projectData, {
              labelMap: new Map(),
              memberMap: new Map(),
            }),
            projectSlug,
            orgId: selectedProjectOrg.orgId,
            orgName: selectedProjectOrg.orgName,
          },
        });
      } catch (error) {
        logger.error("failed to open project from org page", error, {
          projectId,
          projectName,
          projectSlug,
        });
      }
    },
    [navigateChatPanel, selectedProjectOrg.orgId, selectedProjectOrg.orgName]
  );

  const handleCreateProject = useCallback(() => {
    navigateChatPanel({
      kind: CHAT_PANEL_SURFACE_KIND.NEW_PROJECT,
      createProjectContext: {
        orgId: selectedProjectOrg.orgId,
        scopeBreadcrumbLabel: selectedProjectOrg.orgName,
      },
    });
  }, [navigateChatPanel, selectedProjectOrg.orgId, selectedProjectOrg.orgName]);

  const handleCreateWorkItem = useCallback(() => {
    navigateChatPanel({
      kind: CHAT_PANEL_SURFACE_KIND.NEW_WORK_ITEM,
      createProjectContext: {
        orgId: selectedProjectOrg.orgId,
        scopeBreadcrumbLabel: selectedProjectOrg.orgName,
      },
    });
  }, [navigateChatPanel, selectedProjectOrg.orgId, selectedProjectOrg.orgName]);

  const handleExpandWorkItemToTab = useCallback(
    async (
      projectId: string | undefined,
      projectName: string | undefined,
      projectSlug: string | undefined,
      workItemId: string,
      workItemName: string
    ) => {
      if (!projectId || !projectName || !projectSlug) return;

      try {
        const workItemData = await projectApi.readWorkItem(
          projectSlug,
          workItemId,
          { orgId: selectedProjectOrg.orgId }
        );
        setSelectedWorkItem({
          workItem: workItemDataToUI(workItemData, {
            labelMap: new Map(),
            memberMap: new Map(),
            projectNameMap: new Map([[projectId, projectName]]),
          }),
          projectId,
          projectName,
          projectSlug,
          shortId: workItemId,
          orgId: selectedProjectOrg.orgId,
          orgName: selectedProjectOrg.orgName,
        });
      } catch (error) {
        logger.error("failed to open work item from org page", error, {
          projectId,
          projectName,
          projectSlug,
          workItemId,
          workItemName,
        });
      }
    },
    [selectedProjectOrg.orgId, selectedProjectOrg.orgName, setSelectedWorkItem]
  );

  return (
    <ProjectOrgHubContent
      orgId={selectedProjectOrg.orgId}
      orgScope={selectedProjectOrg.orgScope}
      orgView={orgView}
      breadcrumbSegments={[{ label: selectedProjectOrg.orgName }]}
      workStationTabId={`chat-panel-project-org:${selectedProjectOrg.orgId}`}
      onOrgViewChange={setOrgView}
      onSelectProject={handleSelectProject}
      onCreateProject={handleCreateProject}
      onCreateWorkItem={handleCreateWorkItem}
      onExpandWorkItemToTab={handleExpandWorkItemToTab}
    />
  );
};

export default ProjectOrgPanelView;
