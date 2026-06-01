// ============================================
// Workflow Types
// ============================================

export type ActionInputType =
  | "text"
  | "number"
  | "select"
  | "boolean"
  | "file-path"
  | "command"
  | "repo-select"
  | "session-select"
  | "branch-select"
  | "stage-select"
  | "model-select"
  | "agent-select"
  | "prompt"
  | "session-creator";

export interface ActionInput {
  type: ActionInputType;
  /** English fallback. Prefer setting `labelKey` and translating at render time. */
  label?: string;
  /** i18next key (in `integrations` namespace) resolved at render time. */
  labelKey?: string;
  defaultValue?: unknown;
  options?: ActionInputOption[];
  /** English fallback. Prefer setting `placeholderKey`. */
  placeholder?: string;
  /** i18next key (in `integrations` namespace) resolved at render time. */
  placeholderKey?: string;
  /** Unit suffix shown next to numeric inputs (e.g. "second"). */
  unit?: string;
  unitKey?: string;
  dependsOn?: string;
}

export interface ActionInputOption {
  /** English fallback. */
  label: string;
  /** i18next key for the option label. */
  labelKey?: string;
  value: unknown;
}

export interface StageTransition {
  type: "unconditional" | "conditional";
  targetStage: SessionStage;
  condition?: {
    field: string;
    operator:
      | "equals"
      | "not-equals"
      | "contains"
      | "is-empty"
      | "is-not-empty";
    value?: unknown;
  };
  label?: string;
}

/**
 * Stage runtime overrides.
 *
 * `model` and `agent` are stored as opaque IDs that match the live
 * registries (KeyVault model id, AgentDefinition.id). The static
 * AVAILABLE_MODELS / AVAILABLE_AGENTS lists were removed in favour of
 * live data \u2014 see `useWorkflowModelOptions` / `useWorkflowAgentOptions`.
 */
export interface StageVariables {
  model: string;
  agent?: string;
  prompt?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface StageConfig {
  stage: SessionStage;
  transitions: StageTransition[];
  variables?: StageVariables;
  autoApprove?: boolean;
  timeout?: number;
  maxRetries?: number;
  onFailure?: "retry" | "rollback" | "skip" | "pause";
}

export interface ActionDefinition {
  id: string;
  type: string;
  /** English fallback. Prefer `titleKey` for translated rendering. */
  title: string;
  /** i18next key (in `integrations` namespace). Resolved at render time. */
  titleKey?: string;
  /** English fallback. Prefer `descriptionKey`. */
  description?: string;
  /** i18next key (in `integrations` namespace). */
  descriptionKey?: string;
  icon: string;
  color: string;
  inputs?: ActionInput[];
  category: "Controls" | "Session Workflow" | "Actions";
  /** i18next key for translated category label (used in EditPanel filter pills). */
  categoryKey?: string;
  requiredParams?: ("repo" | "branch" | "session" | "path" | "stage")[];
  stageConfig?: StageConfig;
}

export interface ActionInstance {
  id: string;
  definitionId: string;
  data: Record<string, unknown>;
  branchType?: "if-true" | "if-false" | "loop-body";
  parentIfId?: string;
  parentLoopId?: string;
  nestingLevel?: number;
}

export const SESSION_STAGES = {
  INTAKE: "intake",
  SPEC: "spec",
  PLANNING: "planning",
  EXECUTION: "execution",
  REVIEW: "review",
  MERGE: "merge",
} as const;

export type SessionStage = (typeof SESSION_STAGES)[keyof typeof SESSION_STAGES];

export const SESSION_STAGE_OPTIONS = [
  { label: "Intake", value: SESSION_STAGES.INTAKE },
  { label: "Specification", value: SESSION_STAGES.SPEC },
  { label: "Planning", value: SESSION_STAGES.PLANNING },
  { label: "Execution", value: SESSION_STAGES.EXECUTION },
  { label: "Review", value: SESSION_STAGES.REVIEW },
  { label: "Merge", value: SESSION_STAGES.MERGE },
];
