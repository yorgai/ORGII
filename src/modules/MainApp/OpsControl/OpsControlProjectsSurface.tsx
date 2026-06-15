import { useSetAtom } from "jotai";
import React, { Suspense, memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  PROJECT_ORG_SYNC_PROVIDER,
  type ProjectOrg,
} from "@src/api/http/project";
import {
  WIZARD_IDS,
  buildIntegrationsPath,
  buildWizardPath,
} from "@src/config/mainAppPaths";
import LinearProjectsPage from "@src/modules/ProjectManager/LinearProjects";
import ProjectManagerSidebar from "@src/modules/ProjectManager/Panels/ProjectManagerSidebar";
import type { LinearProjectSelection } from "@src/modules/ProjectManager/Panels/ProjectManagerSidebar/content/WorkspaceTreeContent";
import { STORY_MANAGER_SUSPENSE_LOADING_FALLBACK } from "@src/modules/ProjectManager/ProjectManagerLayout/components/ProjectManagerContentRouter";
import ProjectOrgHubContent from "@src/modules/ProjectManager/ProjectManagerLayout/components/ProjectOrgHubContent";
import { ProjectWorkItemsTabContent } from "@src/modules/ProjectManager/ProjectManagerLayout/components/ProjectWorkItemsTabContent";
import { RepoSettingsTabContent } from "@src/modules/ProjectManager/ProjectManagerLayout/components/RepoSettingsTabContent";
import type { ActiveRepoView } from "@src/modules/ProjectManager/ProjectManagerLayout/types";
import ProjectsPage from "@src/modules/ProjectManager/Projects";
import WorkItemsPage from "@src/modules/ProjectManager/WorkItems";
import {
  WorkStationShell,
  buildPrimarySidebarConfig,
} from "@src/modules/WorkStation/shared";
import ProjectStatusBar from "@src/modules/WorkStation/shared/StatusBar/ProjectStatusBar";
import { projectListRefreshAtom } from "@src/store/project/projectAtom";
import {
  CHAT_PANEL_SURFACE_KIND,
  activeStationChatVisibleAtom,
  chatPanelNavigateAtom,
} from "@src/store/ui/chatPanelAtom";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  PROJECT_ORG_SURFACE_VIEW,
  STORY_ORG_SCOPE,
  STORY_PERSONAL_ORG_FILTER_ID,
  STORY_PERSONAL_ORG_NAME,
} from "@src/store/workstation/tabs";
import type {
  ProjectOrgScope,
  ProjectOrgSurfaceView,
} from "@src/store/workstation/tabs";

interface SelectedProjectView {
  kind: "project";
  projectId: string;
  projectName: string;
  projectSlug?: string;
}

interface RepoView {
  kind: "repo";
  view: Exclude<ActiveRepoView, null>;
  orgScope?: string;
  orgId?: string;
  orgName?: string;
  orgSyncProvider?: string | null;
  linearSelection?: LinearProjectSelection;
}

interface OrgHubView {
  kind: "org-hub";
  orgScope: ProjectOrgScope;
  orgId: string;
  orgName?: string;
  orgSyncProvider?: string | null;
  orgView: ProjectOrgSurfaceView;
}

type ProjectsSurfaceView = SelectedProjectView | RepoView | OrgHubView;

interface OpsControlProjectsSurfaceProps {
  repoPath: string;
  repoName: string;
  primarySidebarCollapsed: boolean;
  primarySidebarWidth: number;
  setPrimarySidebarWidth: (size: number) => void;
  closePrimarySidebar: () => void;
}

function isRepoView(view: ProjectsSurfaceView): view is RepoView {
  return view.kind === "repo";
}

const OpsControlProjectsSurface: React.FC<OpsControlProjectsSurfaceProps> =
  memo(
    ({
      repoPath,
      repoName,
      primarySidebarCollapsed,
      primarySidebarWidth,
      setPrimarySidebarWidth,
      closePrimarySidebar,
    }) => {
      const { t } = useTranslation("projects");
      const navigate = useNavigate();
      const [view, setView] = useState<ProjectsSurfaceView>({
        kind: "repo",
        view: "projects",
      });
      const [selectedProjectSlug, setSelectedProjectSlug] = useState<
        string | undefined
      >(undefined);
      const bumpProjectListRefresh = useSetAtom(projectListRefreshAtom);

      const setStationMode = useSetAtom(stationModeAtom);
      const setStationChatVisible = useSetAtom(activeStationChatVisibleAtom);
      const navigateChatPanel = useSetAtom(chatPanelNavigateAtom);

      const selectedProjectId = view.kind === "project" ? view.projectId : null;
      const activeRepoView =
        view.kind === "repo"
          ? view.view
          : view.kind === "org-hub"
            ? view.orgView === PROJECT_ORG_SURFACE_VIEW.PROJECTS
              ? "projects"
              : view.orgView === PROJECT_ORG_SURFACE_VIEW.WORK_ITEMS
                ? "work-items"
                : view.orgView === PROJECT_ORG_SURFACE_VIEW.SETTINGS
                  ? "settings"
                  : null
            : null;
      const activeOrgScope =
        view.kind === "repo"
          ? (view.orgScope ?? STORY_ORG_SCOPE.ALL)
          : view.kind === "org-hub"
            ? view.orgScope
            : null;
      const activeOrgHubId =
        view.kind === "org-hub"
          ? view.orgId
          : isRepoView(view)
            ? (view.orgId ?? null)
            : null;
      const scopedOrgId =
        activeOrgScope === STORY_ORG_SCOPE.ALL
          ? undefined
          : (activeOrgHubId ?? undefined);
      const activeLinearConnectionId =
        isRepoView(view) &&
        (view.view === "linear-projects" || view.view === "linear-work-items")
          ? (view.linearSelection?.connectionId ?? null)
          : null;
      const activeLinearProjectId =
        isRepoView(view) &&
        (view.view === "linear-projects" || view.view === "linear-work-items")
          ? (view.linearSelection?.projectId ?? null)
          : null;
      const activeLinearTeamId =
        isRepoView(view) &&
        (view.view === "linear-projects" || view.view === "linear-work-items")
          ? (view.linearSelection?.teamId ?? null)
          : null;

      const handleSelectProject = useCallback(
        (projectId: string, projectName: string, projectSlug?: string) => {
          setSelectedProjectSlug(projectSlug);
          setView({ kind: "project", projectId, projectName, projectSlug });
        },
        []
      );

      const handleOpenProjects = useCallback(() => {
        setView({
          kind: "repo",
          view: "projects",
          orgScope: STORY_ORG_SCOPE.ALL,
        });
      }, []);

      const handleOpenWorkItems = useCallback(() => {
        setView({
          kind: "repo",
          view: "work-items",
          orgScope: STORY_ORG_SCOPE.ALL,
        });
      }, []);

      const handleOpenPersonalOrg = useCallback(
        (
          orgView: ProjectOrgSurfaceView = PROJECT_ORG_SURFACE_VIEW.WORK_ITEMS
        ) => {
          setView({
            kind: "org-hub",
            orgScope: STORY_ORG_SCOPE.PERSONAL_ORG,
            orgId: STORY_PERSONAL_ORG_FILTER_ID,
            orgName: STORY_PERSONAL_ORG_NAME,
            orgView,
          });
        },
        []
      );

      const handleOpenProjectOrg = useCallback(
        (
          org: ProjectOrg,
          orgView: ProjectOrgSurfaceView = PROJECT_ORG_SURFACE_VIEW.WORK_ITEMS
        ) => {
          setView({
            kind: "org-hub",
            orgScope: STORY_ORG_SCOPE.PROJECT_ORG,
            orgId: org.id,
            orgName: org.name,
            orgSyncProvider: org.sync_provider,
            orgView,
          });
        },
        []
      );

      const handleOpenLinearProjects = useCallback(
        (selection?: LinearProjectSelection) => {
          setView({
            kind: "repo",
            view: "linear-projects",
            linearSelection: selection,
          });
        },
        []
      );

      const handleOpenLinearWorkItems = useCallback(
        (selection?: LinearProjectSelection) => {
          setView({
            kind: "repo",
            view: "linear-work-items",
            linearSelection: selection,
          });
        },
        []
      );

      const handleOpenSettings = useCallback(() => {
        setView({ kind: "repo", view: "settings" });
      }, []);

      const handleImportOrgs = useCallback(() => {
        navigate(
          buildWizardPath(
            buildIntegrationsPath({ category: "connections" }),
            WIZARD_IDS.CHANNEL_ADD
          )
        );
      }, [navigate]);

      const handleProjectDeleted = useCallback(() => {
        setView({ kind: "repo", view: "projects" });
        bumpProjectListRefresh((previous) => previous + 1);
      }, [bumpProjectListRefresh]);

      const activeProjectOrg = useMemo(() => {
        if (view.kind === "org-hub") {
          return {
            orgId: view.orgId,
            orgName: view.orgName,
          };
        }
        return undefined;
      }, [view]);

      const handleCreateProject = useCallback(() => {
        navigateChatPanel({
          kind: CHAT_PANEL_SURFACE_KIND.NEW_PROJECT,
          createProjectContext: {
            orgId: activeProjectOrg?.orgId ?? STORY_PERSONAL_ORG_FILTER_ID,
            scopeBreadcrumbLabel:
              activeProjectOrg?.orgName ?? t("orgs.personalOrg"),
          },
        });
        setStationMode("my-station");
        setStationChatVisible("my-station", true);
      }, [
        activeProjectOrg,
        navigateChatPanel,
        setStationChatVisible,
        setStationMode,
        t,
      ]);

      const handleCreateWorkItem = useCallback(() => {
        navigateChatPanel({ kind: CHAT_PANEL_SURFACE_KIND.NEW_WORK_ITEM });
        setStationMode("my-station");
        setStationChatVisible("my-station", true);
      }, [navigateChatPanel, setStationChatVisible, setStationMode]);

      const handleCreateOrg = useCallback(() => {
        navigateChatPanel({ kind: CHAT_PANEL_SURFACE_KIND.NEW_COLLAB_ORG });
        setStationMode("my-station");
        setStationChatVisible("my-station", true);
      }, [navigateChatPanel, setStationChatVisible, setStationMode]);

      const primarySidebarConfig = useMemo(
        () =>
          buildPrimarySidebarConfig({
            content: (
              <ProjectManagerSidebar
                repoPath={repoPath}
                repoName={repoName}
                selectedProjectId={selectedProjectId}
                onSelectProject={handleSelectProject}
                onCreateProject={handleCreateProject}
                onCreateWorkItem={handleCreateWorkItem}
                onCreateOrg={handleCreateOrg}
                onImportOrgs={handleImportOrgs}
                onOpenProjects={handleOpenProjects}
                onOpenWorkItems={handleOpenWorkItems}
                onOpenPersonalOrg={handleOpenPersonalOrg}
                onOpenProjectOrg={handleOpenProjectOrg}
                onOpenLinearProjects={handleOpenLinearProjects}
                onOpenLinearWorkItems={handleOpenLinearWorkItems}
                onOpenSettings={handleOpenSettings}
                activeRepoView={activeRepoView}
                activeOrgScope={activeOrgScope}
                activeOrgHubId={activeOrgHubId}
                activeLinearConnectionId={activeLinearConnectionId}
                activeLinearProjectId={activeLinearProjectId}
                activeLinearTeamId={activeLinearTeamId}
              />
            ),
            collapsed: primarySidebarCollapsed,
            size: primarySidebarWidth,
            onSizeChange: setPrimarySidebarWidth,
            onClose: closePrimarySidebar,
          }),
        [
          activeLinearConnectionId,
          activeLinearProjectId,
          activeLinearTeamId,
          activeOrgHubId,
          activeOrgScope,
          activeRepoView,
          closePrimarySidebar,
          handleCreateOrg,
          handleCreateProject,
          handleCreateWorkItem,
          handleOpenProjects,
          handleOpenWorkItems,
          handleOpenPersonalOrg,
          handleOpenProjectOrg,
          handleOpenLinearProjects,
          handleOpenLinearWorkItems,
          handleOpenSettings,
          handleImportOrgs,
          handleSelectProject,
          primarySidebarCollapsed,
          primarySidebarWidth,
          repoName,
          repoPath,
          selectedProjectId,
          setPrimarySidebarWidth,
        ]
      );

      const content = useMemo(() => {
        if (view.kind === "org-hub") {
          return (
            <ProjectOrgHubContent
              orgId={view.orgId}
              orgScope={view.orgScope}
              orgView={view.orgView}
              workStationTabId="ops-control-projects"
              onOrgViewChange={(orgView) => {
                setView({ ...view, orgView });
              }}
              onSelectProject={handleSelectProject}
              onCreateProject={handleCreateProject}
              onCreateWorkItem={handleCreateWorkItem}
              onExpandWorkItemToTab={(
                projectId,
                projectName,
                projectSlug,
                _workItemId,
                _workItemName
              ) => {
                if (!projectId || !projectName) return;
                handleSelectProject(projectId, projectName, projectSlug);
              }}
              onOpenLinearProjects={handleOpenLinearProjects}
            />
          );
        }

        if (view.kind === "project") {
          return (
            <WorkItemsPage
              projectId={view.projectId}
              projectName={view.projectName}
              cachedProjectSlug={selectedProjectSlug ?? view.projectSlug}
              isActive
              workStationTabId="ops-control-projects"
              workstationHeaderHost="opsControl"
              onProjectSlugResolved={setSelectedProjectSlug}
              onOpenProjects={handleOpenProjects}
              onCreateProject={handleCreateProject}
              onCreateWorkItem={handleCreateWorkItem}
              onProjectDeleted={handleProjectDeleted}
              onOpenRepoSettings={handleOpenSettings}
            />
          );
        }

        switch (view.view) {
          case "projects":
            return (
              <ProjectsPage
                onOpenProject={handleSelectProject}
                orgId={scopedOrgId}
                onAddProject={handleCreateProject}
                onOpenLinearProject={handleOpenLinearProjects}
                allowExternalSources={activeOrgScope === STORY_ORG_SCOPE.ALL}
                publishToWorkstationHeader
                workStationTabId="ops-control-projects"
                workstationHeaderHost="opsControl"
              />
            );
          case "work-items":
            return (
              <ProjectWorkItemsTabContent
                workStationTabId="ops-control-projects"
                workstationHeaderHost="opsControl"
                orgId={scopedOrgId}
                onCreateProject={handleCreateProject}
                onCreateWorkItem={handleCreateWorkItem}
                onOpenLinearProject={handleOpenLinearProjects}
                allowExternalSources={activeOrgScope === STORY_ORG_SCOPE.ALL}
                onOpenWorkItem={(projectId, projectName, projectSlug) => {
                  if (!projectId || !projectName) return;
                  handleSelectProject(projectId, projectName, projectSlug);
                }}
              />
            );
          case "linear-projects":
          case "linear-work-items":
            return (
              <LinearProjectsPage
                surface={
                  view.view === "linear-work-items" ? "work-items" : "projects"
                }
                connectionId={view.linearSelection?.connectionId}
                projectId={view.linearSelection?.projectId}
                projectName={view.linearSelection?.projectName}
                teamId={view.linearSelection?.teamId}
                teamName={view.linearSelection?.teamName}
                workStationTabId="ops-control-projects"
                workstationHeaderHost="opsControl"
                isActive
                onOpenLinearProject={(selection) => {
                  if (view.view === "linear-work-items") {
                    handleOpenLinearWorkItems(selection);
                    return;
                  }
                  handleOpenLinearProjects(selection);
                }}
              />
            );
          case "settings":
            return <RepoSettingsTabContent />;
          default:
            return null;
        }
      }, [
        handleOpenLinearProjects,
        handleOpenLinearWorkItems,
        handleOpenSettings,
        handleOpenProjects,
        handleSelectProject,
        handleProjectDeleted,
        handleCreateProject,
        handleCreateWorkItem,
        selectedProjectSlug,
        activeOrgScope,
        scopedOrgId,
        view,
      ]);

      const activeProjectOrgId =
        view.kind === "org-hub" && view.orgScope === STORY_ORG_SCOPE.PROJECT_ORG
          ? view.orgId
          : undefined;
      const activeProjectOrgName =
        view.kind === "org-hub" &&
        view.orgScope === STORY_ORG_SCOPE.PROJECT_ORG &&
        view.orgName
          ? view.orgName
          : undefined;
      const activeProjectOrgGitFolderSyncEnabled =
        view.kind === "org-hub" &&
        view.orgScope === STORY_ORG_SCOPE.PROJECT_ORG &&
        view.orgSyncProvider === PROJECT_ORG_SYNC_PROVIDER.GIT_FOLDER;

      return (
        <WorkStationShell
          primarySidebarConfig={primarySidebarConfig}
          content={
            <div className="ops-control-page flex h-full min-h-0 w-full flex-col overflow-hidden">
              <Suspense fallback={STORY_MANAGER_SUSPENSE_LOADING_FALLBACK}>
                {content}
              </Suspense>
            </div>
          }
          statusBar={
            <ProjectStatusBar
              projectSlug={
                view.kind === "project" ? view.projectSlug : undefined
              }
              projectOrgId={activeProjectOrgId}
              projectOrgName={activeProjectOrgName}
              projectOrgGitFolderSyncEnabled={
                activeProjectOrgGitFolderSyncEnabled
              }
            />
          }
          appClassName="ops-control-workstation"
        />
      );
    }
  );

OpsControlProjectsSurface.displayName = "OpsControlProjectsSurface";

export default OpsControlProjectsSurface;
