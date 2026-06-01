import cn from "classnames";
import { ChevronDown, ChevronRight } from "lucide-react";
import React from "react";

import type { FlatWorkflowNode } from "../../utils/flattenWorkflow";
import {
  getBranchLabelColor,
  getBranchLabelText,
} from "../../utils/flattenWorkflow";
import { EmptyBranchPlaceholder } from "./EmptyBranchPlaceholder";
import { INDENT_PX } from "./constants";

export interface BranchLabelNodeProps {
  node: FlatWorkflowNode;
  nodeIndex: number;
  leftIndent: number;
  isBranchEmpty: boolean;
  isCollapsed: boolean;
  actionCount: number;
  onToggleCollapse: () => void;
  isDragActive: boolean;
  hoveredGapIndex: number | null;
  onSetHoveredGapIndex: (index: number | null) => void;
  onAddToBranchEnd: (parentId: string, branchType: string) => void;
}

export const BranchLabelNode: React.FC<BranchLabelNodeProps> = ({
  node,
  nodeIndex,
  leftIndent,
  isBranchEmpty,
  isCollapsed,
  actionCount,
  onToggleCollapse,
  isDragActive,
  hoveredGapIndex,
  onSetHoveredGapIndex,
  onAddToBranchEnd,
}) => {
  if (!node.labelType || !node.parentActionId) return null;

  const labelText = getBranchLabelText(node.labelType, node.depth);
  const colorClass = getBranchLabelColor(node.labelType);
  const ChevronIcon = isCollapsed ? ChevronRight : ChevronDown;

  const parentIndent = (node.depth - 1) * INDENT_PX;

  return (
    <div className={cn("relative", isCollapsed && "mb-4")}>
      <div className="group flex h-3 items-center">
        <div style={{ width: `${parentIndent}px` }} className="shrink-0" />

        <div className="w-[60px] shrink-0" />

        <button
          onClick={onToggleCollapse}
          className="flex items-center gap-1 hover:opacity-70"
        >
          <ChevronIcon size={14} className={cn("shrink-0", colorClass)} />
          <div
            className={cn(
              "whitespace-nowrap rounded px-2 py-[2px] text-[14px] font-medium",
              colorClass
            )}
          >
            {labelText}
          </div>
          {actionCount > 0 && (
            <span className="ml-1 text-[14px] text-text-3">
              ({actionCount} {actionCount === 1 ? "action" : "actions"})
            </span>
          )}
        </button>

        <div className="ml-2 h-[1px] flex-1 bg-border-2" />

        <div className="w-[44px] shrink-0" />
      </div>

      {isBranchEmpty && !isCollapsed && (
        <EmptyBranchPlaceholder
          leftIndent={leftIndent}
          labelType={node.labelType}
          gapIndex={nodeIndex * 2 + 1}
          isDragging={isDragActive}
          hoveredGapIndex={hoveredGapIndex}
          onSetHoveredGapIndex={onSetHoveredGapIndex}
          onAdd={() => onAddToBranchEnd(node.parentActionId!, node.labelType!)}
        />
      )}
    </div>
  );
};
