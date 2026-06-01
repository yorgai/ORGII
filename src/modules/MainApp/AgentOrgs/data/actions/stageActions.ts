import type {
  ActionDefinition,
  ActionInput,
  SessionStage,
  StageTransition,
} from "../types";
import { SESSION_STAGES } from "../types";

interface StageActionConfig {
  stage: SessionStage;
  title: string;
  description: string;
  icon: string;
  color: string;
  transitions: StageTransition[];
  onFailure: "retry" | "rollback" | "skip" | "pause";
  defaultTimeout?: number;
  maxRetries?: number;
}

const STAGE_INPUTS: (
  defaultTimeout: number,
  stepLabel: string
) => ActionInput[] = (defaultTimeout, stepLabel) => [
  {
    type: "session-select",
    label: "Session",
    labelKey: "agentOrgs.workflowActions.fields.session",
    placeholder: "Select a session",
    placeholderKey: "agentOrgs.workflowActions.placeholders.selectSession",
    defaultValue: null,
  },
  {
    type: "model-select",
    label: "Model",
    labelKey: "agentOrgs.workflowActions.fields.model",
    placeholder: "Select AI model",
    placeholderKey: "agentOrgs.workflowActions.placeholders.selectModel",
    defaultValue: "claude-sonnet-4-20250514",
  },
  {
    type: "agent-select",
    label: "Agent",
    labelKey: "agentOrgs.workflowActions.fields.agent",
    placeholder: "Select agent",
    placeholderKey: "agentOrgs.workflowActions.placeholders.selectAgent",
    defaultValue: "orgii",
  },
  {
    type: "number",
    label: "Timeout",
    labelKey: "agentOrgs.workflowActions.fields.timeout",
    placeholder: "Stage timeout",
    placeholderKey: "agentOrgs.workflowActions.placeholders.stageTimeout",
    defaultValue: defaultTimeout,
    unit: "second",
    unitKey: "agentOrgs.workflowActions.units.second",
  },
  {
    type: "number",
    label: "Max Retries",
    labelKey: "agentOrgs.workflowActions.fields.maxRetries",
    placeholder: "Maximum retry attempts",
    placeholderKey: "agentOrgs.workflowActions.placeholders.maxRetries",
    defaultValue: 3,
  },
  {
    type: "prompt",
    label: "Custom Prompt",
    labelKey: "agentOrgs.workflowActions.fields.customPrompt",
    placeholder: `Optional: Override default ${stepLabel} prompt...`,
    placeholderKey: "agentOrgs.workflowActions.placeholders.customPrompt",
    defaultValue: "",
  },
];

function createStageAction(config: StageActionConfig): ActionDefinition {
  return {
    id: `stage-${config.stage}`,
    type: "session-stage",
    title: config.title,
    titleKey: `agentOrgs.workflowActions.stages.${config.stage}.title`,
    description: config.description,
    descriptionKey: `agentOrgs.workflowActions.stages.${config.stage}.description`,
    icon: config.icon,
    color: config.color,
    category: "Session Workflow",
    categoryKey: "agentOrgs.workflowActions.categories.sessionWorkflow",
    requiredParams: ["session"],
    stageConfig: {
      stage: config.stage,
      transitions: config.transitions,
      ...(config.maxRetries !== undefined
        ? { maxRetries: config.maxRetries }
        : {}),
      onFailure: config.onFailure,
    },
    inputs: STAGE_INPUTS(config.defaultTimeout ?? 300, config.stage),
  };
}

export const stageActions: ActionDefinition[] = [
  createStageAction({
    stage: SESSION_STAGES.INTAKE,
    title: "Intake Stage",
    description: "Gather initial requirements and clarifications",
    icon: "Inbox",
    color: "bg-blue-500",
    transitions: [{ type: "unconditional", targetStage: SESSION_STAGES.SPEC }],
    onFailure: "pause",
  }),
  createStageAction({
    stage: SESSION_STAGES.SPEC,
    title: "Specification Stage",
    description: "Define detailed specifications and requirements",
    icon: "FileText",
    color: "bg-indigo-500",
    transitions: [
      { type: "unconditional", targetStage: SESSION_STAGES.PLANNING },
      {
        type: "conditional",
        targetStage: SESSION_STAGES.INTAKE,
        condition: {
          field: "needs_clarification",
          operator: "equals",
          value: true,
        },
        label: "Needs more info → back to Intake",
      },
    ],
    onFailure: "rollback",
  }),
  createStageAction({
    stage: SESSION_STAGES.PLANNING,
    title: "Planning Stage",
    description: "Break down work into tasks and milestones",
    icon: "ListTodo",
    color: "bg-violet-500",
    transitions: [
      { type: "unconditional", targetStage: SESSION_STAGES.EXECUTION },
      {
        type: "conditional",
        targetStage: SESSION_STAGES.SPEC,
        condition: {
          field: "spec_incomplete",
          operator: "equals",
          value: true,
        },
        label: "Spec incomplete → back to Spec",
      },
    ],
    onFailure: "rollback",
  }),
  createStageAction({
    stage: SESSION_STAGES.EXECUTION,
    title: "Execution Stage",
    description: "Execute planned tasks with AI agents",
    icon: "Play",
    color: "bg-green-500",
    transitions: [
      { type: "unconditional", targetStage: SESSION_STAGES.REVIEW },
      {
        type: "conditional",
        targetStage: SESSION_STAGES.PLANNING,
        condition: {
          field: "task_failed",
          operator: "equals",
          value: true,
        },
        label: "Task failed → re-plan",
      },
    ],
    maxRetries: 3,
    onFailure: "retry",
    defaultTimeout: 600,
  }),
  createStageAction({
    stage: SESSION_STAGES.REVIEW,
    title: "Review Stage",
    description: "Review changes and validate results",
    icon: "Eye",
    color: "bg-amber-500",
    transitions: [
      { type: "unconditional", targetStage: SESSION_STAGES.MERGE },
      {
        type: "conditional",
        targetStage: SESSION_STAGES.EXECUTION,
        condition: {
          field: "changes_requested",
          operator: "equals",
          value: true,
        },
        label: "Changes requested → back to Execution",
      },
      {
        type: "conditional",
        targetStage: SESSION_STAGES.PLANNING,
        condition: {
          field: "major_revision",
          operator: "equals",
          value: true,
        },
        label: "Major revision → back to Planning",
      },
    ],
    onFailure: "pause",
  }),
  createStageAction({
    stage: SESSION_STAGES.MERGE,
    title: "Merge Stage",
    description: "Merge approved changes to target branch",
    icon: "GitMerge",
    color: "bg-teal-500",
    transitions: [],
    onFailure: "pause",
  }),
];
