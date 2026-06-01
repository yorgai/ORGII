import { useCallback } from "react";
import { v4 as uuidv4 } from "uuid";

import type { ActionDefinition, ActionInstance } from "../data";

export interface UseWorkflowActionsOptions {
  instances: ActionInstance[];
  onUpdate: (newInstances: ActionInstance[]) => void;
}

export function useWorkflowActions({
  instances,
  onUpdate,
}: UseWorkflowActionsOptions) {
  // Add action at insert index
  const handleAddAction = useCallback(
    (action: ActionDefinition, insertIndex: number | null) => {
      const newInstance: ActionInstance = {
        id: uuidv4(),
        definitionId: action.id,
        data: {},
        // Set nestingLevel = 1 for top-level if statements
        ...(action.type === "if" ? { nestingLevel: 1 } : {}),
      };

      if (insertIndex !== null && insertIndex < instances.length) {
        const newInstances = [...instances];
        newInstances.splice(insertIndex, 0, newInstance);
        onUpdate(newInstances);
      } else {
        onUpdate([...instances, newInstance]);
      }
    },
    [instances, onUpdate]
  );

  // Update action data
  const handleUpdateAction = useCallback(
    (instanceId: string, newData: Record<string, unknown>) => {
      onUpdate(
        instances.map((inst) =>
          inst.id === instanceId ? { ...inst, data: newData } : inst
        )
      );
    },
    [instances, onUpdate]
  );

  // Remove action — recursively removes all child instances so no orphans remain
  const handleRemoveAction = useCallback(
    (instanceId: string) => {
      const toRemove = new Set<string>([instanceId]);

      // Walk the flat list once to collect all descendants transitively.
      // One pass is sufficient because instances are stored in parent-before-child order.
      for (const inst of instances) {
        if (
          (inst.parentIfId && toRemove.has(inst.parentIfId)) ||
          (inst.parentLoopId && toRemove.has(inst.parentLoopId))
        ) {
          toRemove.add(inst.id);
        }
      }

      onUpdate(instances.filter((inst) => !toRemove.has(inst.id)));
    },
    [instances, onUpdate]
  );

  return {
    handleAddAction,
    handleUpdateAction,
    handleRemoveAction,
  };
}
