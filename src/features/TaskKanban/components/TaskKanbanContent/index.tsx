import React from "react";

import KanbanBoard from "@src/features/KanbanBoard";
import type {
  KanbanColumnConfig,
  KanbanTask,
  TaskStatus,
} from "@src/features/KanbanBoard";

import type { DiaryTimelineDisplayMode } from "../../config";
import DiaryView from "../DiaryView";
import type { FactoryViewMode } from "../FactoryViewPill";
import ListView from "../ListView";

export interface TaskKanbanContentProps {
  viewMode: FactoryViewMode;
  visibleTasks: KanbanTask[];
  diaryTasks: KanbanTask[];
  visibleColumns: readonly unknown[];
  selectedTaskId: string | null;
  detailPanelVisible: boolean;
  calendarDate: Date;
  diaryTimelineDisplayMode: DiaryTimelineDisplayMode;
  onTaskMove: (taskId: string, newStatus: TaskStatus) => void;
  onTaskClick: (task: KanbanTask) => void;
  onAddTask: () => void;
}

const TaskKanbanContent: React.FC<TaskKanbanContentProps> = ({
  viewMode,
  visibleTasks,
  diaryTasks,
  visibleColumns,
  selectedTaskId,
  detailPanelVisible,
  calendarDate,
  diaryTimelineDisplayMode,
  onTaskMove,
  onTaskClick,
  onAddTask,
}) => {
  switch (viewMode) {
    case "diary":
      return (
        <DiaryView
          tasks={diaryTasks}
          date={calendarDate}
          displayMode={diaryTimelineDisplayMode}
          onTaskClick={onTaskClick}
        />
      );
    case "list":
      return (
        <ListView
          tasks={visibleTasks}
          selectedTaskId={selectedTaskId}
          detailPanelVisible={detailPanelVisible}
          onTaskClick={onTaskClick}
        />
      );
    case "kanban":
    default:
      return (
        <KanbanBoard
          tasks={visibleTasks}
          columns={visibleColumns as unknown as KanbanColumnConfig[]}
          onTaskMove={onTaskMove}
          onTaskClick={onTaskClick}
          onAddTask={onAddTask}
          allowColumnReorder={false}
          allowTaskDrag
          showAddButton={false}
          selectedTaskId={detailPanelVisible ? selectedTaskId : null}
          className="kanban-board--linear"
        />
      );
  }
};

export default TaskKanbanContent;
