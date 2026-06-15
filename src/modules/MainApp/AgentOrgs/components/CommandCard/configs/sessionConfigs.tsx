/**
 * Session Action Configurations
 *
 * Inline templates for session-related actions (stages, transitions, config).
 *
 * The Run-with template was migrated off the static `AVAILABLE_AGENTS` /
 * `AVAILABLE_MODELS` constants in `data/types.ts` (which were stale and
 * never updated as users connected new providers). It now reads from the
 * live registries via `useWorkflowAgentOptions` / `useWorkflowModelOptions`,
 * so the dropdowns always reflect the user's actual KeyVault accounts and
 * agent definitions.
 */
import { Bot, Brain } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import InlineDropdown from "@src/components/InlineDropdown";

import {
  useWorkflowAgentOptions,
  useWorkflowModelOptions,
} from "../../../hooks/useWorkflowModelOptions";
import { SESSION_STAGE_OPTIONS } from "../../../types/workflow";
import InlineNumberInput from "../../InlineNumberInput";
import type { InlineActionConfig, InlineTemplateProps } from "../types";

// ============================================
// Stage Template Factory
// ============================================

const AGENT_ICON = Bot as React.ComponentType<{
  size?: number;
  className?: string;
}>;
const MODEL_ICON = Brain as React.ComponentType<{
  size?: number;
  className?: string;
}>;

/** Inner component so we can call hooks per render (reads live registries). */
const WorkflowStepTemplate: React.FC<InlineTemplateProps> = (props) => {
  const { t } = useTranslation("integrations");
  const agentOptions = useWorkflowAgentOptions();
  const modelOptions = useWorkflowModelOptions();

  return (
    <>
      <span className="text-text-1">{t("workflowActions.inline.runWith")}</span>
      <InlineDropdown
        value={props.getValue(2) as string}
        onChange={(val) => props.onChange(2, val)}
        options={agentOptions.map((opt) => ({ ...opt, icon: AGENT_ICON }))}
        placeholder={t("workflowActions.inline.agentPlaceholder")}
      />
      <span className="text-text-1">{t("workflowActions.inline.using")}</span>
      <InlineDropdown
        value={props.getValue(1) as string}
        onChange={(val) => props.onChange(1, val)}
        options={modelOptions.map((opt) => ({ ...opt, icon: MODEL_ICON }))}
        placeholder={t("workflowActions.inline.modelPlaceholder")}
        showSearch
      />
      <span className="text-text-1">
        {t("workflowActions.inline.retryMax")}
      </span>
      <InlineNumberInput
        value={props.getValue(4) as number}
        onChange={(val) => props.onChange(4, val)}
        min={0}
        max={10}
      />
      <span className="text-text-1">{t("workflowActions.inline.times")}</span>
      <span className="text-text-1">{t("workflowActions.inline.timeout")}</span>
      <InlineNumberInput
        value={props.getValue(3) as number}
        onChange={(val) => props.onChange(3, val)}
        min={0}
        unit="s"
      />
    </>
  );
};

/**
 * Creates a workflow step action template with consistent structure.
 * The `_stepLabel` is reserved for future per-stage labelling.
 */
export function createWorkflowStepTemplate(
  _stepLabel: string
): InlineActionConfig {
  return {
    template: (props) => <WorkflowStepTemplate {...props} />,
  };
}

// ============================================
// Session Stage Configurations
// ============================================

export const stageIntakeConfig = createWorkflowStepTemplate("intake");
export const stageSpecConfig = createWorkflowStepTemplate("spec");
export const stagePlanningConfig = createWorkflowStepTemplate("planning");
export const stageExecutionConfig = createWorkflowStepTemplate("execution");
export const stageReviewConfig = createWorkflowStepTemplate("review");
export const stageMergeConfig = createWorkflowStepTemplate("merge");

// ============================================
// Session Workflow Control
// ============================================

// Stage transition
const StageTransitionTemplate: React.FC<InlineTemplateProps> = (props) => {
  const { t } = useTranslation("integrations");

  return (
    <>
      <span className="whitespace-nowrap font-semibold text-text-1">
        {t("workflowActions.inline.transitionTo")}
      </span>
      <InlineDropdown
        value={props.getValue(1) as string}
        onChange={(val) => props.onChange(1, val)}
        options={SESSION_STAGE_OPTIONS}
        placeholder={t("workflowActions.inline.stagePlaceholder")}
      />
      <span className="whitespace-nowrap text-text-1">
        {t("workflowActions.inline.stage")}
      </span>
    </>
  );
};

export const stageTransitionConfig: InlineActionConfig = {
  showInlineInHeader: true,
  template: (props) => <StageTransitionTemplate {...props} />,
};

// Start session
export const startSessionConfig: InlineActionConfig = {
  template: () => null,
};

// Workflow config
const WorkflowConfigTemplate: React.FC<InlineTemplateProps> = (props) => {
  const { t } = useTranslation("integrations");

  return (
    <>
      <span className="text-text-1">
        {t("workflowActions.inline.configureAutoApprove")}
      </span>
      <InlineDropdown
        value={props.getValue(0) as string}
        onChange={(val) => props.onChange(0, val)}
        options={[
          { label: t("workflowActions.inline.autoApproveNone"), value: "none" },
          {
            label: t("workflowActions.inline.autoApproveIntake"),
            value: "intake",
          },
          {
            label: t("workflowActions.inline.autoApproveIntakeSpec"),
            value: "intake-spec",
          },
          {
            label: t("workflowActions.inline.autoApproveExceptReview"),
            value: "all-except-review",
          },
          { label: t("workflowActions.inline.autoApproveAll"), value: "all" },
        ]}
        placeholder={t("workflowActions.inline.stagesPlaceholder")}
      />
      <span className="text-text-1">
        {t("workflowActions.inline.onFailure")}
      </span>
      <InlineDropdown
        value={props.getValue(1) as string}
        onChange={(val) => props.onChange(1, val)}
        options={[
          { label: t("workflowActions.inline.failurePause"), value: "pause" },
          { label: t("workflowActions.inline.failureRetry"), value: "retry" },
          {
            label: t("workflowActions.inline.failureRollback"),
            value: "rollback",
          },
          { label: t("workflowActions.inline.failureSkip"), value: "skip" },
        ]}
        placeholder={t("workflowActions.inline.actionPlaceholder")}
      />
      <span className="text-text-1">{t("workflowActions.inline.timeout")}</span>
      <InlineNumberInput
        value={props.getValue(2) as number}
        onChange={(val) => props.onChange(2, val)}
        min={0}
        unit="s"
      />
    </>
  );
};

export const workflowConfigConfig: InlineActionConfig = {
  template: (props) => <WorkflowConfigTemplate {...props} />,
};
