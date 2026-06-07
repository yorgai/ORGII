import { RenameModal } from "@/src/scaffold/ModalSystem/variants";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Search } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { ROUTES } from "@src/config/routes";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { useKeyVault } from "@src/hooks/keyVault";
import { useAppNavigation } from "@src/hooks/navigation/useAppNavigation";
import { useSessionView } from "@src/hooks/ui/tabs/useSessionView";
import { useLaunchpadAgentCatalog } from "@src/modules/WorkStation/Launchpad/hooks/useLaunchpadAgentCatalog";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import { benchmarkAgentBatchStatusAtom } from "@src/store/benchmark";
import { repoMapAtom, reposAtom } from "@src/store/repo";
import {
  activeSessionCreatorDraftIdAtom,
  deleteSessionCreatorDraftAtom,
  loadSidebarSessions,
  markAllSessionsVisited,
  promoteActiveSessionCreatorDraftAtom,
  sessionCreatorDraftListAtom,
  sessionLoadingAtom,
  sessionsAtom,
  visitedSessionsAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session";
import {
  activeStationChatVisibleAtom,
  chatPanelContentModeAtom,
  chatPanelCreateProjectContextAtom,
  chatPanelCreateTargetAtom,
  chatPanelSelectedProjectAtom,
  chatPanelSelectedWorkItemAtom,
  chatPanelSelectedWorkspaceAtom,
  chatPanelStickyNotesOpenAtom,
  chatPanelWorkspaceDashboardOpenAtom,
} from "@src/store/ui/chatPanelAtom";
import { type StationMode, stationModeAtom } from "@src/store/ui/simulatorAtom";
import { spotlightOpenAtom } from "@src/store/ui/uiAtom";
import {
  activeWorkspaceNameAtom,
  savedWorkspacesAtom,
  setWorkspaceFoldersAtom,
} from "@src/store/workspace";
import {
  opsControlFocusedTabAtom,
  opsControlPeekHostAtom,
} from "@src/store/workstation";

import { SidebarBottomBar } from "../../blocks";
import NavigationSidebar from "../../variants/NavigationSidebar";
import { STICKY_NOTES_MENU_ITEM_ID } from "../sidebarConnectorUtils";
import {
  projectsSidebarGroupByAtom,
  sidebarGroupByAtom,
} from "../sidebarGroupByAtom";
import {
  isProjectsLinearOrgGroupId,
  useProjectsWorkItemMenuItems,
} from "../useProjectsWorkItemMenuItems";
import { useRenameSessionModal } from "../useRenameSessionModal";
import { useSessionMenuItems } from "../useSessionMenuItems";
import { useWorkstationSidebarContextMenu } from "../useWorkstationSidebarContextMenu";
import { useWorkstationSidebarHandlers } from "../useWorkstationSidebarHandlers";
import {
  DEFAULT_COLLAPSED_SECTION_IDS,
  buildRepoPathToName,
  getAllSectionIds,
  sortSessionsByActivity,
} from "../workstationSidebarData";
import { useSidebarBottomRightActions } from "./bottomActions";
import { buildWorkspaceRepoNameResolver } from "./foldersSidebarMenuItems";
import {
  useRenderProjectsMenuItemWrapper,
  useRenderSessionMenuItemWrapper,
} from "./menuItemWrappers";
import { resolveSelectedMenuItemIds } from "./menuSelection";
import { useSessionEntryActions } from "./sessionEntryActions";
import { useDecorateSessionRowActions } from "./sessionRowActions";
import { useWorkstationSidebarMemory } from "./sidebarMemory";
import {
  useFoldersSidebarMenuItems,
  usePinnedMenuItems,
  useSessionSidebarMenuItems,
} from "./sidebarMenuCollections";
import { useSidebarSessionRefreshEffects } from "./sidebarSessionRefresh";
import {
  HomeHeaderAction,
  SidebarSearchShortcutTooltip,
  isWorkstationSidebarKey,
  useWorkstationSidebarTabs,
} from "./sidebarTabs";
import type { WorkstationSidebarKey } from "./types";
import { useFoldersMenuItemClick } from "./useFoldersMenuItemClick";
import { useProjectsMenuItemClick } from "./useProjectsMenuItemClick";

export const WorkstationSidebarConnector: React.FC = () => {
  const { t } = useTranslation("navigation");
  const { t: tProjects } = useTranslation("projects");
  const { t: tCommonRaw } = useTranslation();
  const tCommon = useCallback(
    (key: string, defaultValue?: string) => tCommonRaw(key, { defaultValue }),
    [tCommonRaw]
  );
  const location = useLocation();
  const navigate = useNavigate();
  const sessions = useAtomValue(sessionsAtom);
  const sessionsLoading = useAtomValue(sessionLoadingAtom);
  const visitedSessions = useAtomValue(visitedSessionsAtom);
  const sessionCreatorDrafts = useAtomValue(sessionCreatorDraftListAtom);
  const activeSessionCreatorDraftId = useAtomValue(
    activeSessionCreatorDraftIdAtom
  );
  const promoteActiveSessionCreatorDraft = useSetAtom(
    promoteActiveSessionCreatorDraftAtom
  );
  const deleteSessionCreatorDraft = useSetAtom(deleteSessionCreatorDraftAtom);
  const setSpotlightOpen = useSetAtom(spotlightOpenAtom);
  const chatPanelContentMode = useAtomValue(chatPanelContentModeAtom);
  const chatPanelCreateTarget = useAtomValue(chatPanelCreateTargetAtom);
  const chatPanelSelectedWorkItem = useAtomValue(chatPanelSelectedWorkItemAtom);
  const chatPanelSelectedProject = useAtomValue(chatPanelSelectedProjectAtom);
  const chatPanelSelectedWorkspace = useAtomValue(
    chatPanelSelectedWorkspaceAtom
  );
  const chatPanelStickyNotesOpen = useAtomValue(chatPanelStickyNotesOpenAtom);
  const setChatPanelContentMode = useSetAtom(chatPanelContentModeAtom);
  const setChatPanelCreateProjectContext = useSetAtom(
    chatPanelCreateProjectContextAtom
  );
  const setChatPanelCreateTarget = useSetAtom(chatPanelCreateTargetAtom);
  const setChatPanelWorkspaceDashboardOpen = useSetAtom(
    chatPanelWorkspaceDashboardOpenAtom
  );
  const setChatPanelSelectedProject = useSetAtom(chatPanelSelectedProjectAtom);
  const setChatPanelSelectedWorkItem = useSetAtom(
    chatPanelSelectedWorkItemAtom
  );
  const setChatPanelSelectedWorkspace = useSetAtom(
    chatPanelSelectedWorkspaceAtom
  );
  const setChatPanelStickyNotesOpen = useSetAtom(chatPanelStickyNotesOpenAtom);
  const setStationChatVisible = useSetAtom(activeStationChatVisibleAtom);
  const setStationMode = useSetAtom(stationModeAtom);
  const setOpsControlPeekHost = useSetAtom(opsControlPeekHostAtom);
  const setOpsControlFocusedTab = useSetAtom(opsControlFocusedTabAtom);
  const { openSession } = useSessionView();
  const { goToStartPage, goToNewSession, navigateTo } = useAppNavigation();
  const [activeSidebarKey, setActiveSidebarKey] =
    useState<WorkstationSidebarKey>("workstation");
  const [activeSessionMoreMenuId, setActiveSessionMoreMenuId] = useState("");
  const [projectsSelectedMenuItemId, setProjectsSelectedMenuItemId] =
    useState("");
  const [foldersDashboardSelected, setFoldersDashboardSelected] =
    useState(false);
  const tabs = useWorkstationSidebarTabs(t);

  const handleTabChange = useCallback((key: string) => {
    if (!isWorkstationSidebarKey(key)) return;
    if (key !== "folders") setFoldersDashboardSelected(false);
    setActiveSidebarKey(key);
  }, []);

  useSidebarSessionRefreshEffects();

  const sortedSessions = useMemo(
    () => sortSessionsByActivity(sessions),
    [sessions]
  );
  const repoMap = useAtomValue(repoMapAtom);
  const repos = useAtomValue(reposAtom);
  const savedWorkspaces = useAtomValue(savedWorkspacesAtom);
  const dispatchSetWorkspaceFolders = useSetAtom(setWorkspaceFoldersAtom);
  const setActiveWorkspaceName = useSetAtom(activeWorkspaceNameAtom);
  const { localAccounts } = useKeyVault({ autoLoad: true });
  const { installedCliAgents, builtInRustAgents, customRustAgents } =
    useLaunchpadAgentCatalog();
  const { selectRepo } = useRepoSelection({ autoLoad: false });
  const repoPathToName = useMemo(() => buildRepoPathToName(repoMap), [repoMap]);
  const resolveWorkspaceRepoName = useMemo(
    () => buildWorkspaceRepoNameResolver(repos),
    [repos]
  );

  const [groupByMode, setGroupByMode] = useAtom(sidebarGroupByAtom);
  const [projectsGroupByMode, setProjectsGroupByMode] = useAtom(
    projectsSidebarGroupByAtom
  );
  const [groupVisibleCounts, setGroupVisibleCounts] = useState<
    Map<string, number>
  >(new Map());
  const [projectsGroupVisibleCounts, setProjectsGroupVisibleCounts] = useState<
    Map<string, number>
  >(new Map());
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(
    () => new Set(DEFAULT_COLLAPSED_SECTION_IDS)
  );
  const [foldersCollapsedSectionIds, setFoldersCollapsedSectionIds] = useState<
    Set<string>
  >(() => new Set());
  const [projectsCollapsedSectionIds, setProjectsCollapsedSectionIds] =
    useState<Set<string>>(() => new Set());
  const defaultedProjectsLinearSectionIdsRef = useRef<Set<string>>(new Set());

  const untitledSession = t("sidebar.defaults.untitledSession");
  const newSessionLabel = t("labels.newSession");
  const pinFolderLabel = tCommon("sessions:chat.pinSession", "Pin");
  const unpinFolderLabel = tCommon("sessions:chat.unpinSession", "Unpin");
  const createProjectLabel = tProjects("projects.createProject");
  const createWorkItemLabel = tProjects("workItems.createWorkItem");
  const homeLabel = t("sidebar.tabs.build");
  const stickyNotesLabel = t("stickyNotes.sidebarButton");

  const { menuItems, sessionMap, isLoadMoreId, getLoadMoreGroupId } =
    useSessionMenuItems({
      sortedSessions,
      visitedSessions,
      repoPathToName,
      groupByMode,
      untitledSession,
      groupVisibleCounts,
    });
  const {
    menuItems: projectsWorkItemMenuItems,
    projectMap: projectsProjectMap,
    workItemMap: projectsWorkItemMap,
    linearWorkItemMap: projectsLinearWorkItemMap,
    loading: projectsWorkItemsLoading,
    getLoadMoreGroupId: getProjectsLoadMoreGroupId,
    loadLinearOrgWorkItems: loadProjectsLinearOrgWorkItems,
    toChatPanelProject,
    toChatPanelWorkItem,
    openLinearWorkItem: openProjectsLinearWorkItem,
  } = useProjectsWorkItemMenuItems({
    enabled: activeSidebarKey === "projects",
    groupByMode: projectsGroupByMode,
    groupVisibleCounts: projectsGroupVisibleCounts,
  });

  const rename = useRenameSessionModal();
  const activeSessionId = useAtomValue(workstationActiveSessionIdAtom) ?? "";
  const benchmarkBatchStatus = useAtomValue(benchmarkAgentBatchStatusAtom);
  const highlightedSessionId = benchmarkBatchStatus?.items.some(
    (item) => item.sessionId === activeSessionId
  )
    ? benchmarkBatchStatus.masterSessionId
    : activeSessionId;

  const { pinnedMenuItems } = usePinnedMenuItems({
    activeSidebarKey,
    createProjectLabel,
    createWorkItemLabel,
    newSessionLabel,
    stickyNotesLabel,
    t,
    tCommon,
  });
  const sessionSidebarMenuItems = useSessionSidebarMenuItems({
    menuItems,
    sessionCreatorDrafts,
    t,
  });
  const foldersSidebarMenuItems = useFoldersSidebarMenuItems({
    savedWorkspaces,
    repos,
    localAccounts,
    installedCliAgents,
    builtInRustAgents,
    customRustAgents,
    t,
  });
  const projectsSidebarMenuItems = projectsWorkItemMenuItems;

  useEffect(() => {
    if (activeSidebarKey !== "projects" || projectsGroupByMode !== "byOrg") {
      return;
    }
    const linearSectionIds = getAllSectionIds(projectsSidebarMenuItems).filter(
      isProjectsLinearOrgGroupId
    );
    const newLinearSectionIds = linearSectionIds.filter(
      (sectionId) =>
        !defaultedProjectsLinearSectionIdsRef.current.has(sectionId)
    );
    if (newLinearSectionIds.length === 0) return;
    setProjectsCollapsedSectionIds((previousIds) => {
      const nextIds = new Set(previousIds);
      for (const sectionId of newLinearSectionIds) {
        nextIds.add(sectionId);
        defaultedProjectsLinearSectionIdsRef.current.add(sectionId);
      }
      return nextIds;
    });
  }, [activeSidebarKey, projectsGroupByMode, projectsSidebarMenuItems]);
  const { selectedMenuItemId, sessionSelectedMenuItemId } =
    resolveSelectedMenuItemIds({
      activeSessionCreatorDraftId,
      activeSessionId: highlightedSessionId,
      activeSidebarKey,
      chatPanelContentMode,
      chatPanelCreateTarget,
      chatPanelSelectedProject,
      chatPanelSelectedWorkItem,
      chatPanelSelectedWorkspace,
      chatPanelStickyNotesOpen,
      foldersDashboardSelected,
      kanbanRoutePath: ROUTES.workStation.kanban.path,
      pathname: location.pathname,
      projectsSelectedMenuItemId,
      sessionCreatorDrafts,
    });
  const resolvedCollapsedSectionIds =
    activeSidebarKey === "projects"
      ? projectsCollapsedSectionIds
      : activeSidebarKey === "folders"
        ? foldersCollapsedSectionIds
        : collapsedSectionIds;
  const resolvedSetCollapsedSectionIds =
    activeSidebarKey === "projects"
      ? setProjectsCollapsedSectionIds
      : activeSidebarKey === "folders"
        ? setFoldersCollapsedSectionIds
        : setCollapsedSectionIds;

  const resetOpsControlStateForProjectsContent = useCallback(() => {
    const stationMode: StationMode = "my-station";
    setStationMode(stationMode);
    setStationChatVisible(stationMode, true);
    setOpsControlPeekHost(null);
    setOpsControlFocusedTab(null);
  }, [
    setOpsControlFocusedTab,
    setOpsControlPeekHost,
    setStationChatVisible,
    setStationMode,
  ]);

  const activateMyStationRouteForProjectsContent = useCallback(() => {
    const targetRoute = ROUTES.workStation.code.path;
    resetOpsControlStateForProjectsContent();
    if (location.pathname !== targetRoute) navigate(targetRoute);
  }, [location.pathname, navigate, resetOpsControlStateForProjectsContent]);

  const { handleGoToNewSession, handleOpenStickyNotes } =
    useSessionEntryActions({
      goToNewSession,
      navigate,
      pathname: location.pathname,
      resetOpsControlStateForProjectsContent,
      setChatPanelContentMode,
      setChatPanelCreateProjectContext,
      setChatPanelCreateTarget,
      setChatPanelSelectedProject,
      setChatPanelSelectedWorkItem,
      setChatPanelSelectedWorkspace,
      setChatPanelStickyNotesOpen,
    });

  const {
    handleDeleteSession,
    handleExportMarkdown,
    handleMenuItemClick,
    handleTogglePin,
    handleAddTag,
  } = useWorkstationSidebarHandlers({
    activeSessionId,
    selectedMenuItemId: sessionSelectedMenuItemId,
    sessionMap,
    isLoadMoreId,
    getLoadMoreGroupId,
    sessionRouteLabel: t("routes.session"),
    goToNewSession: handleGoToNewSession,
    navigateTo,
    openSession,
    promoteActiveSessionCreatorDraft,
    setGroupVisibleCounts,
    tCommon,
  });
  const handleMenuItemContextMenu = useWorkstationSidebarContextMenu({
    sessionMap,
    rename,
    handleDeleteSession,
    handleDeleteDraft: deleteSessionCreatorDraft,
    handleExportMarkdown,
    handleTogglePin,
    handleAddTag,
    tCommon,
  });

  const decorateSessionRowActions = useDecorateSessionRowActions({
    activeSessionMoreMenuId,
    deleteSessionCreatorDraft,
    handleMenuItemContextMenu,
    handleTogglePin,
    pinLabel: pinFolderLabel,
    sessionMap,
    setActiveSessionMoreMenuId,
    tCommon,
    unpinLabel: unpinFolderLabel,
  });
  const decoratedSessionSidebarMenuItems = useMemo(
    () => decorateSessionRowActions(sessionSidebarMenuItems),
    [decorateSessionRowActions, sessionSidebarMenuItems]
  );
  const sidebarMenuItems =
    activeSidebarKey === "projects"
      ? projectsSidebarMenuItems
      : activeSidebarKey === "folders"
        ? foldersSidebarMenuItems
        : decoratedSessionSidebarMenuItems;

  const handleFoldersMenuItemClick = useFoldersMenuItemClick({
    dispatchSetWorkspaceFolders,
    navigate,
    repos,
    resetOpsControlStateForProjectsContent,
    resolveWorkspaceRepoName,
    savedWorkspaces,
    selectRepo,
    setActiveWorkspaceName,
    setChatPanelContentMode,
    setChatPanelCreateProjectContext,
    setChatPanelCreateTarget,
    setChatPanelSelectedProject,
    setChatPanelSelectedWorkItem,
    setChatPanelSelectedWorkspace,
    setChatPanelStickyNotesOpen,
    setChatPanelWorkspaceDashboardOpen,
    setFoldersDashboardSelected,
    setProjectsSelectedMenuItemId,
  });
  const handleProjectsMenuItemClick = useProjectsMenuItemClick({
    activateMyStationRouteForProjectsContent,
    getProjectsLoadMoreGroupId,
    loadProjectsLinearOrgWorkItems,
    openProjectsLinearWorkItem: openProjectsLinearWorkItem,
    projectsLinearWorkItemMap,
    projectsProjectMap,
    projectsWorkItemMap,
    resetOpsControlStateForProjectsContent,
    setChatPanelContentMode,
    setChatPanelCreateProjectContext,
    setChatPanelCreateTarget,
    setChatPanelSelectedProject,
    setChatPanelSelectedWorkItem,
    setChatPanelSelectedWorkspace,
    setChatPanelStickyNotesOpen,
    setProjectsGroupVisibleCounts,
    setProjectsSelectedMenuItemId,
    toChatPanelProject,
    toChatPanelWorkItem,
  });
  const handleOpenSpotlight = useCallback(() => {
    setSpotlightOpen(true);
  }, [setSpotlightOpen]);
  const workstationMenuItemClick = useCallback(
    (key: string, item: NavigationMenuItem) => {
      if (item.id === STICKY_NOTES_MENU_ITEM_ID) {
        handleOpenStickyNotes();
        return;
      }
      handleMenuItemClick(key, item);
    },
    [handleMenuItemClick, handleOpenStickyNotes]
  );

  const renderSessionMenuItemWrapper =
    useRenderSessionMenuItemWrapper(sessionMap);
  const renderProjectsMenuItemWrapper = useRenderProjectsMenuItemWrapper({
    projectsLinearWorkItemMap,
    projectsWorkItemMap,
  });

  const resolvedMenuItemClick =
    activeSidebarKey === "projects"
      ? handleProjectsMenuItemClick
      : activeSidebarKey === "folders"
        ? handleFoldersMenuItemClick
        : workstationMenuItemClick;
  const resolvedMenuItemContextMenu =
    activeSidebarKey === "workstation" ? handleMenuItemContextMenu : undefined;
  const resolvedRenderMenuItemWrapper =
    activeSidebarKey === "projects"
      ? renderProjectsMenuItemWrapper
      : activeSidebarKey === "folders"
        ? undefined
        : renderSessionMenuItemWrapper;
  const allSectionIds = useMemo(
    () => getAllSectionIds(sidebarMenuItems),
    [sidebarMenuItems]
  );
  const handleCollapseAll = useCallback(() => {
    setCollapsedSectionIds(new Set(allSectionIds));
  }, [allSectionIds]);
  const handleMarkAllRead = useCallback(() => {
    markAllSessionsVisited(sessions.map((session) => session.session_id));
  }, [sessions]);
  const handleRefreshSessions = useCallback(() => {
    void loadSidebarSessions({ forceRefresh: true });
  }, []);
  const handleCollapseAllActiveSections = useCallback(() => {
    resolvedSetCollapsedSectionIds(new Set(allSectionIds));
  }, [allSectionIds, resolvedSetCollapsedSectionIds]);
  const isLoading =
    activeSidebarKey === "workstation"
      ? sessionsLoading && sessions.length === 0
      : activeSidebarKey === "projects"
        ? projectsWorkItemsLoading && projectsSidebarMenuItems.length === 0
        : false;
  const sidebarBottomRightActions = useSidebarBottomRightActions({
    activeSidebarKey,
    defaultedProjectsLinearSectionIdsRef,
    groupByMode,
    handleCollapseAll,
    handleCollapseAllActiveSections,
    handleMarkAllRead,
    handleRefreshSessions,
    projectsGroupByMode,
    setGroupByMode,
    setProjectsCollapsedSectionIds,
    setProjectsGroupByMode,
    setProjectsGroupVisibleCounts,
    setProjectsSelectedMenuItemId,
    t,
    tProjects,
  });

  useWorkstationSidebarMemory({
    activeSessionId,
    activeSidebarKey,
    allSectionIds,
    collapsedSectionIds,
    groupByMode,
    pinnedMenuItems,
    selectedMenuItemId,
    sidebarMenuItems,
    tabCount: tabs.length,
  });

  return (
    <>
      <NavigationSidebar
        items={tabs}
        activeKey={activeSidebarKey}
        onChange={handleTabChange}
        menuItems={sidebarMenuItems}
        pinnedMenuItems={pinnedMenuItems}
        selectedKey={selectedMenuItemId}
        onMenuItemClick={resolvedMenuItemClick}
        onMenuItemContextMenu={resolvedMenuItemContextMenu}
        renderMenuItemWrapper={resolvedRenderMenuItemWrapper}
        onAddNew={handleOpenSpotlight}
        addIcon={Search}
        addLabel={tCommon("actions.search")}
        addTooltipContent={
          <SidebarSearchShortcutTooltip
            searchLabel={tCommon("actions.search")}
          />
        }
        beforeAddNewActions={
          <HomeHeaderAction
            label={homeLabel}
            tooltipLabel={t("sidebar.actions.openHome")}
            onClick={goToStartPage}
          />
        }
        listTopPadding
        bottomContent={
          <SidebarBottomBar rightActions={sidebarBottomRightActions} />
        }
        isLoading={isLoading}
        collapsibleSections
        collapsedSectionIds={resolvedCollapsedSectionIds}
        onCollapsedSectionsChange={resolvedSetCollapsedSectionIds}
      />
      <RenameModal
        visible={rename.visible}
        currentName={rename.currentName}
        title={tCommon("actions.rename") + " " + t("routes.session")}
        placeholder={t("sidebar.defaults.enterSessionName")}
        loading={rename.loading}
        onCancel={rename.onCancel}
        onConfirm={(newName) => rename.onConfirm(newName, sessionMap)}
      />
    </>
  );
};
