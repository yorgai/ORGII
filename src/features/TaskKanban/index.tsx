/**
 * Kanban Page
 *
 * Independent session board — NOT linked to a specific repo or session.
 * Shows ALL sessions (both OS Agent and coding) grouped by status columns.
 *
 * Time filter pills (6h | 12h | 24h | 3d | 7d):
 * - All columns stay visible
 * - Sessions older than the selected window are filtered out
 *
 * View mode (kanban / diary) is driven by the `?view=` URL search param,
 * toggled from the Ops Control Workstation header tabs.
 */
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Plus } from "lucide-react";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import {
  OPS_CONTROL_SESSION_PREVIEW_OVERLAY_CLASS,
  OPS_CONTROL_SESSION_PREVIEW_SURFACE_CLASS,
} from "@src/config/opsControlCardTokens";
import type { KanbanTask, TaskStatus } from "@src/features/KanbanBoard";
import { agentKanbanCreatorVisibleAtom } from "@src/store/ui/agentKanbanCreatorAtom";
import { kanbanReplayModeAtom } from "@src/store/ui/kanbanReplayAtom";
import {
  kanbanAgentTypeFilterAtom,
  kanbanAutoArchiveTtlAtom,
  kanbanDetailPanelVisibleAtom,
  kanbanManualFinishedSessionIdsAtom,
  kanbanSelectedTaskIdAtom,
  kanbanSidebarFilterAtom,
  kanbanTimeFilterAtom,
} from "@src/store/ui/kanbanViewStateAtom";
import { openWorktreeCompareWindow } from "@src/util/ui/window/windowManager";

import { parseFactoryViewMode } from "./components/FactoryViewPill";
import TaskKanbanReplayBar from "./components/KanbanReplayBar";
import KanbanReplayStatusPill from "./components/KanbanReplayStatusPill";
import TaskDetailPanel from "./components/TaskDetailPanel";
import TaskKanbanContent from "./components/TaskKanbanContent";
import {
  type AgentKanbanColumnId,
  DIARY_TIMELINE_DISPLAY_MODE,
  type DiaryTimelineDisplayMode,
  type KanbanTimeFilter,
} from "./config";
import { useKanbanTasks } from "./hooks/useKanbanTasks";
import { useTaskKanbanFilters } from "./hooks/useTaskKanbanFilters";
import { useTaskKanbanHeader } from "./hooks/useTaskKanbanHeader";
import {
  beginKanbanHorizontalScrollGuard,
  resetKanbanHorizontalScroll,
} from "./utils/scrollGuard";

export interface TaskKanbanProps {
  /**
   * Restrict the board to a subset of session IDs. When set, routines are
   * also hidden (they're a global concern). Used by org-scoped embeds.
   */
  sessionIdFilter?: ReadonlySet<string>;
  /**
   * Hide the "New Session" button in the bottom dock. The dock itself
   * still renders (same height + top border) so the layout matches the
   * global Ops Control view — embedders that own their own composer
   * (e.g. the Inbox `OrgChatPanel`) just don't want a duplicate trigger
   * here.
   */
  hideAddSessionButton?: boolean;
  /**
   * Suppress publishing Ops Control controls into the Workstation 40px header.
   * Embeds that render their own header — e.g. the Inbox `OrgChatPanel`
   * merges the time-filter pills into its own sub-tab row — pass `true`.
   * When hidden, callers must supply `timeFilter` + `onTimeFilterChange`
   * if they still need user-controlled time filtering.
   */
  hideHeader?: boolean;
  /**
   * Controlled time filter. If `onTimeFilterChange` is also provided,
   * the component is fully controlled (caller owns the state). If only
   * `timeFilter` is provided, it's used as the initial value.
   */
  timeFilter?: KanbanTimeFilter;
  onTimeFilterChange?: (filter: KanbanTimeFilter) => void;
}

const Kanban: React.FC<TaskKanbanProps> = ({
  sessionIdFilter,
  hideAddSessionButton = false,
  hideHeader = false,
  timeFilter: controlledTimeFilter,
  onTimeFilterChange,
}) => {
  const { t } = useTranslation("sessions");
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);

  const [selectedTaskId, setSelectedTaskId] = useAtom(kanbanSelectedTaskIdAtom);
  const [detailPanelVisible, setDetailPanelVisible] = useAtom(
    kanbanDetailPanelVisibleAtom
  );
  const [internalTimeFilter, setInternalTimeFilter] =
    useAtom(kanbanTimeFilterAtom);
  const sidebarFilter = useAtomValue(kanbanSidebarFilterAtom);
  const agentTypeFilter = useAtomValue(kanbanAgentTypeFilterAtom);
  const [autoArchiveTtl, setAutoArchiveTtl] = useAtom(kanbanAutoArchiveTtlAtom);
  const setManualFinishedSessionIds = useSetAtom(
    kanbanManualFinishedSessionIdsAtom
  );
  const [creatorVisible, setCreatorVisible] = useAtom(
    agentKanbanCreatorVisibleAtom
  );
  const kanbanReplayMode = useAtomValue(kanbanReplayModeAtom);

  const isControlled = onTimeFilterChange !== undefined;
  const timeFilter = isControlled
    ? (controlledTimeFilter ?? "12h")
    : internalTimeFilter;
  const setTimeFilter = useCallback(
    (next: KanbanTimeFilter) => {
      if (isControlled) {
        onTimeFilterChange(next);
      } else {
        setInternalTimeFilter(next);
      }
    },
    [isControlled, onTimeFilterChange, setInternalTimeFilter]
  );

  const viewMode = parseFactoryViewMode(location.search);
  const showReplayControls = viewMode === "kanban";
  const [calendarDate, setCalendarDate] = useState<Date>(() => new Date());
  const [diaryTimelineDisplayMode, setDiaryTimelineDisplayMode] =
    useState<DiaryTimelineDisplayMode>(DIARY_TIMELINE_DISPLAY_MODE.Gantt);

  const { tasks, allTasks } = useKanbanTasks({
    timeFilter,
    autoArchiveTtl,
    sessionIdFilter,
  });

  const {
    sessionMap,
    visibleTasks,
    visibleDiaryTasks,
    visibleColumns,
    selectedTask,
  } = useTaskKanbanFilters({
    tasks,
    diaryTasks: allTasks,
    sidebarFilter,
    agentTypeFilter,
    selectedTaskId,
  });

  const handlePointerDownCapture = useCallback((event: React.PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest(".kanban-task-card") ||
      target.closest(".kanban-session-preview-overlay")
    ) {
      beginKanbanHorizontalScrollGuard();
    }
  }, []);

  const handleTaskClick = useCallback(
    (task: KanbanTask) => {
      setSelectedTaskId(task.id);
      setDetailPanelVisible(true);
      setCreatorVisible(false);
      beginKanbanHorizontalScrollGuard();
    },
    [setCreatorVisible, setDetailPanelVisible, setSelectedTaskId]
  );

  const handleCloseDetailPanel = useCallback(() => {
    setDetailPanelVisible(false);
    setSelectedTaskId(null);
    resetKanbanHorizontalScroll();
  }, [setDetailPanelVisible, setSelectedTaskId]);

  const handleNavigateTask = useCallback(
    (direction: "prev" | "next") => {
      if (!selectedTaskId) return;
      const currentIndex = visibleTasks.findIndex(
        (task) => task.id === selectedTaskId
      );
      if (currentIndex === -1) return;

      const newIndex =
        direction === "prev" ? currentIndex - 1 : currentIndex + 1;
      if (newIndex >= 0 && newIndex < visibleTasks.length) {
        setSelectedTaskId(visibleTasks[newIndex].id);
        resetKanbanHorizontalScroll();
      }
    },
    [selectedTaskId, visibleTasks, setSelectedTaskId]
  );

  const taskNavigation = useMemo(() => {
    if (!selectedTaskId) return { hasPrev: false, hasNext: false };
    const currentIndex = visibleTasks.findIndex(
      (task) => task.id === selectedTaskId
    );
    return {
      hasPrev: currentIndex > 0,
      hasNext: currentIndex < visibleTasks.length - 1,
    };
  }, [selectedTaskId, visibleTasks]);

  const handleAddTask = useCallback(() => {
    setCreatorVisible(true);
  }, [setCreatorVisible]);

  React.useLayoutEffect(() => {
    resetKanbanHorizontalScroll();
  }, [detailPanelVisible, selectedTaskId]);

  const worktreeSessionIds = useMemo(() => {
    return visibleTasks
      .filter((task) => {
        const session = task.session_id
          ? sessionMap.get(task.session_id)
          : null;
        return session?.worktreeBranch != null;
      })
      .map((task) => task.session_id)
      .filter((id): id is string => Boolean(id));
  }, [visibleTasks, sessionMap]);

  const compareRepoPath = useMemo(() => {
    const firstId = worktreeSessionIds[0];
    if (!firstId) return undefined;
    const session = sessionMap.get(firstId);
    return session?.worktreePath ?? session?.repoPath ?? undefined;
  }, [worktreeSessionIds, sessionMap]);

  const handleCompareWorktrees = useCallback(() => {
    if (worktreeSessionIds.length < 2) return;
    openWorktreeCompareWindow(worktreeSessionIds, {
      repoPath: compareRepoPath,
      title: `Compare ${worktreeSessionIds.length} Worktrees`,
    }).catch((err: unknown) => {
      console.error("[TaskKanban] failed to open compare window:", err);
    });
  }, [worktreeSessionIds, compareRepoPath]);

  const handleTaskMove = useCallback(
    (taskId: string, newStatus: TaskStatus) => {
      const targetStatus = newStatus as AgentKanbanColumnId;
      setManualFinishedSessionIds((previousIds) => {
        const nextIds = previousIds.filter(
          (existingId) => existingId !== taskId
        );
        if (targetStatus === "finished") {
          return [taskId, ...nextIds].slice(0, 1000);
        }
        return nextIds;
      });
      if (selectedTaskId === taskId && targetStatus === "finished") {
        setDetailPanelVisible(false);
        setSelectedTaskId(null);
      }
    },
    [
      selectedTaskId,
      setDetailPanelVisible,
      setManualFinishedSessionIds,
      setSelectedTaskId,
    ]
  );

  useTaskKanbanHeader({
    viewMode,
    calendarDate,
    onCalendarDateChange: setCalendarDate,
    diaryTimelineDisplayMode,
    onDiaryTimelineDisplayModeChange: setDiaryTimelineDisplayMode,
    worktreeSessionCount: worktreeSessionIds.length,
    onCompareWorktrees: handleCompareWorktrees,
    autoArchiveTtl,
    onAutoArchiveTtlChange: setAutoArchiveTtl,
    timeFilter,
    onTimeFilterChange: setTimeFilter,
    hidden: hideHeader,
  });

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 flex flex-col overflow-hidden"
      onPointerDownCapture={handlePointerDownCapture}
    >
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <TaskKanbanContent
          viewMode={viewMode}
          visibleTasks={visibleTasks}
          diaryTasks={visibleDiaryTasks}
          visibleColumns={visibleColumns}
          selectedTaskId={selectedTaskId}
          detailPanelVisible={detailPanelVisible}
          calendarDate={calendarDate}
          diaryTimelineDisplayMode={diaryTimelineDisplayMode}
          onTaskMove={handleTaskMove}
          onTaskClick={handleTaskClick}
          onAddTask={handleAddTask}
        />

        {showReplayControls && (
          <div className="pointer-events-none absolute bottom-2 left-0 right-0 z-30 flex justify-center px-2">
            <div className="pointer-events-auto flex w-max max-w-full items-center gap-1.5">
              <KanbanReplayStatusPill />
              {!hideAddSessionButton && !creatorVisible && (
                <button
                  type="button"
                  onClick={handleAddTask}
                  aria-label={t("chat.newSession")}
                  title={t("chat.newSession")}
                  className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-bg-1 text-text-2 shadow-md ring-1 ring-border-2 transition-colors hover:text-text-1"
                >
                  <Plus size={16} strokeWidth={1.75} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {showReplayControls && kanbanReplayMode !== "follow" && (
        <div className="relative z-[1200] shrink-0 overflow-visible border-t border-border-2">
          <TaskKanbanReplayBar />
        </div>
      )}

      <div
        aria-hidden
        className="pointer-events-none h-10 shrink-0 overflow-visible border-t border-border-2"
      />

      {detailPanelVisible && (
        <div
          className={`${OPS_CONTROL_SESSION_PREVIEW_OVERLAY_CLASS} kanban-session-preview-overlay`}
        >
          <div className={OPS_CONTROL_SESSION_PREVIEW_SURFACE_CLASS}>
            <TaskDetailPanel
              visible={detailPanelVisible}
              task={selectedTask}
              onClose={handleCloseDetailPanel}
              onNavigate={handleNavigateTask}
              hasPrev={taskNavigation.hasPrev}
              hasNext={taskNavigation.hasNext}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default Kanban;
