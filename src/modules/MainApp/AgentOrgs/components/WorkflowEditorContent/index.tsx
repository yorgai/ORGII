/**
 * WorkflowEditorContent Component
 *
 * Main drag-and-drop workflow editor with node rendering.
 * Renders the DndContext with all workflow nodes and handles drag operations.
 */
import {
  DndContext,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  closestCorners,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus } from "lucide-react";

import { scaleAwareModifier } from "@src/lib/dndKit";

import type { ActionDefinition, ActionInstance } from "../../data";
import type { FlatWorkflowNode } from "../../utils/flattenWorkflow";
import type { SpotlightData } from "../CommandCard/types";
import { EmptyWorkflowState } from "../EmptyWorkflowState";
import { WorkflowNodeItem } from "../WorkflowNodeItem";

export interface WorkflowEditorContentProps {
  instances: ActionInstance[];
  flatNodes: FlatWorkflowNode[];
  sortableIds: string[];
  sensors: unknown[];
  activeId: string | null;
  overId: string | null;
  collapsedBranches: Set<string>;
  branchActionCounts: Map<string, number>;
  hoveredGapIndex: number | null;
  uiScale: number;
  definitions: ActionDefinition[];
  spotlightData: SpotlightData;
  isNodeCollapsed: (node: FlatWorkflowNode, nodeIndex: number) => boolean;
  getActionIndex: (nodeId: string) => number;
  handleToggleCollapse: (branchId: string) => void;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragOver: (event: DragOverEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
  handleDragCancel?: (event: DragCancelEvent) => void;
  onSetHoveredGapIndex: (index: number | null) => void;
  onUpdateAction: (id: string, data: Record<string, unknown>) => void;
  onRemoveAction: (id: string) => void;
  onActionClick: (id: string) => void;
  onRequestAddAction: (
    afterNodeId: string | null,
    depth: number,
    insertBeforeNodeId?: string
  ) => void;
  onAddToBranchEnd: (parentId: string, branchType: string) => void;
  isPreviewMode?: boolean;
}

export function WorkflowEditorContent({
  instances,
  flatNodes,
  sortableIds,
  sensors,
  activeId,
  overId,
  collapsedBranches,
  branchActionCounts,
  hoveredGapIndex,
  uiScale,
  definitions,
  spotlightData,
  isNodeCollapsed,
  getActionIndex,
  handleToggleCollapse,
  handleDragStart,
  handleDragOver,
  handleDragEnd,
  handleDragCancel,
  onSetHoveredGapIndex,
  onUpdateAction,
  onRemoveAction,
  onActionClick,
  onRequestAddAction,
  onAddToBranchEnd,
  isPreviewMode = false,
}: WorkflowEditorContentProps): JSX.Element {
  // Preview mode: render without DnD context
  if (isPreviewMode) {
    return (
      <div
        className={`flex min-h-full flex-col pb-8 ${instances.length === 0 ? "min-h-0 flex-1" : ""}`}
      >
        {instances.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <EmptyWorkflowState />
          </div>
        ) : (
          <>
            {flatNodes.map((node, nodeIndex) => {
              const nextNode = flatNodes[nodeIndex + 1];
              const prevNode =
                nodeIndex > 0 ? flatNodes[nodeIndex - 1] : undefined;
              const isFirstNode = nodeIndex === 0;

              if (isNodeCollapsed(node, nodeIndex)) {
                return null; // Hide collapsed content
              }

              return (
                <WorkflowNodeItem
                  key={node.id}
                  node={node}
                  nodeIndex={nodeIndex}
                  globalIndex={
                    node.type === "action" ? getActionIndex(node.id) : 0
                  }
                  definitions={definitions}
                  uiScale={uiScale}
                  spotlightData={spotlightData}
                  isFirstNode={isFirstNode}
                  prevNode={prevNode}
                  isDragActive={false}
                  activeDropId={null}
                  hoveredGapIndex={null}
                  onSetHoveredGapIndex={() => {}}
                  isLastInBranch={
                    nextNode?.type === "end-block" ||
                    nextNode?.type === "branch-label"
                  }
                  nextNode={nextNode}
                  nextNodeDepth={nextNode?.depth}
                  collapsedBranches={collapsedBranches}
                  onToggleCollapse={handleToggleCollapse}
                  branchActionCounts={branchActionCounts}
                  onUpdateAction={() => {}}
                  onRemoveAction={() => {}}
                  onActionClick={() => {}}
                  onAddAction={() => {}}
                  onAddToBranchEnd={() => {}}
                />
              );
            })}
          </>
        )}
      </div>
    );
  }

  // Full editor mode with DnD
  return (
    <DndContext
      sensors={sensors as never}
      collisionDetection={closestCorners}
      modifiers={[restrictToVerticalAxis, scaleAwareModifier]}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext
        items={sortableIds}
        strategy={verticalListSortingStrategy}
      >
        <div
          className={`flex min-h-full flex-col pb-8 ${instances.length === 0 ? "min-h-0 flex-1" : ""}`}
        >
          {instances.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <EmptyWorkflowState
                onAddAction={() => onRequestAddAction(null, 0)}
              />
            </div>
          ) : (
            <>
              {flatNodes.map((node, nodeIndex) => {
                const nextNode = flatNodes[nodeIndex + 1];
                const prevNode =
                  nodeIndex > 0 ? flatNodes[nodeIndex - 1] : undefined;
                const isFirstNode = nodeIndex === 0;

                if (isNodeCollapsed(node, nodeIndex)) {
                  return null; // Hide collapsed content
                }

                return (
                  <WorkflowNodeItem
                    key={node.id}
                    node={node}
                    nodeIndex={nodeIndex}
                    globalIndex={
                      node.type === "action" ? getActionIndex(node.id) : 0
                    }
                    definitions={definitions}
                    uiScale={uiScale}
                    spotlightData={spotlightData}
                    isFirstNode={isFirstNode}
                    prevNode={prevNode}
                    isDragActive={!!activeId}
                    activeDropId={overId}
                    hoveredGapIndex={hoveredGapIndex}
                    onSetHoveredGapIndex={onSetHoveredGapIndex}
                    isLastInBranch={
                      nextNode?.type === "end-block" ||
                      nextNode?.type === "branch-label"
                    }
                    nextNode={nextNode}
                    nextNodeDepth={nextNode?.depth}
                    collapsedBranches={collapsedBranches}
                    onToggleCollapse={handleToggleCollapse}
                    branchActionCounts={branchActionCounts}
                    onUpdateAction={onUpdateAction}
                    onRemoveAction={onRemoveAction}
                    onActionClick={onActionClick}
                    onAddAction={onRequestAddAction}
                    onAddToBranchEnd={onAddToBranchEnd}
                  />
                );
              })}

              {/* Add button at the bottom - centered */}
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() => {
                    // Find the last root-level action to insert after it
                    const lastRootAction = flatNodes
                      .filter(
                        (node) => node.type === "action" && node.depth === 0
                      )
                      .pop();
                    onRequestAddAction(lastRootAction?.id ?? null, 0);
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-6 text-white shadow-md transition-transform hover:scale-110"
                >
                  <Plus size={16} strokeWidth={2.5} />
                </button>
              </div>
            </>
          )}
        </div>
      </SortableContext>
    </DndContext>
  );
}
