import cn from "classnames";
import { ListEnd } from "lucide-react";
import React from "react";

import {
  type FlatWorkflowNode,
  getEndBlockColor,
  getEndBlockText,
} from "../../utils/flattenWorkflow";
import { WorkflowGap } from "../WorkflowGap";
import { INDENT_PX } from "./constants";

export interface EndBlockNodeProps {
  node: FlatWorkflowNode;
  nodeIndex: number;
  leftIndent: number;
  nextNode?: FlatWorkflowNode;
  isDragActive: boolean;
  activeDropId: string | null;
  hoveredGapIndex: number | null;
  onSetHoveredGapIndex: (index: number | null) => void;
  onAddAction: (afterNodeId: string | null, depth: number) => void;
}

export const EndBlockNode: React.FC<EndBlockNodeProps> = ({
  node,
  nodeIndex,
  leftIndent: _leftIndent,
  nextNode,
  isDragActive,
  activeDropId,
  hoveredGapIndex,
  onSetHoveredGapIndex,
  onAddAction,
}) => {
  const endText = node.endType ? getEndBlockText(node.endType) : "";
  const colorClass = node.endType
    ? getEndBlockColor(node.endType)
    : "text-text-3";

  const parentDepth = node.depth - 1;
  const gapAfterIndex = nodeIndex * 2 + 1;
  const parentIndent = parentDepth * INDENT_PX;

  return (
    <div className="relative">
      <div className="flex h-3 items-center">
        <div style={{ width: `${parentIndent}px` }} className="shrink-0" />

        <div className="w-[60px] shrink-0" />

        <div className="flex items-center gap-1">
          <ListEnd size={14} className={cn("shrink-0", colorClass)} />
          <div
            className={cn(
              "whitespace-nowrap rounded px-2 py-[2px] text-[14px] font-medium",
              colorClass
            )}
          >
            {endText}
          </div>
        </div>

        <div className="ml-2 h-[1px] flex-1 bg-border-2" />

        <div className="w-[44px] shrink-0" />
      </div>

      <div style={{ paddingLeft: `${parentDepth * INDENT_PX}px` }}>
        <WorkflowGap
          index={gapAfterIndex}
          nodeId={node.id}
          insertBeforeNodeId={nextNode?.type === "action" ? nextNode.id : null}
          isHovered={hoveredGapIndex === gapAfterIndex}
          isDragging={isDragActive}
          activeDropId={activeDropId}
          branchType={node.branchType}
          onMouseEnter={() => onSetHoveredGapIndex(gapAfterIndex)}
          onMouseLeave={() => onSetHoveredGapIndex(null)}
          onAddClick={() => onAddAction(node.id, parentDepth)}
        />
      </div>
    </div>
  );
};
