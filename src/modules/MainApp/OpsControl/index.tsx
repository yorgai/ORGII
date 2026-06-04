/**
 * Ops Control pane
 *
 * Reuses the existing `TaskKanban` feature to give a single board view of
 * agent status inside Workstation.
 */
import { useAtomValue } from "jotai";
import React, { useMemo } from "react";

import TaskKanban from "@src/features/TaskKanban";
import { usePrimarySidebarState } from "@src/hooks/workStation/panels/useWorkStationPanels";
import {
  WorkStationShell,
  buildPrimarySidebarConfig,
} from "@src/modules/WorkStation/shared";
import { currentRepoAtom } from "@src/store/repo";
import {
  OPS_CONTROL_HOME_TAB,
  opsControlHomeTabAtom,
} from "@src/store/workstation";

import OpsControlProjectsSurface from "./OpsControlProjectsSurface";
import OpsControlTaskCreator from "./OpsControlTaskCreator";
import "./index.scss";

const getFolderName = (path: string): string => {
  if (!path) return "";
  const cleanPath = path.replace(/\/+$/, "");
  const segments = cleanPath.split("/").filter(Boolean);
  return segments[segments.length - 1] || "";
};

const collapsedKanbanSidebarConfig = buildPrimarySidebarConfig({
  content: null,
  collapsed: true,
  size: 0,
});

const OpsControlPage: React.FC = () => {
  const {
    primarySidebarCollapsed,
    primarySidebarWidth,
    setPrimarySidebarWidth,
    closePrimarySidebar,
  } = usePrimarySidebarState();
  const activeHomeTab = useAtomValue(opsControlHomeTabAtom);
  const currentRepo = useAtomValue(currentRepoAtom);
  const repoPath = currentRepo?.path ?? currentRepo?.fs_uri ?? "";
  const repoName = useMemo(() => {
    if (currentRepo?.name) return currentRepo.name;
    return getFolderName(repoPath) || "Project Manager";
  }, [currentRepo?.name, repoPath]);

  if (activeHomeTab === OPS_CONTROL_HOME_TAB.STORIES) {
    return (
      <OpsControlProjectsSurface
        repoPath={repoPath}
        repoName={repoName}
        primarySidebarCollapsed={primarySidebarCollapsed}
        primarySidebarWidth={primarySidebarWidth}
        setPrimarySidebarWidth={setPrimarySidebarWidth}
        closePrimarySidebar={closePrimarySidebar}
      />
    );
  }

  const mainContent = (
    <div className="ops-control-page flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <TaskKanban />
        <OpsControlTaskCreator />
      </div>
    </div>
  );

  return (
    <WorkStationShell
      primarySidebarConfig={collapsedKanbanSidebarConfig}
      content={mainContent}
      statusBar={null}
      appClassName="ops-control-workstation"
    />
  );
};

export default OpsControlPage;
