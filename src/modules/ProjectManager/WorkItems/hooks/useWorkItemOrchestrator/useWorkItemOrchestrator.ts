import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import type { AgentExecMode } from "@src/features/SessionCreator/config";
import { createLogger } from "@src/hooks/logger";
import { currentRepoAtom } from "@src/store/repo";
import type { WorkItem as WorkItemExtended } from "@src/types/core/workItem";
import { invokeTauri } from "@src/util/platform/tauri/init";

import { buildSdeTaskPrompt } from "../../components/WorkItemDetail/promptBuilder";
import {
  AGENT_ROLE,
  ORCHESTRATOR_COMMAND,
  TERMINAL_PHASES,
  formatOrchestratorError,
  toAgentRole,
} from "../../constants";
import type { AgentRole, OrchestratorPhase } from "../../constants";
import { useAutoReview } from "./useAutoReview";
import { useStaleSessionDetection } from "./useStaleSessionDetection";

const logger = createLogger("useWorkItemOrchestrator");
const RUNNING_LINKED_SESSION_STATUS = "running" as const;
const COMPLETED_WORK_ITEM_STATUS = "completed" as const;

const VALID_EXEC_MODES = new Set<string>([
  "build",
  "investigate",
  "plan",
  "debug",
  "review",
]);

function normalizeExecMode(raw: string | undefined): AgentExecMode | undefined {
  if (!raw) return undefined;
  if (raw === "ask" || raw === "explore") return "investigate";
  if (VALID_EXEC_MODES.has(raw)) return raw as AgentExecMode;
  return undefined;
}

export interface UseWorkItemOrchestratorOptions {
  workItem: WorkItemExtended;
  /** Effective work item with pending edits overlaid */
  displayWorkItem: WorkItemExtended;
  repoPath?: string | null;
  projectSlug?: string | null;
  shortId?: string | null;
  onRefreshWorkItem?: () => void;
  onUpdateWorkItem?: (updates: Partial<WorkItemExtended>) => void;
  /** When true, save pending edits before starting an agent */
  hasPendingChanges: boolean;
  handleSave: () => Promise<void>;
}

export function useWorkItemOrchestrator(
  options: UseWorkItemOrchestratorOptions
) {
  const {
    workItem,
    displayWorkItem,
    repoPath,
    projectSlug,
    shortId,
    onRefreshWorkItem,
    onUpdateWorkItem,
    hasPendingChanges,
    handleSave,
  } = options;

  const { t } = useTranslation("projects");

  const [isStartingAgent, setIsStartingAgent] = useState(false);
  const [activeAgentSessionId, setActiveAgentSessionId] = useState<
    string | null
  >(null);
  const [activeAgentRole, setActiveAgentRole] = useState<AgentRole | null>(
    null
  );

  const currentRepo = useAtomValue(currentRepoAtom);
  const worktreePath = currentRepo?.path ?? null;

  const projectRepoPath = repoPath ?? null;
  const accountId =
    displayWorkItem.orchestratorConfig?.selected_account_id ?? null;
  const modelId =
    displayWorkItem.orchestratorConfig?.selected_model_id ?? undefined;
  const rawMode = displayWorkItem.orchestratorConfig?.agent_mode;
  const agentMode: AgentExecMode | undefined = normalizeExecMode(rawMode);

  const resolveSessionRepoPath = useCallback(
    () => projectRepoPath ?? worktreePath ?? "",
    [projectRepoPath, worktreePath]
  );

  const validateOrchestratorParams = useCallback((): boolean => {
    if (!projectRepoPath || !projectSlug || !shortId) {
      logger.error(
        `Missing orchestrator params: projectRepoPath=${projectRepoPath}, projectSlug=${projectSlug}, shortId=${shortId}`
      );
      return false;
    }
    return true;
  }, [projectRepoPath, projectSlug, shortId]);

  const launchSdeSession = useCallback(
    async (
      orchestratorCommand:
        | typeof ORCHESTRATOR_COMMAND.Start
        | typeof ORCHESTRATOR_COMMAND.Retry,
      additionalInstructions?: string
    ) => {
      if (hasPendingChanges) {
        await handleSave();
      }

      if (!validateOrchestratorParams() || !accountId) {
        if (!accountId) {
          Message.error(t("workItems.agentSettings.noCodeAccountError"));
        }
        return;
      }

      const displayWorkItemCompleted =
        displayWorkItem.workItemStatus === COMPLETED_WORK_ITEM_STATUS ||
        displayWorkItem.status === COMPLETED_WORK_ITEM_STATUS;
      if (
        !displayWorkItemCompleted &&
        displayWorkItem.executionLock?.activeSessionId
      ) {
        Message.warning(t("workItems.agentWorkflow.running"));
        onRefreshWorkItem?.();
        return;
      }

      setIsStartingAgent(true);
      try {
        await invokeTauri(orchestratorCommand, {
          projectSlug,
          workItemId: shortId,
        });

        const sdePrompt = buildSdeTaskPrompt(
          workItem,
          shortId!,
          additionalInstructions,
          agentMode
        );

        const { sessionId: createdSessionId } = await SessionService.create({
          task: sdePrompt,
          repoPath: resolveSessionRepoPath(),
          projectRepoPath: projectRepoPath!,
          accountId,
          model: modelId,
          workItemId: shortId!,
          agentRole: AGENT_ROLE.Sde,
          projectSlug: projectSlug ?? undefined,
          mode: agentMode,
        });

        setActiveAgentSessionId(createdSessionId);
        setActiveAgentRole(AGENT_ROLE.Sde);
        logger.info(
          `${orchestratorCommand} SDE for ${shortId}, sessionId=${createdSessionId}`
        );
        onRefreshWorkItem?.();
      } catch (error) {
        setActiveAgentSessionId(null);
        setActiveAgentRole(null);
        try {
          await invokeTauri(ORCHESTRATOR_COMMAND.Cancel, {
            projectSlug,
            workItemId: shortId,
          });
        } catch (cancelError) {
          logger.warn(
            `Failed to roll back ${orchestratorCommand} for ${shortId}: ${formatOrchestratorError(cancelError)}`
          );
        }
        const msg = formatOrchestratorError(error);
        logger.error(`Failed ${orchestratorCommand} for ${shortId}: ${msg}`);
        Message.error(msg);
        onRefreshWorkItem?.();
      } finally {
        setIsStartingAgent(false);
      }
    },
    [
      hasPendingChanges,
      handleSave,
      validateOrchestratorParams,
      accountId,
      displayWorkItem.executionLock?.activeSessionId,
      displayWorkItem.status,
      displayWorkItem.workItemStatus,
      projectRepoPath,
      projectSlug,
      shortId,
      workItem,
      modelId,
      agentMode,
      resolveSessionRepoPath,
      onRefreshWorkItem,
      t,
    ]
  );

  const handleStartAgent = useCallback(
    (instructions?: string) =>
      launchSdeSession(ORCHESTRATOR_COMMAND.Start, instructions),
    [launchSdeSession]
  );

  const handleRetry = useCallback(
    (instructions?: string) =>
      launchSdeSession(ORCHESTRATOR_COMMAND.Retry, instructions),
    [launchSdeSession]
  );

  const handleCancelAgent = useCallback(async () => {
    if (!validateOrchestratorParams()) return;

    try {
      await invokeTauri(ORCHESTRATOR_COMMAND.Cancel, {
        projectSlug,
        workItemId: shortId,
      });
      logger.info(`Cancelled orchestrator for ${shortId}`);
      onRefreshWorkItem?.();
    } catch (error) {
      const msg = formatOrchestratorError(error);
      logger.error(`Failed to cancel orchestrator: ${msg}`);
      Message.error(msg);
    }
  }, [validateOrchestratorParams, projectSlug, shortId, onRefreshWorkItem]);

  const handleAcceptAsIs = useCallback(async () => {
    if (!validateOrchestratorParams()) return;

    try {
      await invokeTauri(ORCHESTRATOR_COMMAND.Cancel, {
        projectSlug,
        workItemId: shortId,
      });
      onUpdateWorkItem?.({ workItemStatus: "completed" });
      logger.info(`Accepted work item ${shortId} as-is`);
      onRefreshWorkItem?.();
    } catch (error) {
      const msg = formatOrchestratorError(error);
      logger.error(`Failed to accept as-is: ${msg}`);
      Message.error(msg);
    }
  }, [
    validateOrchestratorParams,
    projectSlug,
    shortId,
    onUpdateWorkItem,
    onRefreshWorkItem,
  ]);

  const handleCreateFollowUp = useCallback(async () => {
    if (!validateOrchestratorParams()) return;

    const feedbackSummary =
      workItem.proofOfWork?.review_feedback?.summary ??
      t("workItems.agentWorkflow.reviewRequestedChanges");

    try {
      const newShortId = await invokeTauri<string>(
        ORCHESTRATOR_COMMAND.CreateFollowUp,
        {
          projectSlug,
          parentShortId: shortId,
          reviewFeedback: feedbackSummary,
        }
      );
      logger.info(`Created follow-up ${newShortId} from ${shortId}`);

      await invokeTauri(ORCHESTRATOR_COMMAND.Cancel, {
        projectSlug,
        workItemId: shortId,
      });

      onRefreshWorkItem?.();
      Message.success(
        t("workItems.agentWorkflow.followUpCreated", { shortId: newShortId })
      );
    } catch (error) {
      const msg = formatOrchestratorError(error);
      logger.error(`Failed to create follow-up: ${msg}`);
      Message.error(msg);
    }
  }, [
    validateOrchestratorParams,
    projectSlug,
    shortId,
    workItem.proofOfWork?.review_feedback?.summary,
    onRefreshWorkItem,
    t,
  ]);

  const runningLinkedSession = useMemo(
    () =>
      workItem.linkedSessions?.find(
        (session) => session.status === RUNNING_LINKED_SESSION_STATUS
      ) ?? null,
    [workItem.linkedSessions]
  );
  const isCompletedWorkItem =
    workItem.workItemStatus === COMPLETED_WORK_ITEM_STATUS ||
    workItem.status === COMPLETED_WORK_ITEM_STATUS;
  const hasTerminalOnlyLinkedSessions =
    (workItem.linkedSessions?.length ?? 0) > 0 && !runningLinkedSession;
  const activeExecutionLockSessionId =
    isCompletedWorkItem || hasTerminalOnlyLinkedSessions
      ? null
      : (workItem.executionLock?.activeSessionId ?? null);
  const persistedActiveSessionId =
    activeExecutionLockSessionId ?? runningLinkedSession?.session_id ?? null;
  const canUseLocalActiveSession =
    !isCompletedWorkItem && !hasTerminalOnlyLinkedSessions;
  const effectiveActiveAgentSessionId =
    persistedActiveSessionId ??
    (canUseLocalActiveSession ? activeAgentSessionId : null);
  const effectiveActiveAgentRole = effectiveActiveAgentSessionId
    ? (toAgentRole(runningLinkedSession?.agent_role) ??
      activeAgentRole ??
      AGENT_ROLE.Sde)
    : null;

  useEffect(() => {
    if (!canUseLocalActiveSession && activeAgentSessionId) {
      setActiveAgentSessionId(null);
      setActiveAgentRole(null);
    }
  }, [activeAgentSessionId, canUseLocalActiveSession]);

  const prevPhaseRef = useRef<OrchestratorPhase>(
    (workItem.orchestratorState?.current_phase as OrchestratorPhase) ?? "idle"
  );
  useEffect(() => {
    const phase =
      (workItem.orchestratorState?.current_phase as OrchestratorPhase) ??
      "idle";
    if (prevPhaseRef.current !== phase) {
      prevPhaseRef.current = phase;
      if (
        TERMINAL_PHASES.has(phase) &&
        activeAgentSessionId &&
        !persistedActiveSessionId
      ) {
        setActiveAgentSessionId(null);
        setActiveAgentRole(null);
      }
    }
  }, [
    workItem.orchestratorState?.current_phase,
    activeAgentSessionId,
    persistedActiveSessionId,
  ]);

  useAutoReview({
    workItem,
    projectRepoPath,
    accountId,
    modelId,
    shortId: shortId ?? null,
    projectSlug: projectSlug ?? null,
    resolveSessionRepoPath,
    onRefreshWorkItem,
    isStartingAgent,
    setIsStartingAgent,
    setActiveAgentSessionId,
    setActiveAgentRole,
  });

  useStaleSessionDetection({
    workItem,
    projectRepoPath,
    projectSlug: projectSlug ?? null,
    shortId: shortId ?? null,
    isStartingAgent,
    handleCancelAgent,
    onRefreshWorkItem,
  });

  return {
    isStartingAgent,
    activeAgentSessionId: effectiveActiveAgentSessionId,
    activeAgentRole: effectiveActiveAgentRole,
    handleStartAgent,
    handleRetry,
    handleCancelAgent,
    handleAcceptAsIs,
    handleCreateFollowUp,
    worktreePath,
    projectRepoPath,
  };
}
