/**
 * useAddActionState Hook
 *
 * Manages state for adding actions to workflow branches.
 * Replaces the window object anti-pattern with proper React state management.
 */
import { useCallback, useState } from "react";

export interface AddActionBranchState {
  branchType: "if-true" | "if-false" | "loop-body";
  parentId: string;
  insertAtBranchIndex?: number;
}

export function useAddActionState() {
  const [branchState, setBranchState] = useState<AddActionBranchState | null>(
    null
  );

  const setBranchAddState = useCallback(
    (
      parentId: string,
      branchType: "if-true" | "if-false" | "loop-body",
      insertAtBranchIndex?: number
    ) => {
      setBranchState({
        parentId,
        branchType,
        insertAtBranchIndex,
      });
    },
    []
  );

  const clearBranchAddState = useCallback(() => {
    setBranchState(null);
  }, []);

  return {
    branchState,
    setBranchAddState,
    clearBranchAddState,
  };
}
