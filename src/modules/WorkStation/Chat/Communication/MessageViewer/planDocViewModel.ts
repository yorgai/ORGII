import type { TFunction } from "i18next";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { resolvePlanMarkdownContent } from "@src/engines/SessionCore/derived/planContentPersistence";
import {
  type PlanSurfaceState,
  asPlanApprovalStatus,
  pendingPlanMatchesEvent,
} from "@src/engines/SessionCore/derived/planDisplayEvents";
import type { PendingPlanApproval } from "@src/store/session/planApprovalAtom";

import {
  asStringArg,
  derivePlanTitle,
  extractPlanPathFromResult,
} from "../planDocUtils";

export interface PlanDocViewModel {
  content: string;
  title: string;
  planRevisionId: string;
  planPath: string | null;
}

export interface PlanDocStatusViewModel {
  readyForReview: boolean;
  approvalStatus: ReturnType<typeof asPlanApprovalStatus>;
  label: string;
}

export function planSurfaceStatusLabel(
  state: PlanSurfaceState,
  t: TFunction<["sessions", "common"]>
): string {
  if (state.label === "ready") {
    return t("planDoc.readyForReview", { ns: "sessions" });
  }
  if (state.label === "built") return t("planDoc.built", { ns: "sessions" });
  if (state.label === "archived") {
    return t("planDoc.archived", { ns: "sessions" });
  }
  if (state.label === "skipped") {
    return t("planDoc.cancelled", { ns: "sessions" });
  }
  return t("planDoc.idle", { ns: "sessions" });
}

export function getPlanDocStatusViewModel(
  event: SessionEvent,
  pendingPlan: PendingPlanApproval | null | undefined,
  t: TFunction<["sessions", "common"]>
): PlanDocStatusViewModel {
  const readyForReview = Boolean(
    pendingPlan && pendingPlanMatchesEvent(pendingPlan, event)
  );
  const approvalStatus = asPlanApprovalStatus(event.result?.status);
  const label = readyForReview
    ? t("planDoc.readyForReview", { ns: "sessions" })
    : approvalStatus === "approved"
      ? t("planDoc.built", { ns: "sessions" })
      : approvalStatus === "archived"
        ? t("planDoc.archived", { ns: "sessions" })
        : approvalStatus === "cancelled"
          ? t("planDoc.cancelled", { ns: "sessions" })
          : t("planDoc.idle", { ns: "sessions" });
  return { readyForReview, approvalStatus, label };
}

export function getPlanDocViewModel(
  event: SessionEvent,
  pendingPlan?: PendingPlanApproval | null
): PlanDocViewModel {
  const args = event.args as Record<string, unknown> | undefined;
  const result = event.result as Record<string, unknown> | undefined;
  const content = resolvePlanMarkdownContent(event, pendingPlan);
  const title = derivePlanTitle(
    asStringArg(args?.["title"]) || asStringArg(result?.["title"]),
    content
  );
  const planRevisionId =
    asStringArg(args?.["planRevisionId"]) ||
    asStringArg(result?.["planRevisionId"]);
  return {
    content,
    title,
    planRevisionId,
    planPath:
      asStringArg(args?.["planPath"]) ||
      asStringArg(result?.["planPath"]) ||
      extractPlanPathFromResult(event.result),
  };
}

export function planAdapterStatus(
  event: SessionEvent
): "pending" | "running" | "success" | "failed" | "cancelled" {
  if (
    event.displayStatus === "running" ||
    event.displayStatus === "awaiting_user"
  ) {
    return "running";
  }
  if (event.displayStatus === "failed") return "failed";
  if (event.displayStatus === "pending") return "pending";
  return "success";
}
