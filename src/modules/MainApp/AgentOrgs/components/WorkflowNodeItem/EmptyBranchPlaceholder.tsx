import cn from "classnames";
import { Plus } from "lucide-react";
import React from "react";

interface EmptyBranchPlaceholderProps {
  leftIndent: number;
  labelType: string;
  gapIndex: number;
  isDragging: boolean;
  hoveredGapIndex: number | null;
  onSetHoveredGapIndex: (index: number | null) => void;
  onAdd: () => void;
}

export const EmptyBranchPlaceholder: React.FC<EmptyBranchPlaceholderProps> = ({
  leftIndent,
  labelType,
  gapIndex,
  isDragging,
  hoveredGapIndex,
  onSetHoveredGapIndex,
  onAdd,
}) => {
  const branchType =
    labelType === "if-true"
      ? ("if-true" as const)
      : labelType === "if-false"
        ? ("if-false" as const)
        : ("loop-body" as const);

  const isHovered = hoveredGapIndex === gapIndex;

  const lineColorClass =
    branchType === "if-true"
      ? "bg-success-6"
      : branchType === "if-false"
        ? "bg-danger-6"
        : "bg-warning-6";

  return (
    <div
      style={{ paddingLeft: `${leftIndent}px` }}
      onMouseEnter={() => onSetHoveredGapIndex(gapIndex)}
      onMouseLeave={() => onSetHoveredGapIndex(null)}
    >
      <div className="group flex h-12 items-center">
        <div className="w-[60px] shrink-0" />

        <div className="flex flex-1 items-center gap-2">
          <span className="whitespace-nowrap text-[13px] text-text-3">
            No actions
          </span>

          <div
            className={cn(
              "h-[3px] flex-1 rounded-full transition-all",
              isDragging && isHovered
                ? "bg-text-2"
                : isHovered
                  ? lineColorClass
                  : "bg-transparent"
            )}
          />
        </div>

        <div className="flex w-[44px] shrink-0 items-center justify-center">
          {isHovered && !isDragging && (
            <button
              onClick={onAdd}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-white shadow-md transition-transform hover:scale-110",
                branchType === "if-true"
                  ? "bg-success-6 hover:bg-success-6"
                  : branchType === "if-false"
                    ? "bg-danger-6 hover:bg-danger-6"
                    : "bg-warning-6 hover:bg-warning-6"
              )}
            >
              <Plus size={14} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
