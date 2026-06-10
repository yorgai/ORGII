/**
 * KanbanColumn Component
 *
 * Column container for Kanban tasks with drag-and-drop support using dnd-kit.
 * Displays tasks grouped by status.
 */
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import cn from "classnames";
import { Plus } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import {
  COUNT_BADGE,
  HEADER_BUTTON,
  HEADER_ICON_SIZE,
  getCountBadgeSizeClass,
} from "@src/config/workstation/tokens";
import { getUiScaleFromCssVar } from "@src/lib/dndKit";
import { Placeholder } from "@src/modules/shared/layouts/blocks";

import type { KanbanColumnConfig, KanbanTask } from "../../types";
import TaskCard from "../TaskCard";
import "./index.scss";

// Drop indicator state type
interface DropIndicatorState {
  columnId: string | null;
  beforeTaskId: string | null;
}

interface ScrollEdgeState {
  atTop: boolean;
  atBottom: boolean;
}

export interface KanbanColumnProps {
  column: KanbanColumnConfig;
  tasks: KanbanTask[];
  onTaskClick?: (task: KanbanTask) => void;
  onAddTask?: (status: string) => void;
  isDragging?: boolean;
  showAddButton?: boolean;
  allowColumnDrag?: boolean;
  allowTaskDrag?: boolean;
  scaleDragTransform?: boolean;
  useDragOverlay?: boolean;
  /** ID of the task currently being dragged (null if dragging a column or nothing) */
  activeTaskId?: string | null;
  /** ID of the task whose preview panel is currently open (null if none) */
  selectedTaskId?: string | null;
  /** Drop indicator position for this column */
  dropIndicator?: DropIndicatorState | null;
}

const KanbanColumn: React.FC<KanbanColumnProps> = ({
  column,
  tasks,
  onTaskClick,
  onAddTask,
  isDragging,
  showAddButton = true,
  allowColumnDrag = true,
  allowTaskDrag = true,
  scaleDragTransform = true,
  useDragOverlay = true,
  activeTaskId,
  selectedTaskId,
  dropIndicator,
}) => {
  const { t } = useTranslation();
  const Icon = column.icon;

  // Sortable hook for column dragging
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({
    id: column.id,
    disabled: !allowColumnDrag,
  });

  // Droppable hook for receiving tasks
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: column.id,
  });
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [scrollEdges, setScrollEdges] = useState<ScrollEdgeState>({
    atTop: true,
    atBottom: true,
  });
  const updateScrollEdges = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
    const nextEdges = {
      atTop: body.scrollTop <= 1,
      atBottom: body.scrollTop >= maxScrollTop - 1,
    };
    setScrollEdges((previousEdges) =>
      previousEdges.atTop === nextEdges.atTop &&
      previousEdges.atBottom === nextEdges.atBottom
        ? previousEdges
        : nextEdges
    );
  }, []);
  const setBodyNode = useCallback(
    (node: HTMLDivElement | null) => {
      bodyRef.current = node;
      setDroppableRef(node);
      updateScrollEdges();
    },
    [setDroppableRef, updateScrollEdges]
  );

  // Get filtered tasks (excluding the actively dragged task)
  const filteredTasks = useMemo(
    () => tasks.filter((task) => task.id !== activeTaskId),
    [tasks, activeTaskId]
  );

  // Get task IDs for SortableContext
  const taskIds = useMemo(
    () => filteredTasks.map((task) => task.id),
    [filteredTasks]
  );

  useEffect(() => {
    updateScrollEdges();
  }, [filteredTasks.length, showAddButton, updateScrollEdges]);

  // Check if we should show indicator at end of column (when beforeTaskId is null)
  const showEndIndicator =
    dropIndicator?.columnId === column.id &&
    dropIndicator?.beforeTaskId === null;

  // Apply UI scale correction when the consumer opts into it.
  const uiScale = scaleDragTransform ? getUiScaleFromCssVar() : 1;
  const correctedTransform = transform
    ? {
        ...transform,
        x: transform.x / uiScale,
        y: transform.y / uiScale,
      }
    : null;

  const columnStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(correctedTransform),
    transition,
    opacity: isSortableDragging ? 0.5 : 1,
  };
  const countTextColor =
    column.id === "planned" ? "var(--color-text-1)" : "var(--color-text-white)";

  const handleAddTask = () => {
    onAddTask?.(column.id);
  };

  return (
    <div
      ref={setSortableRef}
      style={columnStyle}
      className={cn("kanban-column", {
        "kanban-column--dragging": isDragging || isSortableDragging,
        "kanban-column--receiving": isOver || dropIndicator !== null,
      })}
    >
      {/* Column Header - Draggable handle (only when allowColumnDrag is
       * true, otherwise no grab cursor / no listeners). */}
      <div
        className={cn("kanban-column__header", {
          "kanban-column__header--draggable": allowColumnDrag,
        })}
        {...(allowColumnDrag ? attributes : {})}
        {...(allowColumnDrag ? listeners : {})}
      >
        <div className="kanban-column__header-left">
          <div className="kanban-column__icon" style={{ color: column.color }}>
            <Icon size={16} />
          </div>
          <div className="kanban-column__title">
            {/* `column.title` is the source of truth for the header label.
             * It must be an i18n key (optionally namespace-prefixed, e.g.
             * "sessions:opsControl.boardColumns.todo"). i18next returns the key
             * unchanged when no translation is found, so plain strings still
             * render correctly — but every consumer should pass a key so
             * locale switching works. */}
            {t(column.title)}
          </div>
          <span
            className={`kanban-column__count ${COUNT_BADGE.base} ${getCountBadgeSizeClass(tasks.length)}`}
            style={{ backgroundColor: column.color, color: countTextColor }}
          >
            {tasks.length}
          </span>
        </div>
        {showAddButton && (
          <button
            type="button"
            className={`kanban-column__add-btn ${HEADER_BUTTON.actionTreeRow}`}
            onClick={handleAddTask}
          >
            <Plus size={HEADER_ICON_SIZE.sm} />
          </button>
        )}
      </div>

      {/* Column Body - Droppable Area */}
      <div
        ref={setBodyNode}
        className={cn("kanban-column__body", {
          "kanban-column__body--dragging-over":
            isOver || dropIndicator !== null,
          "kanban-column__body--at-top": scrollEdges.atTop,
          "kanban-column__body--at-bottom": scrollEdges.atBottom,
        })}
        onScroll={updateScrollEdges}
      >
        <SortableContext
          items={taskIds}
          strategy={verticalListSortingStrategy}
          disabled={!allowTaskDrag}
        >
          {filteredTasks.length === 0 && !showEndIndicator ? (
            <Placeholder variant="empty" title={t("placeholders.noTasks")} />
          ) : (
            <>
              {filteredTasks.map((task) => (
                <SortableTaskCard
                  key={task.id}
                  task={task}
                  onTaskClick={onTaskClick}
                  showIndicatorBefore={dropIndicator?.beforeTaskId === task.id}
                  indicatorColor={column.color}
                  allowDrag={allowTaskDrag}
                  scaleDragTransform={scaleDragTransform}
                  useDragOverlay={useDragOverlay}
                  isSelected={
                    selectedTaskId != null && task.id === selectedTaskId
                  }
                />
              ))}
              {/* End of column indicator (when dropping on empty area) */}
              {showEndIndicator && <DropIndicatorLine color={column.color} />}
            </>
          )}
        </SortableContext>
      </div>
    </div>
  );
};

// ============================================
// DropIndicatorLine - Visual drop position indicator
// ============================================

interface DropIndicatorLineProps {
  color: string;
}

const DropIndicatorLine: React.FC<DropIndicatorLineProps> = ({ color }) => {
  return (
    <div className="kanban-drop-indicator">
      <div
        className="kanban-drop-indicator__dot"
        style={{ backgroundColor: color }}
      />
      <div
        className="kanban-drop-indicator__line"
        style={{ backgroundColor: color }}
      />
      <div
        className="kanban-drop-indicator__dot"
        style={{ backgroundColor: color }}
      />
    </div>
  );
};

// ============================================
// SortableTaskCard - Inner sortable wrapper
// ============================================

interface SortableTaskCardProps {
  task: KanbanTask;
  onTaskClick?: (task: KanbanTask) => void;
  showIndicatorBefore?: boolean;
  indicatorColor?: string;
  allowDrag?: boolean;
  scaleDragTransform?: boolean;
  useDragOverlay?: boolean;
  isSelected?: boolean;
}

const SortableTaskCard: React.FC<SortableTaskCardProps> = ({
  task,
  onTaskClick,
  showIndicatorBefore,
  indicatorColor = "var(--color-primary-6)",
  allowDrag = true,
  scaleDragTransform = true,
  useDragOverlay = true,
  isSelected = false,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: !allowDrag });

  // Apply UI scale correction when the consumer opts into it.
  const uiScale = scaleDragTransform ? getUiScaleFromCssVar() : 1;
  const correctedTransform = transform
    ? {
        ...transform,
        x: transform.x / uiScale,
        y: transform.y / uiScale,
      }
    : null;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(correctedTransform),
    transition: transition || "transform 200ms ease",
    opacity: useDragOverlay && isDragging ? 0 : 1,
    zIndex: isDragging ? 999 : "auto",
  };

  return (
    <>
      {/* Drop indicator BEFORE this task */}
      {showIndicatorBefore && <DropIndicatorLine color={indicatorColor} />}
      <div
        ref={setNodeRef}
        style={style}
        className={cn("kanban-task-wrapper", {
          "kanban-task-wrapper--overlay-dragging": useDragOverlay && isDragging,
          "kanban-task-wrapper--source-dragging": !useDragOverlay && isDragging,
        })}
        {...(allowDrag ? attributes : {})}
        {...(allowDrag ? listeners : {})}
      >
        <TaskCard
          task={task}
          onClick={onTaskClick}
          isDragging={isDragging}
          isSelected={isSelected}
        />
      </div>
    </>
  );
};

export default KanbanColumn;
