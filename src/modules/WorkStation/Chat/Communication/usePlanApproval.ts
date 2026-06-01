import { useAtomValue, useSetAtom } from "jotai";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { respondPlanApproval } from "@src/api/tauri/agent";
import Message from "@src/components/Message";
import {
  derivePlanApprovalViewState,
  getPendingPlanAliases,
  getPlanEventAliases,
  isPlanDisplayEvent,
  planAliasesContain,
} from "@src/engines/SessionCore/derived/planDisplayEvents";
import { currentRepoAtom } from "@src/store/repo";
import { sessionRuntimeStatusAtom } from "@src/store/session/cliSessionStatusAtom";
import { creatorDefaultModelSelectionAtom } from "@src/store/session/creatorDefaultModelAtom";
import {
  type PendingPlanApproval,
  clearPendingPlanApproval,
  pendingPlanApprovalsAtom,
} from "@src/store/session/planApprovalAtom";
import { sessionMapAtom } from "@src/store/session/sessionAtom";
import { activeSessionIdAtom } from "@src/store/session/viewAtom";
import { resolveModelForMessage } from "@src/util/session/resolveModelForMessage";

import type { MessageEntry } from "./types";

interface UsePlanApprovalOptions {
  interactionMessages: MessageEntry[];
  selectedMessage?: MessageEntry | null;
  viewMode: string;
}

export interface PlanApprovalState {
  activePlanMessage: MessageEntry | null;
  isPlanDoc: boolean;
  isPlanPending: boolean;
  isEditing: boolean;
  isPreviewMode: boolean;
  editedContent: string;
  submitting: boolean;
  hasEdits: boolean;
  buildDisabled: boolean;
  buildButtonRef: React.RefObject<HTMLButtonElement>;
  setIsPreviewMode: (v: boolean) => void;
  setEditedContent: (v: string) => void;
  handleEditToggle: () => void;
  handleBuild: () => Promise<void>;
}

function asStringArg(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function pendingPlanToMessageEntry(
  pendingPlan: PendingPlanApproval,
  timestamp: string
): MessageEntry {
  const eventId =
    pendingPlan.planRevisionId || pendingPlan.toolCallId || "pending-plan";
  return {
    eventId,
    event: {
      id: eventId,
      chunk_id: eventId,
      sessionId: pendingPlan.sessionId,
      createdAt: timestamp,
      functionName: "plan_approval",
      uiCanonical: "plan_approval",
      actionType: "plan_approval",
      args: {
        title: pendingPlan.planTitle,
        content: pendingPlan.planContent,
        planId: pendingPlan.planId,
        planRevisionId: pendingPlan.planRevisionId,
        originToolCallId: pendingPlan.originToolCallId,
        toolCallId: pendingPlan.toolCallId,
        planPath: pendingPlan.planPath,
      },
      result: {
        status: "pending",
        planId: pendingPlan.planId,
        planRevisionId: pendingPlan.planRevisionId,
        originToolCallId: pendingPlan.originToolCallId,
        toolCallId: pendingPlan.toolCallId,
        planPath: pendingPlan.planPath,
      },
      source: "assistant",
      displayText: pendingPlan.planTitle || "Plan",
      displayStatus: "awaiting_user",
      displayVariant: "tool_call",
      activityStatus: "agent",
      callId: pendingPlan.toolCallId,
    },
    type: "interaction",
    content: pendingPlan.planContent,
    sender: "agent",
    timestamp,
    order: Number.MAX_SAFE_INTEGER,
    isCurrent: false,
  };
}

export function usePlanApproval({
  interactionMessages,
  selectedMessage,
  viewMode,
}: UsePlanApprovalOptions): PlanApprovalState {
  const { t } = useTranslation("sessions");
  const activeSessionId = useAtomValue(activeSessionIdAtom);
  const approvalMap = useAtomValue(pendingPlanApprovalsAtom);
  const setPendingPlanApprovals = useSetAtom(pendingPlanApprovalsAtom);
  const sessionMap = useAtomValue(sessionMapAtom);
  const runtimeStatus = useAtomValue(sessionRuntimeStatusAtom);
  const creatorDefaultSelection = useAtomValue(
    creatorDefaultModelSelectionAtom
  );
  const currentRepo = useAtomValue(currentRepoAtom);

  const [isPreviewMode, setIsPreviewMode] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const buildButtonRef = useRef<HTMLButtonElement>(
    null
  ) as React.RefObject<HTMLButtonElement>;

  const activeSessionApprovalState = activeSessionId
    ? approvalMap.get(activeSessionId)
    : undefined;
  const currentPendingPlan = activeSessionApprovalState?.current;
  const planViewState = useMemo(
    () =>
      derivePlanApprovalViewState({
        pendingPlan: currentPendingPlan,
        chatEvents: interactionMessages.map((message) => message.event),
      }),
    [currentPendingPlan, interactionMessages]
  );
  const pendingAliases = getPendingPlanAliases(currentPendingPlan);
  const selectedPlanMessage =
    viewMode === "preview" && selectedMessage?.event
      ? isPlanDisplayEvent(selectedMessage.event)
        ? selectedMessage
        : null
      : null;
  const pendingPlanMessage =
    viewMode === "preview" && pendingAliases.length > 0
      ? [...interactionMessages].reverse().find((message) => {
          if (!isPlanDisplayEvent(message.event)) return false;
          const eventAliases = getPlanEventAliases(message.event);
          return pendingAliases.some((alias) => eventAliases.includes(alias));
        })
      : null;
  const fallbackPlanMessage =
    viewMode === "preview" && interactionMessages.length > 0
      ? [...interactionMessages]
          .reverse()
          .find((message) => isPlanDisplayEvent(message.event))
      : null;
  const pendingPlanSnapshotMessage =
    currentPendingPlan && planViewState.currentSurfaceVisible
      ? pendingPlanToMessageEntry(currentPendingPlan, new Date().toISOString())
      : null;
  const defaultPlanMessage =
    pendingPlanMessage ??
    pendingPlanSnapshotMessage ??
    fallbackPlanMessage ??
    null;
  const activePlanMessage = selectedPlanMessage ?? defaultPlanMessage;
  const isPlanDoc = Boolean(activePlanMessage);

  const planSessionId = isPlanDoc
    ? (activePlanMessage!.event.sessionId ?? activeSessionId)
    : activeSessionId;

  const planArgs = isPlanDoc
    ? (activePlanMessage!.event.args as Record<string, unknown> | undefined)
    : undefined;
  const planResult = isPlanDoc
    ? (activePlanMessage!.event.result as Record<string, unknown> | undefined)
    : undefined;
  const planIdentity = isPlanDoc
    ? getPlanEventAliases(activePlanMessage!.event)
    : [];
  const planRawContent =
    asStringArg(planArgs?.["streamContent"]) ||
    asStringArg(planArgs?.["content"]) ||
    asStringArg(planResult?.["content"]);

  const approvalState = planSessionId
    ? approvalMap.get(planSessionId)
    : undefined;
  const planApprovalAliases = getPendingPlanAliases(approvalState?.current);
  const matchesCurrentPendingPlan = planIdentity.some((identity) =>
    planAliasesContain(planApprovalAliases, identity)
  );
  const isPlanPending =
    matchesCurrentPendingPlan && planViewState.currentSurfaceVisible;
  const sessionIsWorking =
    planSessionId === activeSessionId &&
    (runtimeStatus === "running" || runtimeStatus === "installing");
  const buildDisabled = !isPlanPending || submitting || sessionIsWorking;

  const handleEditToggle = useCallback(() => {
    if (!isEditing) {
      setEditedContent(planRawContent);
      setIsPreviewMode(false);
    }
    setIsEditing((prev) => !prev);
  }, [isEditing, planRawContent]);

  const handleBuild = useCallback(async () => {
    if (!planSessionId || buildDisabled || submittingRef.current) return;
    submittingRef.current = true;
    if (buildButtonRef.current) buildButtonRef.current.disabled = true;
    setSubmitting(true);
    try {
      const planSession = sessionMap.get(planSessionId);
      const sessionSelection = planSession
        ? {
            ...creatorDefaultSelection,
            keySource:
              planSession.keySource ?? creatorDefaultSelection?.keySource,
            model: planSession.model ?? creatorDefaultSelection?.model,
            selectedAccountId:
              planSession.accountId ??
              creatorDefaultSelection?.selectedAccountId,
            cliAgentType:
              planSession.cliAgentType ?? creatorDefaultSelection?.cliAgentType,
            tier: planSession.tier ?? creatorDefaultSelection?.tier,
          }
        : creatorDefaultSelection;
      const { model, accountId } = resolveModelForMessage(sessionSelection);
      const workspacePath =
        planSession?.repoPath ??
        currentRepo?.path ??
        currentRepo?.fs_uri ??
        undefined;
      const contentOverride =
        isEditing && editedContent !== planRawContent
          ? editedContent
          : undefined;
      await respondPlanApproval(
        planSessionId,
        contentOverride ? "approve_with_edits" : "approve",
        contentOverride,
        {
          model,
          accountId,
          workspacePath,
        }
      );
      setPendingPlanApprovals((prev) =>
        clearPendingPlanApproval(
          prev,
          planSessionId,
          currentPendingPlan?.toolCallId ?? currentPendingPlan?.planRevisionId
        )
      );
      setIsEditing(false);
    } catch (err) {
      Message.error(
        err instanceof Error ? err.message : t("planDoc.buildFailed")
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [
    planSessionId,
    buildDisabled,
    isEditing,
    editedContent,
    planRawContent,
    sessionMap,
    creatorDefaultSelection,
    currentRepo,
    setPendingPlanApprovals,
    currentPendingPlan,
    t,
  ]);

  const hasEdits = isEditing && editedContent !== planRawContent;

  return {
    activePlanMessage,
    isPlanDoc,
    isPlanPending,
    isEditing,
    isPreviewMode,
    editedContent,
    submitting,
    hasEdits,
    buildDisabled,
    buildButtonRef,
    setIsPreviewMode,
    setEditedContent,
    handleEditToggle,
    handleBuild,
  };
}
