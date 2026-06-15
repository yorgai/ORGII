import type { TFunction } from "i18next";
import { ListChevronsDownUp } from "lucide-react";
import React, { useCallback } from "react";

import { SessionFilterButton } from "../SessionFilterButton";
import { GROUP_BY_MODES, type GroupByMode } from "../types";
import type { WorkstationSidebarKey } from "./types";

interface UseSidebarBottomRightActionsParams {
  activeSidebarKey: WorkstationSidebarKey;
  groupByMode: GroupByMode;
  handleCollapseAll: () => void;
  handleCollapseAllActiveSections: () => void;
  handleMarkAllRead: () => void;
  handleRefreshSessions: () => void;
  onJoinSharedSession: () => void;
  setGroupByMode: (mode: GroupByMode) => void;
  t: TFunction<"navigation">;
}

export function useSidebarBottomRightActions({
  activeSidebarKey,
  groupByMode,
  handleCollapseAll,
  handleCollapseAllActiveSections,
  handleMarkAllRead,
  handleRefreshSessions,
  onJoinSharedSession,
  setGroupByMode,
  t,
}: UseSidebarBottomRightActionsParams): React.ReactNode {
  const handleSessionGroupBySelect = useCallback(
    (mode: string) => {
      if (!GROUP_BY_MODES.includes(mode as GroupByMode)) {
        return;
      }
      setGroupByMode(mode as GroupByMode);
    },
    [setGroupByMode]
  );

  if (activeSidebarKey === "projects") {
    return null;
  }

  if (activeSidebarKey === "folders") {
    const collapseAllLabel = t("sidebar.actions.collapseAll");
    return (
      <button
        type="button"
        title={collapseAllLabel}
        aria-label={collapseAllLabel}
        className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[100px] border-none bg-transparent p-0 transition-colors duration-150 hover:bg-fill-2"
        onClick={handleCollapseAllActiveSections}
      >
        <ListChevronsDownUp size={16} strokeWidth={2} className="text-text-2" />
      </button>
    );
  }
  return (
    <SessionFilterButton
      groupByMode={groupByMode}
      onSelect={handleSessionGroupBySelect}
      onCollapseAll={handleCollapseAll}
      onMarkAllRead={handleMarkAllRead}
      onRefreshSessions={handleRefreshSessions}
      onJoinSharedSession={onJoinSharedSession}
    />
  );
}
