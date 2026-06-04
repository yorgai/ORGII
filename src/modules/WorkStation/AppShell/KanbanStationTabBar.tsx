/**
 * KanbanStationTabBar
 *
 * Tab bar for the Ops Control / Kanban view. Owns four pinned tabs:
 * Kanban, Projects, Terminal, and Source Control. The first two switch
 * the ops-control home tab; the latter two open in the code peek-host.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { Settings2 } from "lucide-react";
import { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import {
  LayoutSettingsDropdown,
  StationTabBarLeading,
  TabBar,
  TabBarTrailingIconButton,
} from "@src/modules/WorkStation/shared";
import {
  CODE_EDITOR_MAIN_TERMINAL_SESSION_ID,
  OPS_CONTROL_HOME_TAB,
  type OpsControlHomeTab,
  createSourceControlTab,
  createTerminalTab,
  openTab as openTabMutation,
  opsControlFocusedTabAtom,
  opsControlHomeTabAtom,
  opsControlPeekHostAtom,
  workstationLayoutAtom,
} from "@src/store/workstation";
import type { WorkStationTab } from "@src/store/workstation/tabs";

import { useLayoutSettingsToggle } from "./useLayoutSettingsToggle";

export const KanbanStationTabBar: React.FC = memo(() => {
  const { t } = useTranslation(["navigation", "common", "sessions"]);
  const location = useLocation();
  const navigate = useNavigate();
  const setLayout = useSetAtom(workstationLayoutAtom);
  const opsControlPeekHost = useAtomValue(opsControlPeekHostAtom);
  const opsControlFocusedTab = useAtomValue(opsControlFocusedTabAtom);
  const opsControlHomeTab = useAtomValue(opsControlHomeTabAtom);
  const setOpsControlPeekHost = useSetAtom(opsControlPeekHostAtom);
  const setOpsControlFocusedTab = useSetAtom(opsControlFocusedTabAtom);
  const setOpsControlHomeTab = useSetAtom(opsControlHomeTabAtom);

  const {
    isLayoutSettingsOpen,
    layoutSettingsTriggerRef,
    handleToggleLayoutSettings,
    handleCloseLayoutSettings,
  } = useLayoutSettingsToggle();

  const kanbanTab = useMemo<WorkStationTab>(
    () => ({
      id: "ops-control-kanban",
      type: "kanban-station",
      title: t("sessions:kanban.view.kanban"),
      icon: "Radar",
      data: {},
      closable: false,
      pinned: true,
    }),
    [t]
  );

  const projectsTab = useMemo<WorkStationTab>(
    () => ({
      id: "ops-control-projects",
      type: "project-dashboard",
      title: t("navigation:routes.projects"),
      icon: "Box",
      data: {},
      closable: false,
      pinned: true,
    }),
    [t]
  );

  const terminalTab = useMemo(
    () =>
      createTerminalTab(
        CODE_EDITOR_MAIN_TERMINAL_SESSION_ID,
        t("common:tabs.terminal")
      ),
    [t]
  );

  const sourceControlTab = useMemo(
    () => ({
      ...createSourceControlTab(0),
      title: t("common:tabs.sourceControl"),
    }),
    [t]
  );

  const tabs = useMemo<WorkStationTab[]>(
    () => [kanbanTab, projectsTab, terminalTab, sourceControlTab],
    [kanbanTab, sourceControlTab, projectsTab, terminalTab]
  );

  const activeTabId = useMemo(() => {
    if (opsControlPeekHost) {
      if (opsControlFocusedTab?.tabId === terminalTab.id) return terminalTab.id;
      if (opsControlFocusedTab?.tabId === sourceControlTab.id) {
        return sourceControlTab.id;
      }
    }
    return opsControlHomeTab === OPS_CONTROL_HOME_TAB.STORIES
      ? projectsTab.id
      : kanbanTab.id;
  }, [
    kanbanTab.id,
    opsControlFocusedTab,
    opsControlHomeTab,
    opsControlPeekHost,
    sourceControlTab.id,
    projectsTab.id,
    terminalTab.id,
  ]);

  const setOpsControlView = useCallback(
    (homeTab: OpsControlHomeTab) => {
      const params = new URLSearchParams(location.search);
      params.delete("view");
      const search = params.toString();
      navigate({ search: search ? `?${search}` : "" }, { replace: true });
      setOpsControlHomeTab(homeTab);
      setOpsControlFocusedTab(null);
      setOpsControlPeekHost(null);
    },
    [
      location.search,
      navigate,
      setOpsControlFocusedTab,
      setOpsControlHomeTab,
      setOpsControlPeekHost,
    ]
  );

  const openPinnedCodeTab = useCallback(
    (tab: WorkStationTab) => {
      setLayout((previousLayout) => ({
        ...previousLayout,
        mainPane: openTabMutation(previousLayout.mainPane, tab),
      }));
      setOpsControlFocusedTab({ tabId: tab.id });
      setOpsControlPeekHost("code");
    },
    [setLayout, setOpsControlFocusedTab, setOpsControlPeekHost]
  );

  const handleTabClick = useCallback(
    (tabId: string) => {
      if (tabId === kanbanTab.id) {
        setOpsControlView(OPS_CONTROL_HOME_TAB.KANBAN);
        return;
      }
      if (tabId === projectsTab.id) {
        setOpsControlView(OPS_CONTROL_HOME_TAB.STORIES);
        return;
      }
      if (tabId === terminalTab.id) {
        openPinnedCodeTab(terminalTab);
        return;
      }
      if (tabId === sourceControlTab.id) {
        openPinnedCodeTab(sourceControlTab);
      }
    },
    [
      kanbanTab.id,
      openPinnedCodeTab,
      setOpsControlView,
      sourceControlTab,
      projectsTab.id,
      terminalTab,
    ]
  );

  const leadingSlot = useMemo(() => <StationTabBarLeading />, []);

  const trailingSlot = useMemo(
    () => (
      <span ref={layoutSettingsTriggerRef}>
        <TabBarTrailingIconButton
          title={t("common:layoutSettings.pageSettings")}
          active={isLayoutSettingsOpen}
          aria-pressed={isLayoutSettingsOpen}
          onClick={handleToggleLayoutSettings}
        >
          <Settings2 size={16} strokeWidth={2} />
        </TabBarTrailingIconButton>
      </span>
    ),
    [
      handleToggleLayoutSettings,
      isLayoutSettingsOpen,
      layoutSettingsTriggerRef,
      t,
    ]
  );

  return (
    <>
      <TabBar
        paneId="workstation-kanban"
        tabs={tabs}
        activeTabId={activeTabId}
        onTabClick={handleTabClick}
        onTabClose={() => {}}
        surfaceClassName="bg-workstation-bg"
        leadingSlot={leadingSlot}
        trailingSlot={trailingSlot}
      />
      <LayoutSettingsDropdown
        isOpen={isLayoutSettingsOpen}
        onClose={handleCloseLayoutSettings}
        triggerRef={layoutSettingsTriggerRef}
      />
    </>
  );
});

KanbanStationTabBar.displayName = "KanbanStationTabBar";
