import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import TabPill from "@src/components/TabPill";
import type { TabPillItem } from "@src/components/TabPill";
import { usePublishWorkstationTabHeader } from "@src/hooks/workStation";
import { WorkstationHeaderSectionSeparator } from "@src/modules/WorkStation/shared";

import DiaryDateControls from "../components/DiaryDateControls";
import FactoryViewPill, {
  type FactoryViewMode,
} from "../components/FactoryViewPill";
import KanbanHeaderFilters from "../components/KanbanHeaderFilters";
import KanbanHeaderTrailingControls from "../components/KanbanHeaderTrailingControls";
import {
  DIARY_TIMELINE_DISPLAY_MODE,
  type DiaryTimelineDisplayMode,
  type KanbanAutoArchiveTtl,
  type KanbanTimeFilter,
} from "../config";

export interface UseTaskKanbanHeaderOptions {
  viewMode: FactoryViewMode;
  calendarDate: Date;
  onCalendarDateChange: React.Dispatch<React.SetStateAction<Date>>;
  diaryTimelineDisplayMode: DiaryTimelineDisplayMode;
  onDiaryTimelineDisplayModeChange: (mode: DiaryTimelineDisplayMode) => void;
  worktreeSessionCount: number;
  onCompareWorktrees: () => void;
  autoArchiveTtl: KanbanAutoArchiveTtl;
  onAutoArchiveTtlChange: (ttl: KanbanAutoArchiveTtl) => void;
  timeFilter: KanbanTimeFilter;
  onTimeFilterChange: (filter: KanbanTimeFilter) => void;
  hidden: boolean;
}

export function useTaskKanbanHeader({
  viewMode,
  calendarDate,
  onCalendarDateChange,
  diaryTimelineDisplayMode,
  onDiaryTimelineDisplayModeChange,
  worktreeSessionCount,
  onCompareWorktrees,
  autoArchiveTtl,
  onAutoArchiveTtlChange,
  timeFilter,
  onTimeFilterChange,
  hidden,
}: UseTaskKanbanHeaderOptions): void {
  const { t } = useTranslation("sessions");

  const diaryModeTabs = useMemo<TabPillItem[]>(
    () => [
      {
        key: DIARY_TIMELINE_DISPLAY_MODE.Timeline,
        label: t("kanban.diary.timelineMode.timeline"),
      },
      {
        key: DIARY_TIMELINE_DISPLAY_MODE.Gantt,
        label: t("kanban.diary.timelineMode.gantt"),
      },
    ],
    [t]
  );

  const diaryControls = useMemo(() => {
    if (viewMode !== "diary") return null;
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <TabPill
          activeTab={diaryTimelineDisplayMode}
          tabs={diaryModeTabs}
          onChange={(key) =>
            onDiaryTimelineDisplayModeChange(key as DiaryTimelineDisplayMode)
          }
          variant="pill"
          color="fill"
          fillWidth={false}
          size="small"
        />
        <WorkstationHeaderSectionSeparator className="mx-1" />
        <DiaryDateControls
          date={calendarDate}
          onDateChange={onCalendarDateChange}
        />
      </div>
    );
  }, [
    calendarDate,
    diaryModeTabs,
    diaryTimelineDisplayMode,
    onCalendarDateChange,
    onDiaryTimelineDisplayModeChange,
    viewMode,
  ]);

  const headerTrailing = useMemo(() => {
    if (viewMode === "diary") return null;
    return (
      <KanbanHeaderTrailingControls
        worktreeSessionCount={worktreeSessionCount}
        onCompareWorktrees={onCompareWorktrees}
        autoArchiveTtl={autoArchiveTtl}
        onAutoArchiveTtlChange={onAutoArchiveTtlChange}
        timeFilter={timeFilter}
        onTimeFilterChange={onTimeFilterChange}
      />
    );
  }, [
    autoArchiveTtl,
    onAutoArchiveTtlChange,
    onCompareWorktrees,
    onTimeFilterChange,
    timeFilter,
    viewMode,
    worktreeSessionCount,
  ]);

  const headerContent = useMemo(() => {
    if (viewMode === "diary") {
      return {
        leading: <FactoryViewPill />,
        trailing: diaryControls,
        sidebarToggleDisabled: true,
      };
    }
    return {
      leading: <FactoryViewPill />,
      trailing: (
        <div className="flex min-w-0 items-center gap-1 overflow-visible">
          <KanbanHeaderFilters />
          {headerTrailing}
        </div>
      ),
      sidebarToggleDisabled: true,
    };
  }, [diaryControls, headerTrailing, viewMode]);

  usePublishWorkstationTabHeader({
    host: "kanban",
    content: headerContent,
    enabled: !hidden,
  });
}
