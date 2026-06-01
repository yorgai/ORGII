/**
 * useFlatWorkflowDnd Hook
 *
 * Simplified drag-and-drop hook for flat workflow list.
 * Handles reordering of action nodes within a single SortableContext.
 */
import type {
  DragCancelEvent,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useCallback, useState } from "react";

import type { ActionDefinition, ActionInstance } from "../data";
import {
  type FlatWorkflowNode,
  reconstructInstancesFromNodes,
} from "../utils/flattenWorkflow";

interface UseFlatWorkflowDndOptions {
  flatNodes: FlatWorkflowNode[];
  definitions: ActionDefinition[];
  onReorder: (newInstances: ActionInstance[]) => void;
  hoveredGapIndex: number | null;
  onClearHoveredGapIndex: () => void;
}

interface UseFlatWorkflowDndReturn {
  activeId: string | null;
  overId: string | null;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragOver: (event: DragOverEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
  handleDragCancel: (event: DragCancelEvent) => void;
}

export function useFlatWorkflowDnd({
  flatNodes,
  definitions,
  onReorder,
  hoveredGapIndex,
  onClearHoveredGapIndex,
}: UseFlatWorkflowDndOptions): UseFlatWorkflowDndReturn {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    setActiveId(active.id as string);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    setOverId(over ? (over.id as string) : null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active } = event;
      setActiveId(null);
      setOverId(null);

      if (hoveredGapIndex === null) {
        return;
      }

      // Find active node index
      const activeIndex = flatNodes.findIndex((node) => node.id === active.id);
      if (activeIndex === -1) return;

      const activeNode = flatNodes[activeIndex];
      if (activeNode.type !== "action") {
        return; // Only action nodes can be dragged
      }

      // Use hovered gap index to determine insert position
      // Gap indices are: nodeIndex * 2 (before) and nodeIndex * 2 + 1 (after)
      // So gap index / 2 gives us the node index
      const gapNodeIndex = Math.floor(hoveredGapIndex / 2);
      const isAfterGap = hoveredGapIndex % 2 === 1;

      // Calculate insert index
      let insertIndex = gapNodeIndex;
      if (isAfterGap) {
        insertIndex = gapNodeIndex + 1; // Insert after the node
      }

      // Don't do anything if dropping at the same position
      if (insertIndex === activeIndex || insertIndex === activeIndex + 1) {
        return;
      }

      // Adjust index if moving within the same list
      if (activeIndex < insertIndex) {
        insertIndex--; // Account for removal of the active item
      }

      // Get target context from the node at insert position
      let targetParentIfId: string | undefined;
      let targetParentLoopId: string | undefined;
      let targetBranchType: "if-true" | "if-false" | "loop-body" | undefined;

      // Get context from the action node we're inserting before/after
      const targetNode =
        flatNodes[
          insertIndex < flatNodes.length ? insertIndex : insertIndex - 1
        ];
      if (targetNode?.type === "action" && targetNode.actionInstance) {
        targetParentIfId = targetNode.actionInstance.parentIfId;
        targetParentLoopId = targetNode.actionInstance.parentLoopId;
        targetBranchType = targetNode.actionInstance.branchType;
      }

      // Reorder the flat nodes
      const newFlatNodes = arrayMove(flatNodes, activeIndex, insertIndex);

      // Update the moved node's parent context
      const movedNode = newFlatNodes.find((node) => node.id === active.id);
      if (movedNode?.actionInstance) {
        movedNode.actionInstance = {
          ...movedNode.actionInstance,
          parentIfId: targetParentIfId,
          parentLoopId: targetParentLoopId,
          branchType: targetBranchType,
        };
      }

      // Reconstruct instances from the reordered flat nodes
      const newInstances = reconstructInstancesFromNodes(
        newFlatNodes,
        definitions
      );

      // Update via callback
      onReorder(newInstances);
    },
    [flatNodes, definitions, onReorder, hoveredGapIndex]
  );

  const handleDragCancel = useCallback(
    (_event: DragCancelEvent) => {
      setActiveId(null);
      setOverId(null);
      onClearHoveredGapIndex();
    },
    [onClearHoveredGapIndex]
  );

  return {
    activeId,
    overId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
