import { useAtomValue } from "jotai";
import React from "react";

import { useRouteAppMode } from "@src/config/routeViewModeConfig";
import type { AppModeType } from "@src/config/viewModeTypes";
import {
  Dock,
  StationDockChrome,
} from "@src/engines/Simulator/components/Dock";
import {
  useDockFilterUrlSync,
  useWorkStationPanels,
} from "@src/hooks/workStation";
import {
  workStationDockAutoHideAtom,
  workStationFollowAgentHighlightEnabledAtom,
  workStationInternalLayoutModeAtom,
  workStationPrimarySidebarCollapsedAtom,
  workStationStatusBarHiddenAtom,
  workStationTitleBarHiddenAtom,
} from "@src/store/ui/workStationAtom";

import { StatusBarRenderer } from "../shared/StatusBar/StatusBarRenderer";
import AgentStationChromeFrame from "./AgentStationChromeFrame";
import AgentStationTopHeader from "./AgentStationTopHeader";
import { AppShellContent } from "./AppShellContent";
import WorkstationTabBar, { KanbanStationTabBar } from "./WorkstationTabBar";
import WorkstationTabHeader from "./WorkstationTabHeader";
import { useAppShellActions } from "./hooks/useAppShellActions";
import { useAppShellDerivedState } from "./hooks/useAppShellDerivedState";
import { useAppShellDock } from "./hooks/useAppShellDock";
import { useAppShellDockFilterSync } from "./hooks/useAppShellDockFilterSync";
import { useAppShellPreload } from "./hooks/useAppShellPreload";
import { useAppShellRepo } from "./hooks/useAppShellRepo";
import { useAppShellSimulatorPanelSync } from "./hooks/useAppShellSimulatorPanelSync";
import { useAppShellStationMode } from "./hooks/useAppShellStationMode";
import { useAppShellStatusBar } from "./hooks/useAppShellStatusBar";
import { useMyStationDockSegments } from "./hooks/useMyStationDockSegments";

interface AppShellProps {
  /** Whether WorkStation is currently visible (code view mode is active) */
  isActive?: boolean;
  /** Whether the chat panel is taking over the WorkStation surface */
  chatPanelFocused?: boolean;
  /** Whether using full layout mode (chat panel inside, no frame radius needed) */
  isFullMode?: boolean;
}

const AppShell = React.memo(
  ({
    isActive = true,
    chatPanelFocused = false,
    isFullMode = false,
  }: AppShellProps) => {
    const appMode = useRouteAppMode();
    const _titleBarHidden = useAtomValue(workStationTitleBarHiddenAtom);
    const statusBarHidden = useAtomValue(workStationStatusBarHiddenAtom);
    const dockAutoHide = useAtomValue(workStationDockAutoHideAtom);
    const internalLayoutMode = useAtomValue(workStationInternalLayoutModeAtom);
    const followAgentHighlightEnabled = useAtomValue(
      workStationFollowAgentHighlightEnabledAtom
    );
    const primaryPanelCollapsed = useAtomValue(
      workStationPrimarySidebarCollapsedAtom
    );

    const { repoPath, repoName, pathExists, lastSeenPath } = useAppShellRepo();
    const { visitedModes, handleDockClick } = useAppShellDock();
    const dockFilter = useAppShellDockFilterSync();
    useDockFilterUrlSync();
    const myStationDockSegments = useMyStationDockSegments();
    const activeDockApp = dockFilter === "all" ? "all" : dockFilter;

    const {
      isAgentStation,
      isKanbanStation,
      opsControlPeekHost,
      hasVisitedAgentStation,
      illuminateAgentStationChrome,
    } = useAppShellStationMode({ followAgentHighlightEnabled });

    const workStationPanels = useWorkStationPanels();
    useAppShellSimulatorPanelSync({ isAgentStation, workStationPanels });
    useAppShellPreload();

    const { handleSelectRepo, handleOpenSettings } = useAppShellActions();

    const {
      effectiveHost,
      isCodeMode,
      isDataMode,
      isBrowserMode,
      isProjectMode,
      codeContentVisible,
      browserContentVisible,
      dataContentVisible,
      projectContentVisible,
    } = useAppShellDerivedState({
      dockFilter,
      isKanbanStation,
      opsControlPeekHost,
    });

    const hasVisitedCode = visitedModes.has("code");
    const hasVisitedData = visitedModes.has("data");
    const hasVisitedBrowser = visitedModes.has("browser");
    const hasVisitedProject = visitedModes.has("project");
    const hasVisitedKanbanStation = visitedModes.has("kanban");

    const showCodeEditorBottomPanelToggle =
      codeContentVisible && !isAgentStation;
    const showSettingsButton =
      (codeContentVisible || projectContentVisible) && !isAgentStation;

    useAppShellStatusBar({
      primaryPanelCollapsed,
      showSettingsButton,
      showCodeEditorBottomPanelToggle,
      handleOpenSettings,
      workStationPanels,
    });

    const showStatusBar = !statusBarHidden && !isAgentStation;
    const useFloatingStatusBar = internalLayoutMode === "comfort";
    const showOpsControlEmptyStatusBar =
      isKanbanStation && opsControlPeekHost === null;

    return (
      <div
        className={`group relative flex h-full w-full min-w-0 flex-col overflow-hidden bg-workstation-bg ${isFullMode ? "" : "rounded-page"}`}
      >
        {isAgentStation && <AgentStationTopHeader />}
        <AgentStationChromeFrame
          enabled={followAgentHighlightEnabled && isAgentStation}
          illuminated={illuminateAgentStationChrome}
          isFullMode={isFullMode}
        >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {isKanbanStation ? (
              <KanbanStationTabBar />
            ) : (
              !isAgentStation && (
                <WorkstationTabBar
                  appMode={
                    (effectiveHost === "code" ||
                    effectiveHost === "browser" ||
                    effectiveHost === "data" ||
                    effectiveHost === "project"
                      ? effectiveHost
                      : appMode) as AppModeType
                  }
                />
              )
            )}
            {!isAgentStation && <WorkstationTabHeader />}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <AppShellContent
                repoPath={repoPath}
                repoName={repoName}
                pathExists={pathExists}
                lastSeenPath={lastSeenPath}
                isActive={isActive}
                chatPanelFocused={chatPanelFocused}
                isAgentStation={isAgentStation}
                isKanbanStation={isKanbanStation}
                opsControlPeekHost={opsControlPeekHost}
                hasVisitedAgentStation={hasVisitedAgentStation}
                hasVisitedKanbanStation={hasVisitedKanbanStation}
                hasVisitedCode={hasVisitedCode}
                hasVisitedData={hasVisitedData}
                hasVisitedBrowser={hasVisitedBrowser}
                hasVisitedProject={hasVisitedProject}
                isCodeMode={isCodeMode}
                isDataMode={isDataMode}
                isBrowserMode={isBrowserMode}
                isProjectMode={isProjectMode}
                codeContentVisible={codeContentVisible}
                browserContentVisible={browserContentVisible}
                dataContentVisible={dataContentVisible}
                projectContentVisible={projectContentVisible}
                handleSelectRepo={handleSelectRepo}
              />
            </div>
          </div>
          {showStatusBar && !showOpsControlEmptyStatusBar && (
            <StatusBarRenderer floating={useFloatingStatusBar} />
          )}
          {!isAgentStation && !isKanbanStation && (
            <StationDockChrome
              autoHide={dockAutoHide}
              showTopBorder={!useFloatingStatusBar}
            >
              <Dock
                segments={myStationDockSegments}
                activeApp={activeDockApp}
                onAppClick={handleDockClick}
              />
            </StationDockChrome>
          )}
        </AgentStationChromeFrame>
      </div>
    );
  }
);

AppShell.displayName = "AppShell";

export default AppShell;
