/**
 * Workflow Types
 *
 * Dropdown / select primitives shared by the AgentOrgs CommandCard
 * configuration surfaces. Domain entity types (sessions, projects, repos,
 * etc.) live in their respective feature modules — this file only carries
 * the workflow-specific dropdown shape and the SESSION_STAGE_OPTIONS list.
 *
 * The previous `AVAILABLE_MODELS` / `AVAILABLE_AGENTS` static lists were
 * removed: workflow dropdowns now read from live registries via
 * `useWorkflowModelOptions` / `useWorkflowAgentOptions`.
 */
import type { ComponentType } from "react";

import { SESSION_STAGES } from "@src/modules/MainApp/AgentOrgs/data/types";

// ============================================
// Core Entity Types
// ============================================

/**
 * Session reference for workflow actions
 */
export interface WorkflowSession {
  id: string;
  name: string;
  repoName?: string;
  branch?: string;
  status?: string;
  isActive?: boolean;
}

/**
 * Project reference for workflow actions
 */
export interface WorkflowProject {
  id: string;
  name: string;
  icon?: string;
  color?: string;
}

/**
 * Work item reference for workflow actions
 */
export interface WorkflowWorkItem {
  id: string;
  name: string;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  projectId?: string;
}

/**
 * Repository reference for workflow actions
 */
export interface WorkflowRepo {
  id: string;
  name: string;
  description?: string;
  repoUrl?: string;
  branch?: string;
  fsUri?: string;
  workspaceUuid?: string;
}

/**
 * Branch reference for workflow actions
 */
export interface WorkflowBranch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  repoId?: string;
}

/**
 * AI Model for workflow actions
 */
export interface WorkflowModel {
  id: string;
  label: string;
  provider?: "anthropic" | "openai" | "google";
}

/**
 * Agent for workflow execution
 */
export interface WorkflowAgent {
  id: string;
  label: string;
  type: WorkflowAgentType;
}

// ============================================
// Status & Priority Types
// ============================================

export type WorkItemStatus =
  | "backlog"
  | "planned"
  | "in_progress"
  | "in_review"
  | "completed"
  | "cancelled"
  | "duplicate";

export type WorkItemPriority = "none" | "urgent" | "high" | "medium" | "low";

/** Agent type for workflow orchestration (short display names) */
export type WorkflowAgentType = "cursor" | "claude" | "orgii";

// ============================================
// Session Stage Types (canonical source: data/types.ts)
// ============================================

export { SESSION_STAGES };
export type { SessionStage } from "@src/modules/MainApp/AgentOrgs/data/types";

// ============================================
// Dropdown Option Type
// ============================================

export interface DropdownOption<T = unknown> {
  label: string;
  value: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  extra?: T;
  disabled?: boolean;
}

// ============================================
// Stage Options
// ============================================

export const SESSION_STAGE_OPTIONS: DropdownOption[] = [
  { label: "Intake", value: SESSION_STAGES.INTAKE },
  { label: "Specification", value: SESSION_STAGES.SPEC },
  { label: "Planning", value: SESSION_STAGES.PLANNING },
  { label: "Execution", value: SESSION_STAGES.EXECUTION },
  { label: "Review", value: SESSION_STAGES.REVIEW },
  { label: "Merge", value: SESSION_STAGES.MERGE },
];
