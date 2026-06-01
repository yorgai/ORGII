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

import {
  useWorkflowAgentOptions,
  useWorkflowModelOptions,
} from "../../../hooks/useWorkflowModelOptions";
import { SESSION_STAGE_OPTIONS } from "../../../types/workflow";
import InlineDropdown from "../../InlineDropdown";
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
  const agentOptions = useWorkflowAgentOptions();
  const modelOptions = useWorkflowModelOptions();

  return (
    <>
      <span className="text-text-1">Run with</span>
      <InlineDropdown
        value={props.getValue(2) as string}
        onChange={(val) => props.onChange(2, val)}
        options={agentOptions.map((opt) => ({ ...opt, icon: AGENT_ICON }))}
        placeholder="agent"
      />
      <span className="text-text-1">using</span>
      <InlineDropdown
        value={props.getValue(1) as string}
        onChange={(val) => props.onChange(1, val)}
        options={modelOptions.map((opt) => ({ ...opt, icon: MODEL_ICON }))}
        placeholder="model"
        showSearch
      />
      <span className="text-text-1">retry max</span>
      <InlineNumberInput
        value={props.getValue(4) as number}
        onChange={(val) => props.onChange(4, val)}
        min={0}
        max={10}
      />
      <span className="text-text-1">times</span>
      <span className="text-text-1">timeout</span>
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
export const stageTransitionConfig: InlineActionConfig = {
  showInlineInHeader: true,
  template: (props: InlineTemplateProps) => (
    <>
      <span className="whitespace-nowrap font-semibold text-text-1">
        Transition to
      </span>
      <InlineDropdown
        value={props.getValue(1) as string}
        onChange={(val) => props.onChange(1, val)}
        options={SESSION_STAGE_OPTIONS}
        placeholder="stage"
      />
      <span className="whitespace-nowrap text-text-1">stage</span>
    </>
  ),
};

// Start session
export const startSessionConfig: InlineActionConfig = {
  template: () => null,
};

// Workflow config
export const workflowConfigConfig: InlineActionConfig = {
  template: (props: InlineTemplateProps) => (
    <>
      <span className="text-text-1">Configure workflow: auto-approve</span>
      <InlineDropdown
        value={props.getValue(0) as string}
        onChange={(val) => props.onChange(0, val)}
        options={[
          { label: "None (manual)", value: "none" },
          { label: "Intake only", value: "intake" },
          { label: "Intake + Spec", value: "intake-spec" },
          { label: "All except Review", value: "all-except-review" },
          { label: "All (automated)", value: "all" },
        ]}
        placeholder="stages"
      />
      <span className="text-text-1">on failure</span>
      <InlineDropdown
        value={props.getValue(1) as string}
        onChange={(val) => props.onChange(1, val)}
        options={[
          { label: "Pause", value: "pause" },
          { label: "Retry", value: "retry" },
          { label: "Rollback", value: "rollback" },
          { label: "Skip", value: "skip" },
        ]}
        placeholder="action"
      />
      <span className="text-text-1">timeout</span>
      <InlineNumberInput
        value={props.getValue(2) as number}
        onChange={(val) => props.onChange(2, val)}
        min={0}
        unit="s"
      />
    </>
  ),
};
