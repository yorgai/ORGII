/**
 * useWorkflowEditPanel Hook
 *
 * Manages edit panel state and complex action insertion logic.
 * Handles adding actions at specific positions, including within branches.
 */
import { useCallback, useState } from "react";
import { v4 as uuidv4 } from "uuid";

import type { EditPanelVariant } from "../EditPanel";
import type { ActionDefinition, ActionInstance } from "../data";
import type { FlatWorkflowNode } from "../utils/flattenWorkflow";
import type { AddActionBranchState } from "./useAddActionState";

export interface UseWorkflowEditPanelOptions {
  flatNodes: FlatWorkflowNode[];
  instances: ActionInstance[];
  onUpdate: (newInstances: ActionInstance[]) => void;
  branchState: AddActionBranchState | null;
  setBranchAddState: (
    parentId: string,
    branchType: "if-true" | "if-false" | "loop-body",
    insertAtBranchIndex?: number
  ) => void;
  clearBranchAddState: () => void;
  handleAddAction: (
    action: ActionDefinition,
    insertIndex: number | null
  ) => void;
}

export interface UseWorkflowEditPanelReturn {
  editPanelVariant: EditPanelVariant;
  insertIndex: number | null;
  selectedInstanceId: string | null;
  handleRequestAddAction: (
    afterNodeId: string | null,
    depth: number,
    insertBeforeNodeId?: string
  ) => void;
  handleAddToBranchEnd: (parentId: string, branchType: string) => void;
  handleActionClick: (instanceId: string) => void;
  handleCloseEditPanel: () => void;
  handleAddActionFromPanel: (action: ActionDefinition) => void;
}

export function useWorkflowEditPanel({
  flatNodes,
  instances,
  onUpdate,
  branchState,
  setBranchAddState,
  clearBranchAddState,
  handleAddAction,
}: UseWorkflowEditPanelOptions): UseWorkflowEditPanelReturn {
  // Edit panel state — default to "adding" so the action catalog is always visible
  const [editPanelVariant, setEditPanelVariant] =
    useState<EditPanelVariant>("adding");
  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    null
  );

  // Handle request to add action (from nodes or at end)
  const handleRequestAddAction = useCallback(
    (
      afterNodeId: string | null,
      depth: number,
      insertBeforeNodeId?: string
    ) => {
      // If insertBeforeNodeId is provided, use it to determine the branch context
      if (insertBeforeNodeId && afterNodeId === null && depth > 0) {
        const beforeNode = flatNodes.find(
          (node) => node.id === insertBeforeNodeId
        );
        if (beforeNode?.type === "action" && beforeNode.actionInstance) {
          const inst = beforeNode.actionInstance;
          if (inst.parentIfId) {
            // Insert at start of this If branch (before this node)
            const parentIndex = instances.findIndex(
              (instance) => instance.id === inst.parentIfId
            );
            setInsertIndex(parentIndex + 1);
            setBranchAddState(
              inst.parentIfId,
              inst.branchType as "if-true" | "if-false",
              0 // Insert at index 0 within the branch
            );
            setSelectedInstanceId(null);
            setEditPanelVariant("adding");
            return;
          } else if (inst.parentLoopId) {
            // Insert at start of this Loop branch (before this node)
            const parentIndex = instances.findIndex(
              (instance) => instance.id === inst.parentLoopId
            );
            setInsertIndex(parentIndex + 1);
            setBranchAddState(
              inst.parentLoopId,
              "loop-body",
              0 // Insert at index 0 within the branch
            );
            setSelectedInstanceId(null);
            setEditPanelVariant("adding");
            return;
          }
        }
      }

      // Find the index to insert at
      if (afterNodeId) {
        // Find the flat index and compute instance index
        const nodeIndex = flatNodes.findIndex(
          (node) => node.id === afterNodeId
        );
        const node = flatNodes[nodeIndex];

        if (node?.type === "action") {
          // Adding after an action
          const instanceIndex = instances.findIndex(
            (inst) => inst.id === afterNodeId
          );

          // Check if we're inside a branch
          if (node.actionInstance?.parentIfId) {
            // Calculate the branch-relative index by counting items in the same branch BEFORE this action
            const parentId = node.actionInstance.parentIfId;
            const branchType = node.actionInstance.branchType;
            const itemsBeforeInBranch = instances.filter(
              (inst, idx) =>
                idx <= instanceIndex &&
                (inst.parentIfId === parentId ||
                  inst.parentLoopId === parentId) &&
                inst.branchType === branchType
            );
            setBranchAddState(
              parentId,
              branchType as "if-true" | "if-false",
              itemsBeforeInBranch.length // Insert after this many items in the branch
            );
            setInsertIndex(instanceIndex + 1);
          } else if (node.actionInstance?.parentLoopId) {
            // Calculate the branch-relative index for loop
            const parentId = node.actionInstance.parentLoopId;
            const itemsBeforeInBranch = instances.filter(
              (inst, idx) =>
                idx <= instanceIndex &&
                (inst.parentIfId === parentId || inst.parentLoopId === parentId)
            );
            setBranchAddState(
              parentId,
              "loop-body",
              itemsBeforeInBranch.length // Insert after this many items in the branch
            );
            setInsertIndex(instanceIndex + 1);
          } else {
            // Root level - need to skip over all children if this is an if/loop action
            clearBranchAddState();

            // Find the last descendant of this action (if it has any)
            let lastDescendantIndex = instanceIndex;
            for (let idx = instanceIndex + 1; idx < instances.length; idx++) {
              const inst = instances[idx];
              if (
                inst.parentIfId === afterNodeId ||
                inst.parentLoopId === afterNodeId
              ) {
                lastDescendantIndex = idx;
              } else {
                break;
              }
            }
            setInsertIndex(lastDescendantIndex + 1);
          }
        } else if (node?.type === "end-block") {
          // Adding after an end-block (at parent level)
          // Find the parent IF/LOOP action
          const parentId = node.parentActionId;
          if (parentId) {
            const parentIndex = instances.findIndex(
              (inst) => inst.id === parentId
            );
            const parentInstance = instances[parentIndex];

            // Check if the end-block itself is inside a branch
            // (e.g., a loop inside an if-true branch)
            if (node.branchType && parentInstance) {
              // The end-block is inside a branch, so we should stay in that branch
              // Find the parent of the parent (grandparent) if it exists
              const grandparentId =
                parentInstance.parentIfId || parentInstance.parentLoopId;

              if (grandparentId) {
                // Insert after the parent's entire block, but within the grandparent's branch
                let lastDescendantIndex = parentIndex;
                for (let idx = parentIndex + 1; idx < instances.length; idx++) {
                  const inst = instances[idx];
                  if (
                    inst.parentIfId === parentId ||
                    inst.parentLoopId === parentId
                  ) {
                    lastDescendantIndex = idx;
                  } else {
                    break;
                  }
                }

                // Calculate the branch-relative index
                // Count how many items in the same branch come before or at our insertion point
                const branchItemsBeforeInsertion = instances.filter(
                  (inst, idx) =>
                    idx <= lastDescendantIndex &&
                    (inst.parentIfId === grandparentId ||
                      inst.parentLoopId === grandparentId) &&
                    inst.branchType === node.branchType
                ).length;

                setInsertIndex(lastDescendantIndex + 1);
                // Preserve the branch context
                setBranchAddState(
                  grandparentId,
                  node.branchType as "if-true" | "if-false" | "loop-body",
                  branchItemsBeforeInsertion // Insert after this many items in the branch
                );
              } else {
                // Parent is at root level but marked with branch type somehow
                // This shouldn't happen, but fall back to clearing branch state
                let lastDescendantIndex = parentIndex;
                for (let idx = parentIndex + 1; idx < instances.length; idx++) {
                  const inst = instances[idx];
                  if (
                    inst.parentIfId === parentId ||
                    inst.parentLoopId === parentId
                  ) {
                    lastDescendantIndex = idx;
                  } else {
                    break;
                  }
                }
                setInsertIndex(lastDescendantIndex + 1);
                clearBranchAddState();
              }
            } else {
              // End-block is at root level, insert after parent's entire block
              let lastDescendantIndex = parentIndex;
              for (let idx = parentIndex + 1; idx < instances.length; idx++) {
                const inst = instances[idx];
                if (
                  inst.parentIfId === parentId ||
                  inst.parentLoopId === parentId
                ) {
                  lastDescendantIndex = idx;
                } else {
                  break;
                }
              }
              setInsertIndex(lastDescendantIndex + 1);
              clearBranchAddState();
            }
          }
        }
      } else {
        // afterNodeId is null - either inserting at start of workflow OR at start of a branch
        if (depth > 0) {
          // Inside a branch - need to find which branch
          // First try to find an action at this depth
          const firstActionAtDepth = flatNodes.find(
            (node) => node.type === "action" && node.depth === depth
          );

          if (firstActionAtDepth?.actionInstance) {
            const inst = firstActionAtDepth.actionInstance;
            if (inst.parentIfId) {
              // Insert at start of this If branch
              const parentIndex = instances.findIndex(
                (instance) => instance.id === inst.parentIfId
              );
              setInsertIndex(parentIndex + 1);
              setBranchAddState(
                inst.parentIfId,
                inst.branchType as "if-true" | "if-false",
                0 // Insert at index 0 within the branch
              );
            } else if (inst.parentLoopId) {
              // Insert at start of this Loop branch
              const parentIndex = instances.findIndex(
                (instance) => instance.id === inst.parentLoopId
              );
              setInsertIndex(parentIndex + 1);
              setBranchAddState(
                inst.parentLoopId,
                "loop-body",
                0 // Insert at index 0 within the branch
              );
            }
          } else {
            // No action at this depth - branch might be empty
            // Look for a branch-label at this depth to find the parent
            const branchLabel = flatNodes.find(
              (node) => node.type === "branch-label" && node.depth === depth
            );

            if (branchLabel?.parentActionId && branchLabel.labelType) {
              const parentId = branchLabel.parentActionId;
              const parentIndex = instances.findIndex(
                (inst) => inst.id === parentId
              );
              setInsertIndex(parentIndex + 1);
              setBranchAddState(
                parentId,
                branchLabel.labelType as "if-true" | "if-false" | "loop-body",
                0 // Insert at index 0 within the empty branch
              );
            } else {
              // Fallback - insert at end
              setInsertIndex(instances.length);
              clearBranchAddState();
            }
          }
        } else {
          // Depth is 0 - inserting at start of root workflow
          setInsertIndex(0);
          clearBranchAddState();
        }
      }

      setSelectedInstanceId(null);
      setEditPanelVariant("adding");
    },
    [flatNodes, instances, setBranchAddState, clearBranchAddState]
  );

  // Handle adding to the END of a branch (from branch label button)
  const handleAddToBranchEnd = useCallback(
    (parentId: string, branchType: string) => {
      // Find all existing items in this branch to get the count
      const branchItems = instances.filter(
        (inst) =>
          (inst.parentIfId === parentId || inst.parentLoopId === parentId) &&
          inst.branchType === branchType
      );

      // Set branch state to add at the END (after existing items)
      setBranchAddState(
        parentId,
        branchType as "if-true" | "if-false" | "loop-body",
        branchItems.length // This will insert after the last item
      );
      setInsertIndex(null);
      setSelectedInstanceId(null);
      setEditPanelVariant("adding");
    },
    [instances, setBranchAddState]
  );

  // Handle action card click to edit
  const handleActionClick = useCallback((instanceId: string) => {
    setSelectedInstanceId(instanceId);
    setInsertIndex(null);
    setEditPanelVariant("editing");
  }, []);

  // Close edit panel — return to "adding" catalog view
  const handleCloseEditPanel = useCallback(() => {
    setEditPanelVariant("adding");
    setInsertIndex(null);
    setSelectedInstanceId(null);
    clearBranchAddState();
  }, [clearBranchAddState]);

  // Add action from edit panel
  const handleAddActionFromPanel = useCallback(
    (action: ActionDefinition) => {
      if (branchState) {
        // Adding to a branch
        const { parentId, branchType, insertAtBranchIndex } = branchState;

        // Create new instance with parent info
        const newInstance = {
          id: uuidv4(),
          definitionId: action.id,
          data: {},
          parentIfId: branchType !== "loop-body" ? parentId : undefined,
          parentLoopId: branchType === "loop-body" ? parentId : undefined,
          branchType,
        };

        // Find the parent and insert after it
        const parentIndex = instances.findIndex((inst) => inst.id === parentId);

        // Calculate actual index by counting items in THIS branch up to insertAtBranchIndex
        // and items from OTHER branches that come before them
        let targetIndex = parentIndex + 1;
        if (insertAtBranchIndex !== undefined && insertAtBranchIndex > 0) {
          let branchItemsSeen = 0;
          for (
            let instanceIdx = parentIndex + 1;
            instanceIdx < instances.length;
            instanceIdx++
          ) {
            const inst = instances[instanceIdx];
            const isInOurBranch =
              (inst.parentIfId === parentId ||
                inst.parentLoopId === parentId) &&
              inst.branchType === branchType;

            if (isInOurBranch) {
              branchItemsSeen++;
              if (branchItemsSeen === insertAtBranchIndex) {
                targetIndex = instanceIdx + 1;
                break;
              }
            }
          }
        }

        const newInstances = [...instances];
        newInstances.splice(targetIndex, 0, newInstance);

        onUpdate(newInstances);
        clearBranchAddState();
      } else {
        handleAddAction(action, insertIndex);
      }

      setEditPanelVariant("adding");
      setInsertIndex(null);
    },
    [
      branchState,
      instances,
      onUpdate,
      clearBranchAddState,
      handleAddAction,
      insertIndex,
    ]
  );

  return {
    editPanelVariant,
    insertIndex,
    selectedInstanceId,
    handleRequestAddAction,
    handleAddToBranchEnd,
    handleActionClick,
    handleCloseEditPanel,
    handleAddActionFromPanel,
  };
}
