import { useSortable } from "@dnd-kit/sortable";
import cn from "classnames";
import { GripVertical } from "lucide-react";
import React from "react";

import type { ActionDefinition } from "../../data";
import type { FlatWorkflowNode } from "../../utils/flattenWorkflow";
import CommandCard from "../CommandCard";
import type { SpotlightData } from "../CommandCard/types";
import { WorkflowGap } from "../WorkflowGap";
import { NUMBER_COLUMN_WIDTH } from "./constants";

export interface ActionNodeProps {
  node: FlatWorkflowNode;
  nodeIndex: number;
  globalIndex: number;
  definitions: ActionDefinition[];
  _uiScale: number;
  spotlightData: SpotlightData;
  leftIndent: number;
  isFirstNode: boolean;
  prevNode?: FlatWorkflowNode;
  nextNode?: FlatWorkflowNode;
  isDragActive: boolean;
  activeDropId: string | null;
  hoveredGapIndex: number | null;
  onSetHoveredGapIndex: (index: number | null) => void;
  isLastInBranch: boolean;
  nextNodeDepth?: number;
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
}

export const ActionNode: React.FC<ActionNodeProps> = ({
  node,
  nodeIndex,
  globalIndex,
  definitions,
  _uiScale,
  spotlightData,
  leftIndent,
  isFirstNode,
  prevNode,
  nextNode,
  isDragActive,
  activeDropId,
  hoveredGapIndex,
  onSetHoveredGapIndex,
  isLastInBranch,
  nextNodeDepth,
  onUpdateAction,
  onRemoveAction,
  onActionClick,
  onAddAction,
}) => {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } =
    useSortable({
      id: node.id,
      data: {
        type: "action",
        node,
      },
    });

  const instance = node.actionInstance;
  const definition = instance
    ? definitions.find((def) => def.id === instance.definitionId)
    : null;

  if (!instance || !definition) return null;

  const style: React.CSSProperties = {
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 999 : "auto",
  };

  const isIfOrLoopAction =
    definition.type === "if" || definition.type === "loop";
  const isControlOrTrigger = definition.category === "Controls";

  const showGhostLine =
    !isIfOrLoopAction &&
    nextNodeDepth !== undefined &&
    nextNodeDepth >= node.depth;
  const showBottomMargin =
    isIfOrLoopAction || (!showGhostLine && !isLastInBranch);

  const showGapBefore = isFirstNode || prevNode?.type === "branch-label";

  const gapBeforeIndex = nodeIndex * 2;
  const gapAfterIndex = nodeIndex * 2 + 1;

  const previousActionId =
    prevNode?.type === "action" &&
    prevNode.depth === node.depth &&
    prevNode.actionInstance?.parentIfId === instance.parentIfId &&
    prevNode.actionInstance?.parentLoopId === instance.parentLoopId &&
    prevNode.actionInstance?.branchType === instance.branchType
      ? prevNode.id
      : null;

  return (
    <div className="relative">
      {showGapBefore && (
        <div style={{ paddingLeft: `${leftIndent}px` }}>
          <WorkflowGap
            index={gapBeforeIndex}
            nodeId={node.id}
            insertBeforeNodeId={node.id}
            isHovered={hoveredGapIndex === gapBeforeIndex}
            isDragging={isDragActive}
            activeDropId={activeDropId}
            branchType={instance.branchType}
            onMouseEnter={() => onSetHoveredGapIndex(gapBeforeIndex)}
            onMouseLeave={() => onSetHoveredGapIndex(null)}
            onAddClick={() => {
              onAddAction(
                previousActionId,
                node.depth,
                previousActionId === null ? node.id : undefined
              );
            }}
          />
        </div>
      )}

      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        className={cn(
          "group relative",
          isDragging && "is-dragging",
          isIfOrLoopAction ? "mb-4" : showBottomMargin && "mb-4"
        )}
      >
        <div
          style={{ paddingLeft: `${leftIndent}px` }}
          className="flex items-start"
        >
          <div
            className="flex shrink-0 items-center"
            style={{ width: `${NUMBER_COLUMN_WIDTH}px`, minHeight: "56px" }}
          >
            <div
              ref={setActivatorNodeRef}
              {...listeners}
              className="flex h-full cursor-grab items-center justify-center opacity-0 transition-opacity hover:opacity-100 active:cursor-grabbing group-hover:opacity-80"
              style={{ width: "24px" }}
            >
              <GripVertical
                size={18}
                className="text-text-3"
                strokeWidth={2.5}
              />
            </div>
            <div className="flex flex-1 items-center justify-center">
              <span
                className={cn(
                  "text-[14px] font-bold",
                  isControlOrTrigger ? "text-text-1" : "text-text-2"
                )}
              >
                {globalIndex + 1}
              </span>
            </div>
          </div>

          <div className="min-w-0 flex-1 pr-11">
            <CommandCard
              definition={definition}
              instance={instance}
              isDragging={isDragging}
              onUpdate={(newData: Record<string, unknown>) =>
                onUpdateAction(instance.id, newData)
              }
              onRemove={() => onRemoveAction(instance.id)}
              spotlightData={spotlightData}
              onClick={() => onActionClick(instance.id)}
            />
          </div>
        </div>
      </div>

      {showGhostLine && (
        <div style={{ paddingLeft: `${leftIndent}px` }}>
          <WorkflowGap
            index={gapAfterIndex}
            nodeId={node.id}
            insertBeforeNodeId={
              nextNode?.type === "action" ? nextNode.id : null
            }
            isHovered={hoveredGapIndex === gapAfterIndex}
            isDragging={isDragActive}
            activeDropId={activeDropId}
            branchType={instance.branchType}
            onMouseEnter={() => onSetHoveredGapIndex(gapAfterIndex)}
            onMouseLeave={() => onSetHoveredGapIndex(null)}
            onAddClick={() => onAddAction(node.id, node.depth)}
          />
        </div>
      )}
    </div>
  );
};
