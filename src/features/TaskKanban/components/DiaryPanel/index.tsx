import { Activity, CheckCircle2, PlayCircle } from "lucide-react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { CLI_AGENT } from "@src/api/types/keys";
import ModelIcon from "@src/components/ModelIcon";
import SessionHoverCard from "@src/components/SessionHoverCard";
import { resolveAgentIcon } from "@src/config/agentIcons";
import { SURFACE_TOKENS } from "@src/config/surfaceTokens";
import GanttChart from "@src/features/GanttChart";
import type {
  GanttMarker,
  GanttMarkerRow,
  GanttTask,
} from "@src/features/GanttChart";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import {
  getDispatchCategory,
  resolveSessionIconId,
} from "@src/util/session/sessionDispatch";

import {
  DIARY_TIMELINE_DISPLAY_MODE,
  type DiaryTimelineDisplayMode,
} from "../../config";
import {
  DIARY_EVENT_KIND,
  type DiaryDaySummary,
  type DiaryEventKind,
} from "../../utils/diaryUtils";
import { DiaryCommitBucketDropdown } from "./DiaryCommitDropdowns";
import {
  buildDiaryCommitMarkerRows,
  buildDiaryGanttTasks,
  formatDiaryGanttHeaderLabel,
  formatTime,
  getCommitBucketByMarkerId,
  getDiaryGanttRowId,
  isDiaryGanttHeaderEmphasized,
} from "./diaryPanelUtils";

// ============================================================================
// Types
// ============================================================================

type DiaryWorkIntervalTask = DiaryDaySummary["workIntervals"][number]["task"];

interface DiaryPanelProps {
  summary: DiaryDaySummary;
  displayMode: DiaryTimelineDisplayMode;
  commitsRowTitle: string;
  onEventClick?: (taskId: string) => void;
}

// ============================================================================
// Helpers
// ============================================================================

function getEventIcon(kind: DiaryEventKind): React.ReactNode {
  switch (kind) {
    case DIARY_EVENT_KIND.Completed:
      return <CheckCircle2 size={14} strokeWidth={1.8} />;
    case DIARY_EVENT_KIND.StillWorking:
      return <Activity size={14} strokeWidth={1.8} />;
    case DIARY_EVENT_KIND.Started:
    default:
      return <PlayCircle size={14} strokeWidth={1.8} />;
  }
}

function getEventLabelKey(kind: DiaryEventKind): string {
  switch (kind) {
    case DIARY_EVENT_KIND.Completed:
      return "opsControl.diary.event.completed";
    case DIARY_EVENT_KIND.StillWorking:
      return "opsControl.diary.event.stillWorking";
    case DIARY_EVENT_KIND.Started:
    default:
      return "opsControl.diary.event.started";
  }
}

function renderTaskAgentIcon(task: DiaryWorkIntervalTask): React.ReactNode {
  if (task.cliAgentType) {
    return <ModelIcon agentType={task.cliAgentType} size={13} />;
  }

  const sessionId = task.session_id ?? task.id;
  if (getDispatchCategory(sessionId) === "cursor_ide") {
    return <ModelIcon agentType={CLI_AGENT.CURSOR} size={13} />;
  }

  const iconId = task.agentIconId ?? resolveSessionIconId(sessionId);
  const TaskIcon = resolveAgentIcon(iconId);
  return <TaskIcon size={13} strokeWidth={1.75} />;
}

// ============================================================================
// Component
// ============================================================================

const DiaryPanel: React.FC<DiaryPanelProps> = ({
  summary,
  displayMode,
  commitsRowTitle,
  onEventClick,
}) => {
  const { t } = useTranslation("sessions");

  const ganttTasks = useMemo<GanttTask[]>(
    () => buildDiaryGanttTasks(summary),
    [summary]
  );
  const markerRows = useMemo<GanttMarkerRow[]>(
    () => buildDiaryCommitMarkerRows(summary, commitsRowTitle),
    [summary, commitsRowTitle]
  );
  const currentTime = new Date();

  if (summary.events.length === 0 && summary.commits.length === 0) {
    return (
      <aside className="flex h-full w-full flex-col">
        <Placeholder
          variant="empty"
          placement="sidebar"
          title={t("opsControl.diary.emptyTitle")}
          subtitle={t("opsControl.diary.emptySubtitle")}
        />
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-full flex-col">
      {displayMode === DIARY_TIMELINE_DISPLAY_MODE.Gantt ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="h-full overflow-hidden">
            <GanttChart
              key={summary.dayStart.toISOString()}
              tasks={ganttTasks}
              markerRows={markerRows}
              defaultViewScope="1d"
              initialDate={summary.dayStart}
              initialScrollTargetDate={currentTime}
              initialScrollTargetAlignment="center"
              showCurrentTimeMarker
              hideToolbar
              hideScrollbars
              transparentSurface
              periodScrollMultiplier={0}
              minColumnWidth={72}
              onTaskClick={(task) => {
                const interval = summary.workIntervals.find(
                  (candidate) => getDiaryGanttRowId(candidate) === task.id
                );
                if (interval) onEventClick?.(interval.task.id);
              }}
              showTooltips
              renderTooltipWrapper={(task, children) => (
                <SessionHoverCard
                  sessionId={task.sessionId}
                  position="right-start"
                  mouseEnterDelay={0}
                >
                  {children}
                </SessionHoverCard>
              )}
              renderMarkerTooltipWrapper={(
                marker: GanttMarker,
                _row,
                children
              ) => {
                const bucketCommits = getCommitBucketByMarkerId(
                  summary,
                  marker.id
                );
                if (bucketCommits.length === 0) return children;
                return (
                  <DiaryCommitBucketDropdown
                    bucketCommits={bucketCommits}
                    marker={marker}
                  >
                    {children}
                  </DiaryCommitBucketDropdown>
                );
              }}
              hideTimelineDateHeader
              transparentTimelineSurface
              showSidebarTaskIcons
              showSidebarAssigneeLabels={false}
              formatPrimaryHeaderLabel={formatDiaryGanttHeaderLabel}
              isPrimaryHeaderLabelEmphasized={isDiaryGanttHeaderEmphasized}
              editable={false}
            />
          </div>
        </div>
      ) : (
        <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto p-2">
          <div className="space-y-1.5">
            {summary.events.map((event) => {
              const label = t(getEventLabelKey(event.kind));
              const taskAgentIcon = renderTaskAgentIcon(event.task);

              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => onEventClick?.(event.task.id)}
                  className={`${SURFACE_TOKENS.surface} group flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left transition-colors hover:bg-fill-2`}
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-2 text-primary-6">
                    {getEventIcon(event.kind)}
                  </div>
                  <div className="shrink-0 text-[11px] text-text-3">
                    {formatTime(event.timestamp)}
                  </div>
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px]">
                    <span className="shrink-0 font-medium text-text-1">
                      {label}
                    </span>
                    {event.task.agentLabel && (
                      <>
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-text-2">
                          {taskAgentIcon}
                        </span>
                        <span className="shrink-0 font-medium text-text-1">
                          {event.task.agentLabel}
                        </span>
                      </>
                    )}
                    <span className="min-w-0 flex-1 truncate text-text-2 group-hover:text-text-1">
                      {event.task.title}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
};

export default DiaryPanel;
