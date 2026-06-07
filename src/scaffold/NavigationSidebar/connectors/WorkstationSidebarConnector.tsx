import { RenameModal } from "@/src/scaffold/ModalSystem/variants";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  Code,
  FolderTree,
  Folders,
  House,
  ListTodo,
  MessageCircle,
  Search,
} from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { type WorkspaceRecord } from "@src/api/tauri/workspace";
import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import SessionHoverCard from "@src/components/SessionHoverCard";
import Tooltip from "@src/components/Tooltip";
import WorkItemHoverCard from "@src/components/WorkItemHoverCard";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { ROUTES } from "@src/config/routes";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import {
  type GoToNewSessionOptions,
  useAppNavigation,
} from "@src/hooks/navigation/useAppNavigation";
import { SIDEBAR_MEMORY_KIND, useSidebarMemoryEntry } from "@src/hooks/perf";
import { useSessionView } from "@src/hooks/ui/tabs/useSessionView";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import { benchmarkAgentBatchStatusAtom } from "@src/store/benchmark";
import {
  type Repo,
  repoMapAtom,
  reposAtom,
  selectedRepoIdAtom,
} from "@src/store/repo";
import {
  SESSION_SIDEBAR_PAGE_SIZE,
  activeSessionCreatorDraftIdAtom,
  deleteSessionCreatorDraftAtom,
  loadSidebarSessions,
  markAllSessionsVisited,
  promoteActiveSessionCreatorDraftAtom,
  refreshCursorIdeSidebarSessions,
  sessionCreatorDraftListAtom,
  sessionLoadingAtom,
  sessionsAtom,
  visitedSessionsAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session";
import {
  CHAT_PANEL_CONTENT_MODE,
  CHAT_PANEL_CREATE_TARGET,
  activeStationChatVisibleAtom,
  chatPanelContentModeAtom,
  chatPanelCreateProjectContextAtom,
  chatPanelCreateTargetAtom,
  chatPanelSelectedProjectAtom,
  chatPanelSelectedWorkItemAtom,
  chatPanelStickyNotesOpenAtom,
} from "@src/store/ui/chatPanelAtom";
import { type StationMode, stationModeAtom } from "@src/store/ui/simulatorAtom";
import { spotlightOpenAtom } from "@src/store/ui/uiAtom";
import {
  activeWorkspaceIdAtom,
  activeWorkspaceNameAtom,
  savedWorkspacesAtom,
  setWorkspaceFoldersAtom,
} from "@src/store/workspace";
import {
  opsControlFocusedTabAtom,
  opsControlPeekHostAtom,
} from "@src/store/workstation";
import type { WorkspaceFolder } from "@src/types/workspace";

import { SidebarBottomBar } from "../blocks";
import NavigationSidebar from "../variants/NavigationSidebar";
import { SessionFilterButton } from "./SessionFilterButton";
import {
  CURSOR_IDE_REFRESH_INTERVAL_MS,
  PROJECTS_NEW_PROJECT_MENU_ITEM_ID,
  PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID,
  STICKY_NOTES_MENU_ITEM_ID,
} from "./sidebarConnectorUtils";
import {
  projectsSidebarGroupByAtom,
  sidebarGroupByAtom,
} from "./sidebarGroupByAtom";
import {
  GROUP_BY_MODES,
  type GroupByMode,
  PROJECTS_GROUP_BY_MODES,
  type ProjectsGroupByMode,
} from "./types";
import {
  getProjectsLinearLoadOrgId,
  getProjectsLinearWorkItemId,
  getProjectsProjectOverviewSlug,
  getProjectsWorkItemCreateOrgId,
  getProjectsWorkItemId,
  isProjectsLinearOrgGroupId,
  useProjectsWorkItemMenuItems,
} from "./useProjectsWorkItemMenuItems";
import { useRenameSessionModal } from "./useRenameSessionModal";
import { useSessionMenuItems } from "./useSessionMenuItems";
import { useWorkstationSidebarContextMenu } from "./useWorkstationSidebarContextMenu";
import { useWorkstationSidebarHandlers } from "./useWorkstationSidebarHandlers";
import {
  DEFAULT_COLLAPSED_SECTION_IDS,
  buildRepoPathToName,
  getAllSectionIds,
  getSelectedDraftMenuItemId,
  getSelectedMenuItemId,
  getSelectedPinnedMenuItemId,
  sortSessionsByActivity,
} from "./workstationSidebarData";
import {
  buildDraftMenuItems,
  buildPinnedMenuItems,
  buildProjectsPinnedMenuItems,
} from "./workstationSidebarMenuItems";

type WorkstationSidebarKey = "folders" | "workstation" | "projects";

const FOLDERS_WORKSPACES_SECTION_ID = "separator-folders-workspaces";
const FOLDERS_REPOS_SECTION_ID = "separator-folders-repos";
const FOLDERS_WORKSPACE_ITEM_PREFIX = "folders-workspace:";
const FOLDERS_REPO_ITEM_PREFIX = "folders-repo:";

function getRepoDisplayName(repo: Repo): string {
  return repo.name || repo.path?.split("/").pop() || "Repo";
}

function normalizeFsPath(path: string | undefined): string {
  if (!path) return "";
  const stripped = path.startsWith("file://")
    ? path.replace("file://", "")
    : path;
  return stripped.replace(/\/+$/, "");
}

function buildWorkspaceRepoNameResolver(repos: readonly Repo[]) {
  const byId = new Map<string, string>();
  const byPath = new Map<string, string>();
  for (const repo of repos) {
    const name = getRepoDisplayName(repo);
    byId.set(repo.id, name);
    const normalizedPath = normalizeFsPath(repo.path ?? repo.fs_uri);
    if (normalizedPath) byPath.set(normalizedPath, name);
  }
  return (folder: WorkspaceRecord["folders"][number]): string => {
    if (folder.repoId) {
      const idMatch = byId.get(folder.repoId);
      if (idMatch) return idMatch;
    }
    return byPath.get(normalizeFsPath(folder.folderPath)) ?? folder.folderName;
  };
}

function getWorkspaceFolderCountLabel(count: number): string {
  return `${count} ${count === 1 ? "repo" : "repos"}`;
}

function SidebarSearchShortcutTooltip({
  searchLabel,
}: {
  searchLabel: string;
}): React.ReactElement {
  return (
    <KeyboardShortcutTooltipContent
      rows={[
        { label: "Spotlight", shortcut: getShortcutKeys("spotlight_open") },
        {
          label: `${searchLabel} session`,
          shortcut: getShortcutKeys("agent_session_search"),
        },
      ]}
    />
  );
}

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
  const chatPanelStickyNotesOpen = useAtomValue(chatPanelStickyNotesOpenAtom);
  const setChatPanelContentMode = useSetAtom(chatPanelContentModeAtom);
  const setChatPanelCreateProjectContext = useSetAtom(
    chatPanelCreateProjectContextAtom
  );
  const setChatPanelCreateTarget = useSetAtom(chatPanelCreateTargetAtom);
  const setChatPanelSelectedProject = useSetAtom(chatPanelSelectedProjectAtom);
  const setChatPanelSelectedWorkItem = useSetAtom(
    chatPanelSelectedWorkItemAtom
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
  const [projectsSelectedMenuItemId, setProjectsSelectedMenuItemId] =
    useState("");

  const tabs = useMemo(
    () => [
      {
        key: "folders",
        label: t("labels.folders"),
        icon: Folders,
        iconName: "folders",
      },
      {
        key: "workstation",
        label: t("labels.session"),
        icon: MessageCircle,
        iconName: "message-circle",
      },
      {
        key: "projects",
        label: t("labels.project"),
        icon: ListTodo,
        iconName: "list-todo",
      },
    ],
    [t]
  );

  const handleTabChange = useCallback((key: string) => {
    if (key !== "folders" && key !== "workstation" && key !== "projects")
      return;
    setActiveSidebarKey(key);
  }, []);

  useEffect(() => {
    void loadSidebarSessions({ forceRefresh: true });
  }, []);

  const sortedSessions = useMemo(
    () => sortSessionsByActivity(sessions),
    [sessions]
  );

  const repoMap = useAtomValue(repoMapAtom);
  const repos = useAtomValue(reposAtom);
  const selectedRepoId = useAtomValue(selectedRepoIdAtom);
  const savedWorkspaces = useAtomValue(savedWorkspacesAtom);
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom);
  const dispatchSetWorkspaceFolders = useSetAtom(setWorkspaceFoldersAtom);
  const setActiveWorkspaceName = useSetAtom(activeWorkspaceNameAtom);
  const { selectRepo } = useRepoSelection({ autoLoad: false });
  const repoPathToName = useMemo(() => buildRepoPathToName(repoMap), [repoMap]);
  const resolveWorkspaceRepoName = useMemo(
    () => buildWorkspaceRepoNameResolver(repos),
    [repos]
  );

  useEffect(() => {
    const refreshCursorIdeSessions = () => {
      if (document.visibilityState !== "visible") return;
      void refreshCursorIdeSidebarSessions();
    };

    const intervalId = window.setInterval(
      refreshCursorIdeSessions,
      CURSOR_IDE_REFRESH_INTERVAL_MS
    );
    document.addEventListener("visibilitychange", refreshCursorIdeSessions);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener(
        "visibilitychange",
        refreshCursorIdeSessions
      );
    };
  }, []);

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
    toChatPanelWorkItem: toChatPanelWorkItem,
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

  const sessionPinnedMenuItems = useMemo<NavigationMenuItem[]>(
    () =>
      buildPinnedMenuItems({
        newSessionLabel,
        newSessionShortcut: getShortcutKeys("new_session"),
        kanbanLabel: t("routes.kanban"),
        kanbanRoutePath: ROUTES.workStation.kanban.path,
        stickyNotesLabel,
      }),
    [newSessionLabel, stickyNotesLabel, t]
  );

  const projectsPinnedMenuItems = useMemo<NavigationMenuItem[]>(
    () =>
      buildProjectsPinnedMenuItems({
        createProjectLabel,
        createWorkItemLabel,
      }),
    [createProjectLabel, createWorkItemLabel]
  );

  const draftMenuItems = useMemo<NavigationMenuItem[]>(
    () =>
      buildDraftMenuItems({
        sessionCreatorDrafts,
        draftsLabel: t("labels.drafts"),
      }),
    [sessionCreatorDrafts, t]
  );

  const sessionSidebarMenuItems = useMemo(
    () => [...draftMenuItems, ...menuItems],
    [draftMenuItems, menuItems]
  );

  const foldersSidebarMenuItems = useMemo<NavigationMenuItem[]>(() => {
    const items: NavigationMenuItem[] = [];

    if (savedWorkspaces.length > 0) {
      items.push({
        id: FOLDERS_WORKSPACES_SECTION_ID,
        key: FOLDERS_WORKSPACES_SECTION_ID,
        label: t("common:selectors.repo.sections.workspace"),
      });
      items.push(
        ...savedWorkspaces.map((workspace) => {
          const folderCount = workspace.folders.length;
          const memberNames = workspace.folders.map(resolveWorkspaceRepoName);
          return {
            id: `${FOLDERS_WORKSPACE_ITEM_PREFIX}${workspace.workspaceId}`,
            key: `${FOLDERS_WORKSPACE_ITEM_PREFIX}${workspace.workspaceId}`,
            label: workspace.name,
            subtitle: memberNames.join(", "),
            icon: FolderTree,
            iconName: "folder-tree",
            shortcut: getWorkspaceFolderCountLabel(folderCount),
          } satisfies NavigationMenuItem;
        })
      );
    }

    items.push({
      id: FOLDERS_REPOS_SECTION_ID,
      key: FOLDERS_REPOS_SECTION_ID,
      label: t("common:selectors.repo.sections.repo"),
    });
    items.push(
      ...repos.map((repo) => ({
        id: `${FOLDERS_REPO_ITEM_PREFIX}${repo.id}`,
        key: `${FOLDERS_REPO_ITEM_PREFIX}${repo.id}`,
        label: getRepoDisplayName(repo),
        subtitle: repo.path ?? repo.fs_uri,
        icon: Code,
        iconName: "code",
      }))
    );

    return items;
  }, [repos, resolveWorkspaceRepoName, savedWorkspaces, t]);

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

  const pinnedMenuItems =
    activeSidebarKey === "projects"
      ? projectsPinnedMenuItems
      : activeSidebarKey === "folders"
        ? []
        : sessionPinnedMenuItems;
  const sidebarMenuItems =
    activeSidebarKey === "projects"
      ? projectsSidebarMenuItems
      : activeSidebarKey === "folders"
        ? foldersSidebarMenuItems
        : sessionSidebarMenuItems;

  const selectedDraftMenuItemId = getSelectedDraftMenuItemId(
    activeSessionCreatorDraftId,
    sessionCreatorDrafts
  );
  const selectedPinnedMenuItemId = getSelectedPinnedMenuItemId(
    location.pathname,
    ROUTES.workStation.kanban.path
  );
  const isChatPanelProjectsContentSelected =
    chatPanelContentMode === CHAT_PANEL_CONTENT_MODE.NON_SESSION ||
    Boolean(chatPanelSelectedWorkItem) ||
    Boolean(chatPanelSelectedProject);
  const sessionSelectedMenuItemId = chatPanelStickyNotesOpen
    ? STICKY_NOTES_MENU_ITEM_ID
    : chatPanelCreateTarget === CHAT_PANEL_CREATE_TARGET.PROJECT ||
        chatPanelCreateTarget === CHAT_PANEL_CREATE_TARGET.WORK_ITEM ||
        isChatPanelProjectsContentSelected
      ? ""
      : getSelectedMenuItemId({
          selectedPinnedMenuItemId,
          activeSessionId: highlightedSessionId,
          selectedDraftMenuItemId,
        });
  const resolvedProjectsSelectedMenuItemId =
    chatPanelCreateTarget === CHAT_PANEL_CREATE_TARGET.PROJECT ||
    chatPanelCreateTarget === CHAT_PANEL_CREATE_TARGET.WORK_ITEM ||
    chatPanelSelectedWorkItem ||
    chatPanelSelectedProject
      ? projectsSelectedMenuItemId
      : "";
  const foldersSelectedMenuItemId = activeWorkspaceId
    ? `${FOLDERS_WORKSPACE_ITEM_PREFIX}${activeWorkspaceId}`
    : selectedRepoId
      ? `${FOLDERS_REPO_ITEM_PREFIX}${selectedRepoId}`
      : "";
  const selectedMenuItemId =
    activeSidebarKey === "projects"
      ? resolvedProjectsSelectedMenuItemId
      : activeSidebarKey === "folders"
        ? foldersSelectedMenuItemId
        : sessionSelectedMenuItemId;
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
    if (location.pathname !== targetRoute) {
      navigate(targetRoute);
    }
  }, [location.pathname, navigate, resetOpsControlStateForProjectsContent]);

  const handleGoToNewSession = useCallback(
    (options?: GoToNewSessionOptions) => {
      setChatPanelSelectedWorkItem(null);
      setChatPanelSelectedProject(null);
      setChatPanelStickyNotesOpen(false);
      setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
      goToNewSession(options);
    },
    [
      goToNewSession,
      setChatPanelCreateTarget,
      setChatPanelSelectedProject,
      setChatPanelSelectedWorkItem,
      setChatPanelStickyNotesOpen,
    ]
  );

  const handleOpenStickyNotes = useCallback(() => {
    resetOpsControlStateForProjectsContent();
    setChatPanelSelectedWorkItem(null);
    setChatPanelSelectedProject(null);
    setChatPanelCreateProjectContext(null);
    setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
    setChatPanelContentMode(CHAT_PANEL_CONTENT_MODE.NON_SESSION);
    setChatPanelStickyNotesOpen(true);
    const targetRoute = ROUTES.workStation.code.path;
    if (location.pathname !== targetRoute) {
      navigate(targetRoute);
    }
  }, [
    location.pathname,
    navigate,
    resetOpsControlStateForProjectsContent,
    setChatPanelContentMode,
    setChatPanelCreateProjectContext,
    setChatPanelCreateTarget,
    setChatPanelSelectedProject,
    setChatPanelSelectedWorkItem,
    setChatPanelStickyNotesOpen,
  ]);

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

  const handleFoldersMenuItemClick = useCallback(
    (_key: string, item: NavigationMenuItem) => {
      const workspaceId = item.id.startsWith(FOLDERS_WORKSPACE_ITEM_PREFIX)
        ? item.id.slice(FOLDERS_WORKSPACE_ITEM_PREFIX.length)
        : "";
      if (workspaceId) {
        const workspace = savedWorkspaces.find(
          (candidate) => candidate.workspaceId === workspaceId
        );
        if (!workspace) return;
        const folders: WorkspaceFolder[] = workspace.folders.map((folder) => ({
          id: crypto.randomUUID(),
          name: resolveWorkspaceRepoName(folder),
          path: folder.folderPath,
          uri: `file://${folder.folderPath}`,
          isPrimary: folder.isPrimary,
          repoId: folder.repoId ?? undefined,
          kind: folder.kind === "folder" ? "folder" : "git",
        }));
        dispatchSetWorkspaceFolders(folders, workspace.workspaceId);
        setActiveWorkspaceName(workspace.name);
        goToStartPage();
        return;
      }

      const repoId = item.id.startsWith(FOLDERS_REPO_ITEM_PREFIX)
        ? item.id.slice(FOLDERS_REPO_ITEM_PREFIX.length)
        : "";
      if (!repoId) return;
      selectRepo(repoId);
      dispatchSetWorkspaceFolders([], null);
      setActiveWorkspaceName(null);
      goToStartPage();
    },
    [
      dispatchSetWorkspaceFolders,
      goToStartPage,
      resolveWorkspaceRepoName,
      savedWorkspaces,
      selectRepo,
      setActiveWorkspaceName,
    ]
  );

  const handleProjectsMenuItemClick = useCallback(
    (_key: string, item: NavigationMenuItem) => {
      if (item.id === PROJECTS_NEW_PROJECT_MENU_ITEM_ID) {
        resetOpsControlStateForProjectsContent();
        setProjectsSelectedMenuItemId(PROJECTS_NEW_PROJECT_MENU_ITEM_ID);
        setChatPanelSelectedWorkItem(null);
        setChatPanelSelectedProject(null);
        setChatPanelStickyNotesOpen(false);
        setChatPanelCreateProjectContext(null);
        setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.PROJECT);
        setChatPanelContentMode(CHAT_PANEL_CONTENT_MODE.NON_SESSION);
        return;
      }

      if (item.id === PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID) {
        resetOpsControlStateForProjectsContent();
        setProjectsSelectedMenuItemId(PROJECTS_NEW_WORK_ITEM_MENU_ITEM_ID);
        setChatPanelSelectedWorkItem(null);
        setChatPanelSelectedProject(null);
        setChatPanelStickyNotesOpen(false);
        setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.WORK_ITEM);
        setChatPanelContentMode(CHAT_PANEL_CONTENT_MODE.NON_SESSION);
        return;
      }

      const createWorkItemOrgId = getProjectsWorkItemCreateOrgId(item.id);
      if (createWorkItemOrgId) {
        resetOpsControlStateForProjectsContent();
        setProjectsSelectedMenuItemId(item.id);
        setChatPanelSelectedWorkItem(null);
        setChatPanelSelectedProject(null);
        setChatPanelStickyNotesOpen(false);
        setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.WORK_ITEM);
        setChatPanelContentMode(CHAT_PANEL_CONTENT_MODE.NON_SESSION);
        return;
      }

      const linearLoadOrgId = getProjectsLinearLoadOrgId(item.id);
      if (linearLoadOrgId) {
        loadProjectsLinearOrgWorkItems(linearLoadOrgId);
        return;
      }

      const loadMoreGroupId = getProjectsLoadMoreGroupId(item.id);
      if (loadMoreGroupId) {
        setProjectsGroupVisibleCounts((previousCounts) => {
          const nextCounts = new Map(previousCounts);
          const current =
            nextCounts.get(loadMoreGroupId) ?? SESSION_SIDEBAR_PAGE_SIZE;
          nextCounts.set(loadMoreGroupId, current + SESSION_SIDEBAR_PAGE_SIZE);
          return nextCounts;
        });
        return;
      }

      const projectOverviewSlug = getProjectsProjectOverviewSlug(item.id);
      if (projectOverviewSlug) {
        const project = projectsProjectMap.get(projectOverviewSlug);
        if (!project) return;
        activateMyStationRouteForProjectsContent();
        setProjectsSelectedMenuItemId(item.id);
        setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
        setChatPanelSelectedWorkItem(null);
        setChatPanelSelectedProject(toChatPanelProject(project));
        setChatPanelStickyNotesOpen(false);
        setChatPanelContentMode(CHAT_PANEL_CONTENT_MODE.NON_SESSION);
        return;
      }

      const linearWorkItemId = getProjectsLinearWorkItemId(item.id);
      if (linearWorkItemId) {
        const linearWorkItem = projectsLinearWorkItemMap.get(linearWorkItemId);
        if (!linearWorkItem) return;
        setProjectsSelectedMenuItemId(item.id);
        setChatPanelSelectedWorkItem(null);
        setChatPanelSelectedProject(null);
        setChatPanelStickyNotesOpen(false);
        openProjectsLinearWorkItem(linearWorkItem);
        return;
      }

      const workItemId = getProjectsWorkItemId(item.id);
      if (!workItemId) return;
      const workItem = projectsWorkItemMap.get(workItemId);
      if (!workItem) return;
      const chatPanelWorkItem = toChatPanelWorkItem(workItem);
      activateMyStationRouteForProjectsContent();
      setProjectsSelectedMenuItemId(item.id);
      setChatPanelCreateTarget(CHAT_PANEL_CREATE_TARGET.AGENT_SESSION);
      setChatPanelSelectedProject(null);
      setChatPanelSelectedWorkItem(chatPanelWorkItem);
      setChatPanelStickyNotesOpen(false);
      setChatPanelContentMode(CHAT_PANEL_CONTENT_MODE.NON_SESSION);
    },
    [
      activateMyStationRouteForProjectsContent,
      getProjectsLoadMoreGroupId,
      loadProjectsLinearOrgWorkItems,
      openProjectsLinearWorkItem,
      projectsLinearWorkItemMap,
      projectsProjectMap,
      projectsWorkItemMap,
      resetOpsControlStateForProjectsContent,
      setChatPanelContentMode,
      setChatPanelCreateProjectContext,
      setChatPanelCreateTarget,
      setChatPanelSelectedProject,
      setChatPanelSelectedWorkItem,
      setChatPanelStickyNotesOpen,
      toChatPanelProject,
      toChatPanelWorkItem,
    ]
  );

  const handleOpenSpotlight = useCallback(() => {
    setSpotlightOpen(true);
  }, [setSpotlightOpen]);

  const homeHeaderAction = useMemo(
    () => (
      <Tooltip
        content={
          <KeyboardShortcutTooltipContent
            label={t("sidebar.actions.openHome")}
          />
        }
        position="bottom"
        mouseEnterDelay={200}
        framedPanel
      >
        <div className="inline-flex">
          <button
            type="button"
            className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[100px] border-none bg-transparent p-0 transition-colors duration-150 hover:bg-fill-2"
            onClick={goToStartPage}
            aria-label={homeLabel}
          >
            <House size={16} strokeWidth={2} className="text-text-2" />
          </button>
        </div>
      </Tooltip>
    ),
    [goToStartPage, homeLabel, t]
  );

  const renderSessionMenuItemWrapper = useCallback(
    (item: NavigationMenuItem, node: React.ReactElement) => {
      if (!sessionMap.has(item.id)) return node;
      return (
        <SessionHoverCard
          key={item.key}
          sessionId={item.id}
          position="right-start"
          mouseEnterDelay={1000}
          mouseLeaveDelay={100}
        >
          {node}
        </SessionHoverCard>
      );
    },
    [sessionMap]
  );

  const renderProjectsMenuItemWrapper = useCallback(
    (item: NavigationMenuItem, node: React.ReactElement) => {
      const workItemId = getProjectsWorkItemId(item.id);
      if (workItemId) {
        return (
          <WorkItemHoverCard
            key={item.key}
            workItem={projectsWorkItemMap.get(workItemId)}
            position="right-start"
            mouseEnterDelay={1000}
            mouseLeaveDelay={100}
          >
            {node}
          </WorkItemHoverCard>
        );
      }

      const linearWorkItemId = getProjectsLinearWorkItemId(item.id);
      if (linearWorkItemId) {
        return (
          <WorkItemHoverCard
            key={item.key}
            workItem={projectsLinearWorkItemMap.get(linearWorkItemId)}
            position="right-start"
            mouseEnterDelay={1000}
            mouseLeaveDelay={100}
          >
            {node}
          </WorkItemHoverCard>
        );
      }

      return node;
    },
    [projectsLinearWorkItemMap, projectsWorkItemMap]
  );
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

  const isLoading =
    activeSidebarKey === "workstation"
      ? sessionsLoading && sessions.length === 0
      : activeSidebarKey === "projects"
        ? projectsWorkItemsLoading && projectsSidebarMenuItems.length === 0
        : false;

  const getProjectsGroupByLabel = useCallback(
    (mode: string) => {
      switch (mode) {
        case "byProject":
          return tProjects("projects.groupBy.project");
        case "byStatus":
          return tProjects("projects.groupBy.status");
        case "byPriority":
          return tProjects("projects.groupBy.priority");
        case "byOrg":
        default:
          return tProjects("projects.groupBy.org");
      }
    },
    [tProjects]
  );

  const handleSessionGroupBySelect = useCallback(
    (mode: string) => {
      if (!GROUP_BY_MODES.includes(mode as GroupByMode)) {
        return;
      }
      setGroupByMode(mode as GroupByMode);
    },
    [setGroupByMode]
  );

  const handleProjectsGroupBySelect = useCallback(
    (mode: string) => {
      if (!PROJECTS_GROUP_BY_MODES.includes(mode as ProjectsGroupByMode)) {
        return;
      }
      setProjectsGroupByMode(mode as ProjectsGroupByMode);
      setProjectsSelectedMenuItemId("");
      setProjectsGroupVisibleCounts(new Map());
      setProjectsCollapsedSectionIds(new Set());
      defaultedProjectsLinearSectionIdsRef.current.clear();
    },
    [setProjectsGroupByMode]
  );

  const sidebarBottomRightActions =
    activeSidebarKey === "projects" ? (
      <SessionFilterButton
        groupByMode={projectsGroupByMode}
        groupByModes={PROJECTS_GROUP_BY_MODES}
        getGroupByLabel={getProjectsGroupByLabel}
        onSelect={handleProjectsGroupBySelect}
      />
    ) : activeSidebarKey === "workstation" ? (
      <SessionFilterButton
        groupByMode={groupByMode}
        onSelect={handleSessionGroupBySelect}
        onCollapseAll={handleCollapseAll}
        onMarkAllRead={handleMarkAllRead}
        onRefreshSessions={handleRefreshSessions}
      />
    ) : null;

  useSidebarMemoryEntry({
    kind: SIDEBAR_MEMORY_KIND.SESSION,
    label:
      activeSidebarKey === "projects"
        ? "Projects sidebar"
        : activeSidebarKey === "folders"
          ? "Folders sidebar"
          : "Session sidebar",
    items: pinnedMenuItems.length + sidebarMenuItems.length,
    sections: allSectionIds.length,
    tabs: tabs.length,
    source: {
      activeSessionId,
      collapsedSectionIds: Array.from(collapsedSectionIds),
      groupByMode,
      pinnedMenuItems,
      selectedMenuItemId,
      sidebarMenuItems,
    },
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
        beforeAddNewActions={homeHeaderAction}
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
