/**
 * Shared TabBar for My Station: Code / Browser / Database / Project Manager
 * filter to their own tab host.
 */
import { useAtomValue } from "jotai";
import React, { memo } from "react";

import type { AppModeType } from "@src/config/viewModeTypes";
import {
  LayoutSettingsDropdown,
  TabBar,
  WorkStationTabBarLeading,
} from "@src/modules/WorkStation/shared";
import { CODE_EDITOR_TOUR_TARGETS } from "@src/scaffold/Tutorials/codeEditorTourConfig";
import { currentRepoAtom } from "@src/store/repo";

import { useLayoutSettingsToggle } from "./useLayoutSettingsToggle";
import { useWorkstationTabList } from "./useWorkstationTabList";
import { useWorkstationTrailingSlot } from "./useWorkstationTrailingSlot";

export { KanbanStationTabBar } from "./KanbanStationTabBar";

const WORKSTATION_SINGLE_HOST_MODES: AppModeType[] = [
  "code",
  "browser",
  "data",
  "project",
];

export interface WorkstationTabBarProps {
  appMode: AppModeType;
}

const WorkstationTabBar: React.FC<WorkstationTabBarProps> = memo(
  ({ appMode }) => {
    const currentRepo = useAtomValue(currentRepoAtom);

    const layoutSettings = useLayoutSettingsToggle();

    const {
      tabsForBar,
      activeKey,
      isAllTabsView,
      visible,
      handleTabClick,
      handleTabReorder,
      handleTabClose,
      handleCloseOther,
      handleCloseSaved,
    } = useWorkstationTabList();

    const { trailingSlot } = useWorkstationTrailingSlot({
      appMode,
      isAllTabsView,
      visible,
      layoutSettings,
    });

    if (!WORKSTATION_SINGLE_HOST_MODES.includes(appMode)) {
      return null;
    }

    return (
      <>
        <TabBar
          paneId={`workstation-${appMode}`}
          tabs={tabsForBar}
          activeTabId={activeKey}
          onTabClick={handleTabClick}
          onTabClose={handleTabClose}
          onTabReorder={handleTabReorder}
          onCloseOtherTabs={handleCloseOther}
          onCloseSavedTabs={handleCloseSaved}
          repoPath={currentRepo?.path ?? ""}
          leadingSlot={<WorkStationTabBarLeading />}
          trailingSlot={trailingSlot}
          surfaceClassName=""
          dataTourTarget={CODE_EDITOR_TOUR_TARGETS.tabBar}
        />
        <LayoutSettingsDropdown
          isOpen={layoutSettings.isLayoutSettingsOpen}
          onClose={layoutSettings.handleCloseLayoutSettings}
          triggerRef={layoutSettings.layoutSettingsTriggerRef}
        />
      </>
    );
  }
);

WorkstationTabBar.displayName = "WorkstationTabBar";

export default WorkstationTabBar;
