import { RefreshCw } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import type {
  LinkedSession,
  OrchestratorConfig,
  OrchestratorPhase,
  OrchestratorState,
  ProofOfWork,
  WorkItemExecutionLock,
} from "@src/api/http/project";
import Button from "@src/components/Button";
import { useRefreshSpin } from "@src/hooks/ui";
import { SECTION_CONTAINER_CLASSES } from "@src/modules/shared/layouts/SectionLayout/tokens";
import { CollapsibleSection } from "@src/modules/shared/layouts/blocks";

import type { AgentRole } from "../../constants";
import {
  ActivePhaseStatus,
  AwaitingUserState,
  CompletedState,
  FailedState,
  IdleState,
  InterruptedState,
} from "./PhaseStates";
import PipelineStepper from "./PipelineStepper";
import ReviewFeedbackPanel from "./ReviewFeedbackPanel";
import SessionRunHistory from "./SessionRunHistory";
import { useSessionRunsGrouping } from "./hooks/useSessionRunsGrouping";

interface AgentWorkflowProps {
  orchestratorState?: OrchestratorState;
  orchestratorConfig?: OrchestratorConfig;
  proofOfWork?: ProofOfWork;
  executionLock?: WorkItemExecutionLock | null;
  linkedSessions?: LinkedSession[];
  onStartAgent?: (instructions?: string) => void;
  isStartingAgent?: boolean;
  onRetry?: () => void;
  onCancel?: () => void;
  onResume?: () => void;
  onAcceptAsIs?: () => void;
  onCreateFollowUp?: () => void;
  onOpenSession?: (sessionId: string, title?: string) => void;
  onOpenFileAtLine?: (filePath: string, line?: number) => void;
  onRefresh?: () => void;
  activeAgentSessionId?: string | null;
  activeAgentRole?: AgentRole | null;
}

const AgentWorkflow: React.FC<AgentWorkflowProps> = ({
  orchestratorState,
  orchestratorConfig,
  proofOfWork,
  executionLock,
  linkedSessions = [],
  onStartAgent,
  isStartingAgent,
  onRetry,
  onCancel,
  onResume,
  onAcceptAsIs,
  onCreateFollowUp,
  onOpenSession,
  onOpenFileAtLine,
  onRefresh,
  activeAgentSessionId,
  activeAgentRole,
}) => {
  const { t } = useTranslation("projects");
  const phase: OrchestratorPhase = orchestratorState?.current_phase ?? "idle";
  const { spinClass, handleClick: handleRefreshClick } = useRefreshSpin(
    onRefresh ?? (() => {}),
    false
  );

  const { cycleCount, sessionRuns, subAgentsByParent, hasRuns } =
    useSessionRunsGrouping({ linkedSessions, activeAgentSessionId });

  const titleAction =
    phase !== "idle" && onRefresh ? (
      <Button
        variant="tertiary"
        size="mini"
        icon={<RefreshCw size={12} className={spinClass} />}
        onClick={handleRefreshClick}
        title={t("common:actions.refresh")}
      />
    ) : undefined;

  const hasReviewFeedback = !!proofOfWork?.review_feedback;
  const reviewOutcome = proofOfWork?.review_feedback?.outcome;
  const showCompletedBadge =
    phase === "completed" &&
    !(hasReviewFeedback && reviewOutcome === "approved");

  return (
    <CollapsibleSection
      title={t("workItems.agentWorkflow.title")}
      defaultOpen={true}
      actions={titleAction}
    >
      <div className={`${SECTION_CONTAINER_CLASSES} space-y-2 p-3`}>
        {phase !== "idle" && (
          <PipelineStepper currentPhase={phase} cycleCount={cycleCount} />
        )}

        {phase === "idle" && (
          <IdleState
            orchestratorConfig={orchestratorConfig}
            executionLock={executionLock}
            onStartAgent={onStartAgent}
            isStartingAgent={isStartingAgent}
          />
        )}
        {(phase === "sde" || phase === "review" || phase === "follow_up") && (
          <ActivePhaseStatus phase={phase} onCancel={onCancel} />
        )}
        {showCompletedBadge && (
          <CompletedState
            orchestratorConfig={orchestratorConfig}
            executionLock={executionLock}
            onStartAgent={onStartAgent}
            isStartingAgent={isStartingAgent}
          />
        )}
        {phase === "failed" && (
          <FailedState
            orchestratorState={orchestratorState}
            onRetry={onRetry}
            onCancel={onCancel}
          />
        )}

        {phase !== "idle" && hasReviewFeedback && (
          <ReviewFeedbackPanel
            latestReview={proofOfWork.review_feedback}
            reviewHistory={proofOfWork.review_history}
            phase={phase}
            compact={phase === "completed"}
            onOpenSession={onOpenSession}
            onOpenFileAtLine={onOpenFileAtLine}
            onRetry={phase === "awaiting_user" ? onRetry : undefined}
            onAcceptAsIs={phase === "awaiting_user" ? onAcceptAsIs : undefined}
            onCreateFollowUp={
              phase === "awaiting_user" ? onCreateFollowUp : undefined
            }
            onCancel={phase === "awaiting_user" ? onCancel : undefined}
          />
        )}

        {phase === "awaiting_user" && !hasReviewFeedback && (
          <AwaitingUserState
            onRetry={onRetry}
            onCancel={onCancel}
            onAcceptAsIs={onAcceptAsIs}
            onCreateFollowUp={onCreateFollowUp}
          />
        )}
        {orchestratorState?.interrupted && (
          <InterruptedState onResume={onResume} onCancel={onCancel} />
        )}

        {(hasRuns || activeAgentSessionId) && (
          <SessionRunHistory
            sessionRuns={sessionRuns}
            subAgentsByParent={subAgentsByParent}
            activeAgentSessionId={activeAgentSessionId}
            activeAgentRole={activeAgentRole}
            phase={phase}
            showOnlyActive={
              phase === "sde" || phase === "review" || phase === "follow_up"
            }
            onOpenSession={onOpenSession}
            onRefresh={onRefresh}
          />
        )}
      </div>
    </CollapsibleSection>
  );
};

export default AgentWorkflow;
