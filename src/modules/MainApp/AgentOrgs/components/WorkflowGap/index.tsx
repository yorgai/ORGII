import { useDroppable } from "@dnd-kit/core";
import cn from "classnames";
import { Plus } from "lucide-react";
import React from "react";

export interface WorkflowGapProps {
  index: number;
  nodeId: string | null;
  insertBeforeNodeId: string | null; // ID of node this gap is before (null = start)
  isHovered: boolean;
  isDragging: boolean;
  activeDropId: string | null;
  branchType?: "if-true" | "if-false" | "loop-body"; // For coloring the button
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onAddClick: () => void;
}

export const WorkflowGap: React.FC<WorkflowGapProps> = ({
  index,
  nodeId: _nodeId,
  insertBeforeNodeId,
  isHovered,
  isDragging,
  activeDropId: _activeDropId,
  branchType,
  onMouseEnter,
  onMouseLeave,
  onAddClick,
}) => {
  // Make this gap a droppable zone
  const gapId = `gap-${index}-${insertBeforeNodeId || "start"}`;
  const { setNodeRef, isOver: _isOver } = useDroppable({
    id: gapId,
    data: {
      type: "gap",
      insertBeforeNodeId,
      index,
    },
  });

  const showButton = isHovered && !isDragging;
  // ONLY show line when this specific gap is hovered (tracked by parent)
  const showLine = isHovered;

  // Get colors based on branch type
  const lineColorClass =
    branchType === "if-true"
      ? "bg-success-6"
      : branchType === "if-false"
        ? "bg-danger-6"
        : branchType === "loop-body"
          ? "bg-warning-6"
          : "bg-primary-6";

  const buttonColorClass =
    branchType === "if-true"
      ? "bg-success-6 hover:bg-success-6"
      : branchType === "if-false"
        ? "bg-danger-6 hover:bg-danger-6"
        : branchType === "loop-body"
          ? "bg-warning-6 hover:bg-warning-6"
          : "bg-primary-6 hover:bg-primary-7";

  return (
    <div
      ref={setNodeRef}
      className="group relative flex h-3 items-center"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Spacer for number column (left side) - 60px to match NUMBER_COLUMN_WIDTH */}
      <div className="w-[60px] shrink-0" />
      {/* Hover/drag line - shows on hover */}
      <div
        className={cn(
          "h-[3px] flex-1 rounded-full transition-all",
          isDragging && showLine
            ? "bg-text-2"
            : showLine
              ? lineColorClass
              : "bg-transparent"
        )}
      />
      {/* Add button column (right side) - 44px */}
      <div className="flex w-[44px] shrink-0 items-center justify-center">
        {showButton && (
          <button
            onClick={onAddClick}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full text-white shadow-md transition-transform hover:scale-110",
              buttonColorClass
            )}
          >
            <Plus size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
};
