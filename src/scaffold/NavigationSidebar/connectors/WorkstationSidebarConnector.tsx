import { RenameModal } from "@/src/scaffold/ModalSystem/variants";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Box, House, Search, SquareMousePointer } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import LiquidGlassHoverItem from "@src/components/LiquidGlassHoverItem";
import SessionHoverCard from "@src/components/SessionHoverCard";
import Tooltip from "@src/components/Tooltip";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { ROUTES } from "@src/config/routes";
import { useAppNavigation } from "@src/hooks/navigation/useAppNavigation";
import { SIDEBAR_MEMORY_KIND, useSidebarMemoryEntry } from "@src/hooks/perf";
import { useSessionView } from "@src/hooks/ui/tabs/useSessionView";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import { repoMapAtom } from "@src/store/repo";
import {
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
import { spotlightOpenAtom } from "@src/store/ui/uiAtom";

import { SidebarBottomBar } from "../blocks";
import NavigationSidebar from "../variants/NavigationSidebar";
import { SessionFilterButton } from "./SessionFilterButton";
import { SessionImportExportModal } from "./SessionImportExportModal";
import {
  CURSOR_IDE_REFRESH_INTERVAL_MS,
  NEW_SESSION_MENU_ITEM_ID,
} from "./sidebarConnectorUtils";
import { sidebarGroupByAtom } from "./sidebarGroupByAtom";
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
} from "./workstationSidebarMenuItems";

type SessionImportExportMode = "export" | "import";

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
  const { t: tCommonRaw } = useTranslation();
  const tCommon = useCallback(
    (key: string, defaultValue?: string) => tCommonRaw(key, { defaultValue }),
    [tCommonRaw]
  );
  const location = useLocation();
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
  const { openSession } = useSessionView();
  const { goToStartPage, goToProjects, goToNewSession, navigateTo } =
    useAppNavigation();

  const tabs = useMemo(
    () => [
      {
        key: "workstation",
        label: t("routes.session"),
        icon: SquareMousePointer,
        iconName: "square-mouse-pointer",
      },
      {
        key: "projects",
        label: t("labels.projects"),
        icon: Box,
        iconName: "box",
      },
    ],
    [t]
  );

  const handleTabChange = useCallback(
    (key: string) => {
      if (key === "projects") {
        goToProjects();
        return;
      }
      goToNewSession();
    },
    [goToProjects, goToNewSession]
  );

  useEffect(() => {
    void loadSidebarSessions({ forceRefresh: true });
  }, []);

  const sortedSessions = useMemo(
    () => sortSessionsByActivity(sessions),
    [sessions]
  );

  const repoMap = useAtomValue(repoMapAtom);
  const repoPathToName = useMemo(() => buildRepoPathToName(repoMap), [repoMap]);

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
  const [groupVisibleCounts, setGroupVisibleCounts] = useState<
    Map<string, number>
  >(new Map());
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(
    () => new Set(DEFAULT_COLLAPSED_SECTION_IDS)
  );
  const [importExportMode, setImportExportMode] =
    useState<SessionImportExportMode | null>(null);

  const untitledSession = t("sidebar.defaults.untitledSession");
  const newSessionLabel = t("labels.newSession");
  const homeLabel = t("sidebar.tabs.build");

  const { menuItems, sessionMap, isLoadMoreId, getLoadMoreGroupId } =
    useSessionMenuItems({
      sortedSessions,
      visitedSessions,
      repoPathToName,
      groupByMode,
      untitledSession,
      groupVisibleCounts,
    });

  const rename = useRenameSessionModal();
  const activeSessionId = useAtomValue(workstationActiveSessionIdAtom) ?? "";

  const handleDeleteDraft = useCallback(
    (event: React.MouseEvent, draftId: string) => {
      event.preventDefault();
      event.stopPropagation();
      deleteSessionCreatorDraft(draftId);
    },
    [deleteSessionCreatorDraft]
  );

  const pinnedMenuItems = useMemo<NavigationMenuItem[]>(
    () =>
      buildPinnedMenuItems({
        newSessionLabel,
        kanbanLabel: t("routes.kanban"),
        kanbanRoutePath: ROUTES.workStation.kanban.path,
      }),
    [newSessionLabel, t]
  );

  const draftMenuItems = useMemo<NavigationMenuItem[]>(
    () =>
      buildDraftMenuItems({
        sessionCreatorDrafts,
        draftsLabel: t("labels.drafts"),
        deleteLabel: tCommon("actions.delete"),
        onDeleteDraft: handleDeleteDraft,
      }),
    [handleDeleteDraft, sessionCreatorDrafts, t, tCommon]
  );

  const sidebarMenuItems = useMemo(
    () => [...draftMenuItems, ...menuItems],
    [draftMenuItems, menuItems]
  );

  const selectedDraftMenuItemId = getSelectedDraftMenuItemId(
    activeSessionCreatorDraftId,
    sessionCreatorDrafts
  );
  const selectedPinnedMenuItemId = getSelectedPinnedMenuItemId(
    location.pathname,
    ROUTES.workStation.kanban.path
  );
  const selectedMenuItemId = getSelectedMenuItemId({
    selectedPinnedMenuItemId,
    activeSessionId,
    selectedDraftMenuItemId,
  });

  const {
    handleDeleteSession,
    handleExportMarkdown,
    handleMenuItemClick,
    handleTogglePin,
    handleAddTag,
  } = useWorkstationSidebarHandlers({
    activeSessionId,
    selectedMenuItemId,
    sessionMap,
    isLoadMoreId,
    getLoadMoreGroupId,
    sessionRouteLabel: t("routes.session"),
    goToNewSession,
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
    handleExportMarkdown,
    handleTogglePin,
    handleAddTag,
    tCommon,
  });

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
          <LiquidGlassHoverItem
            className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[100px]"
            onClick={goToStartPage}
            role="button"
            tabIndex={0}
            aria-label={homeLabel}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                goToStartPage();
              }
            }}
          >
            <House size={16} strokeWidth={2} className="text-text-2" />
          </LiquidGlassHoverItem>
        </div>
      </Tooltip>
    ),
    [goToStartPage, homeLabel, t]
  );

  const renderMenuItemWrapper = useCallback(
    (item: NavigationMenuItem, node: React.ReactElement) => {
      if (item.id === NEW_SESSION_MENU_ITEM_ID) {
        return (
          <Tooltip
            key={item.key}
            content={
              <KeyboardShortcutTooltipContent
                label={newSessionLabel}
                shortcut={getShortcutKeys("new_session")}
              />
            }
            position="right"
            mouseEnterDelay={200}
            framedPanel
          >
            {node}
          </Tooltip>
        );
      }
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
    [newSessionLabel, sessionMap]
  );

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

  const handleOpenExportSessionJson = useCallback(() => {
    setImportExportMode("export");
  }, []);

  const handleOpenImportSessionJson = useCallback(() => {
    setImportExportMode("import");
  }, []);

  const handleCloseImportExport = useCallback(() => {
    setImportExportMode(null);
  }, []);

  const activeSession = activeSessionId
    ? sessionMap.get(activeSessionId)
    : undefined;

  const handleImportedSession = useCallback(
    (sessionId: string, sessionName: string) => {
      promoteActiveSessionCreatorDraft();
      openSession(sessionId, sessionName);
    },
    [openSession, promoteActiveSessionCreatorDraft]
  );

  const isLoading = sessionsLoading && sessions.length === 0;

  useSidebarMemoryEntry({
    kind: SIDEBAR_MEMORY_KIND.SESSION,
    label: "Session sidebar",
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
        activeKey="workstation"
        onChange={handleTabChange}
        menuItems={sidebarMenuItems}
        pinnedMenuItems={pinnedMenuItems}
        selectedKey={selectedMenuItemId}
        onMenuItemClick={handleMenuItemClick}
        onMenuItemContextMenu={handleMenuItemContextMenu}
        renderMenuItemWrapper={renderMenuItemWrapper}
        onAddNew={handleOpenSpotlight}
        addIcon={Search}
        addLabel={tCommon("actions.search")}
        addTooltipContent={
          <SidebarSearchShortcutTooltip
            searchLabel={tCommon("actions.search")}
          />
        }
        beforeAddNewActions={homeHeaderAction}
        verticalGapClassName="gap-px"
        listTopPadding
        enableHoverIconAnimation
        bottomContent={
          <SidebarBottomBar
            rightActions={
              <SessionFilterButton
                groupByMode={groupByMode}
                onSelect={setGroupByMode}
                onCollapseAll={handleCollapseAll}
                onMarkAllRead={handleMarkAllRead}
                onRefreshSessions={handleRefreshSessions}
                onExportSessionJson={handleOpenExportSessionJson}
                onImportSessionJson={handleOpenImportSessionJson}
                canExportSessionJson={Boolean(activeSession)}
              />
            }
          />
        }
        isLoading={isLoading}
        collapsibleSections
        collapsedSectionIds={collapsedSectionIds}
        onCollapsedSectionsChange={setCollapsedSectionIds}
      />
      <SessionImportExportModal
        visible={importExportMode !== null}
        mode={importExportMode ?? "export"}
        activeSession={activeSession}
        sessionFallbackName={t("routes.session")}
        onClose={handleCloseImportExport}
        onImported={handleImportedSession}
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
