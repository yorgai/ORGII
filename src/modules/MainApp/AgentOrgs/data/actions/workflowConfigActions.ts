import type { ActionDefinition } from "../types";

export const workflowConfigActions: ActionDefinition[] = [
  {
    id: "stage-transition",
    type: "stage-transition",
    title: "Stage Transition",
    titleKey: "agentOrgs.workflowActions.stageTransition.title",
    description: "Configure conditional or unconditional stage transitions",
    descriptionKey: "agentOrgs.workflowActions.stageTransition.description",
    icon: "ArrowRight",
    color: "bg-slate-500",
    category: "Session Workflow",
    categoryKey: "agentOrgs.workflowActions.categories.sessionWorkflow",
    requiredParams: ["session", "stage"],
    inputs: [
      {
        type: "session-select",
        label: "Session",
        labelKey: "agentOrgs.workflowActions.fields.session",
        placeholder: "Select a session",
        placeholderKey: "agentOrgs.workflowActions.placeholders.selectSession",
        defaultValue: null,
      },
      {
        type: "stage-select",
        label: "Target Stage",
        labelKey: "agentOrgs.workflowActions.fields.targetStage",
        placeholder: "Select target stage",
        placeholderKey:
          "agentOrgs.workflowActions.placeholders.selectTargetStage",
        defaultValue: null,
      },
      {
        type: "select",
        label: "Transition Type",
        labelKey: "agentOrgs.workflowActions.fields.transitionType",
        defaultValue: "unconditional",
        options: [
          {
            label: "Unconditional (always)",
            labelKey: "agentOrgs.workflowActions.transitionTypes.unconditional",
            value: "unconditional",
          },
          {
            label: "Conditional (based on output)",
            labelKey: "agentOrgs.workflowActions.transitionTypes.conditional",
            value: "conditional",
          },
        ],
      },
    ],
  },
  {
    id: "workflow-config",
    type: "workflow-config",
    title: "Session Workflow Config",
    titleKey: "agentOrgs.workflowActions.workflowConfig.title",
    description: "Configure the full session workflow pipeline",
    descriptionKey: "agentOrgs.workflowActions.workflowConfig.description",
    icon: "Settings2",
    color: "bg-gray-600",
    category: "Session Workflow",
    categoryKey: "agentOrgs.workflowActions.categories.sessionWorkflow",
    inputs: [
      {
        type: "select",
        label: "Auto-approve stages",
        labelKey: "agentOrgs.workflowActions.workflowConfig.autoApprove",
        defaultValue: "none",
        options: [
          {
            label: "None (manual approval)",
            labelKey: "agentOrgs.workflowActions.autoApproveOptions.none",
            value: "none",
          },
          {
            label: "Intake only",
            labelKey: "agentOrgs.workflowActions.autoApproveOptions.intake",
            value: "intake",
          },
          {
            label: "Intake + Spec",
            labelKey: "agentOrgs.workflowActions.autoApproveOptions.intakeSpec",
            value: "intake-spec",
          },
          {
            label: "All except Review",
            labelKey:
              "agentOrgs.workflowActions.autoApproveOptions.allExceptReview",
            value: "all-except-review",
          },
          {
            label: "All (fully automated)",
            labelKey: "agentOrgs.workflowActions.autoApproveOptions.all",
            value: "all",
          },
        ],
      },
      {
        type: "select",
        label: "On failure",
        labelKey: "agentOrgs.workflowActions.workflowConfig.onFailure",
        defaultValue: "pause",
        options: [
          {
            label: "Pause and notify",
            labelKey: "agentOrgs.workflowActions.onFailureOptions.pause",
            value: "pause",
          },
          {
            label: "Retry (max 3)",
            labelKey: "agentOrgs.workflowActions.onFailureOptions.retry",
            value: "retry",
          },
          {
            label: "Rollback to previous stage",
            labelKey: "agentOrgs.workflowActions.onFailureOptions.rollback",
            value: "rollback",
          },
          {
            label: "Skip and continue",
            labelKey: "agentOrgs.workflowActions.onFailureOptions.skip",
            value: "skip",
          },
        ],
      },
      {
        type: "number",
        label: "Stage timeout",
        labelKey: "agentOrgs.workflowActions.fields.stageTimeout",
        defaultValue: 300,
        unit: "second",
        unitKey: "agentOrgs.workflowActions.units.second",
      },
    ],
  },
];
