/**
 * Action Configuration Index
 *
 * Aggregates all action configurations from category-specific files
 */
import type { InlineActionConfig } from "../types";
import { ifConfig, waitConfig } from "./controlConfigs";
import { openExternalEditorConfig } from "./repoConfigs";
import {
  stageExecutionConfig,
  stageIntakeConfig,
  stageMergeConfig,
  stagePlanningConfig,
  stageReviewConfig,
  stageSpecConfig,
  stageTransitionConfig,
  startSessionConfig,
  workflowConfigConfig,
} from "./sessionConfigs";

// ============================================
// Inline Action Configurations
// ============================================

export const INLINE_ACTION_CONFIGS: Record<string, InlineActionConfig> = {
  // Controls
  wait: waitConfig,
  if: ifConfig,

  // Session Stages
  "stage-intake": stageIntakeConfig,
  "stage-spec": stageSpecConfig,
  "stage-planning": stagePlanningConfig,
  "stage-execution": stageExecutionConfig,
  "stage-review": stageReviewConfig,
  "stage-merge": stageMergeConfig,

  // Session Workflow Control
  "stage-transition": stageTransitionConfig,
  "start-session": startSessionConfig,
  "workflow-config": workflowConfigConfig,

  // Repo/Branch Actions
  "open-external-editor": openExternalEditorConfig,
};

// ============================================
// Default Template
// ============================================

export const DEFAULT_TEMPLATE: InlineActionConfig = {
  template: () => null,
};
