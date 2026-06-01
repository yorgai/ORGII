/**
 * WorkflowNodeItem Component
 *
 * Unified renderer for all workflow node types in the flat list:
 * - action: Draggable command card with ghost lines
 * - branch-label: Visual separator (IF TRUE, IF FALSE, LOOP BODY)
 * - end-block: Visual closer (END IF, END LOOP) with ghost line after
 *
 * Uses depth-based indentation for consistent visual hierarchy.
 */
import React from "react";

import type { ActionDefinition } from "../../data";
import type { FlatWorkflowNode } from "../../utils/flattenWorkflow";
import type { SpotlightData } from "../CommandCard/types";
import { ActionNode } from "./ActionNode";
import { BranchLabelNode } from "./BranchLabelNode";
import { EndBlockNode } from "./EndBlockNode";
import { INDENT_PX } from "./constants";

export interface WorkflowNodeItemProps {
  node: FlatWorkflowNode;
  nodeIndex: number;
  globalIndex: number;
  definitions: ActionDefinition[];
  uiScale: number;
  spotlightData: SpotlightData;
  isFirstNode?: boolean;
  prevNode?: FlatWorkflowNode;
  isDragActive?: boolean;
  activeDropId?: string | null;
  hoveredGapIndex: number | null;
  onSetHoveredGapIndex: (index: number | null) => void;
  isLastInBranch?: boolean;
  nextNode?: FlatWorkflowNode;
  nextNodeDepth?: number;
  collapsedBranches: Set<string>;
  onToggleCollapse: (branchId: string) => void;
  branchActionCounts: Map<string, number>;
  onUpdateAction: (
    instanceId: string,
    newData: Record<string, unknown>
  ) => void;
  onRemoveAction: (instanceId: string) => void;
  onActionClick: (instanceId: string) => void;
  onAddAction: (
    afterNodeId: string | null,
    depth: number,
    insertBeforeNodeId?: string
  ) => void;
  onAddToBranchEnd: (parentId: string, branchType: string) => void;
}

export const WorkflowNodeItem: React.FC<WorkflowNodeItemProps> = ({
  node,
  nodeIndex,
  globalIndex,
  definitions,
  uiScale,
  spotlightData,
  isFirstNode = false,
  prevNode,
  isDragActive = false,
  activeDropId = null,
  hoveredGapIndex,
  onSetHoveredGapIndex,
  isLastInBranch = false,
  nextNode,
  nextNodeDepth,
  collapsedBranches,
  onToggleCollapse,
  branchActionCounts,
  onUpdateAction,
  onRemoveAction,
  onActionClick,
  onAddAction,
  onAddToBranchEnd,
}) => {
  const leftIndent = node.depth * INDENT_PX;

  if (node.type === "action") {
    return (
      <ActionNode
        node={node}
        nodeIndex={nodeIndex}
        globalIndex={globalIndex}
        definitions={definitions}
        _uiScale={uiScale}
        spotlightData={spotlightData}
        leftIndent={leftIndent}
        isFirstNode={isFirstNode}
        prevNode={prevNode}
        nextNode={nextNode}
        isDragActive={isDragActive}
        activeDropId={activeDropId}
        hoveredGapIndex={hoveredGapIndex}
        onSetHoveredGapIndex={onSetHoveredGapIndex}
        isLastInBranch={isLastInBranch}
        nextNodeDepth={nextNodeDepth}
        onUpdateAction={onUpdateAction}
        onRemoveAction={onRemoveAction}
        onActionClick={onActionClick}
        onAddAction={onAddAction}
      />
    );
  }

  if (node.type === "branch-label") {
    const isBranchEmpty =
      !nextNode ||
      nextNode.type === "branch-label" ||
      nextNode.type === "end-block";

    const branchId = `${node.parentActionId}-${node.labelType}`;
    const isCollapsed = collapsedBranches.has(branchId);
    const actionCount = branchActionCounts.get(branchId) || 0;

    return (
      <BranchLabelNode
        node={node}
        nodeIndex={nodeIndex}
        leftIndent={leftIndent}
        isBranchEmpty={isBranchEmpty}
        isCollapsed={isCollapsed}
        actionCount={actionCount}
        onToggleCollapse={() => onToggleCollapse(branchId)}
        isDragActive={isDragActive}
        hoveredGapIndex={hoveredGapIndex}
        onSetHoveredGapIndex={onSetHoveredGapIndex}
        onAddToBranchEnd={onAddToBranchEnd}
      />
    );
  }

  if (node.type === "end-block") {
    return (
      <EndBlockNode
        node={node}
        nodeIndex={nodeIndex}
        leftIndent={leftIndent}
        nextNode={nextNode}
        isDragActive={isDragActive}
        activeDropId={activeDropId}
        hoveredGapIndex={hoveredGapIndex}
        onSetHoveredGapIndex={onSetHoveredGapIndex}
        onAddAction={onAddAction}
      />
    );
  }

  return null;
};

export default WorkflowNodeItem;
