import { getPendingPlanApproval } from "@src/api/tauri/agent";
import {
  type PlanApprovalStateMap,
  upsertPendingPlanApproval,
} from "@src/store/session/planApprovalAtom";

export function rehydratePendingPlanApproval(
  sessionId: string,
  abortController: AbortController,
  setPendingPlanApprovals: (
    update: (prev: PlanApprovalStateMap) => PlanApprovalStateMap
  ) => void
): void {
  const rehydrate = async () => {
    try {
      const snapshot = await getPendingPlanApproval(sessionId);
      if (abortController.signal.aborted || !snapshot) return;
      setPendingPlanApprovals((prev) =>
        upsertPendingPlanApproval(prev, snapshot)
      );
    } catch {
      // Non-critical: the Build button stays disabled until Rust broadcasts
      // agent:plan_ready_for_approval again.
    }
  };

  void rehydrate();
}
