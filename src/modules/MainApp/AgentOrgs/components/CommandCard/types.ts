/**
 * CommandCard Types
 *
 * Type definitions for the CommandCard component.
 */
import type { ReactNode } from "react";

import type { ActionDefinition, ActionInstance } from "../../data";
import type { DropdownOption } from "../../types/workflow";

// ============================================
// Variable Types
// ============================================

export type VariableCategory =
  | "text"
  | "repo"
  | "branch"
  | "current-tab"
  | "action-input";

export type RepoProperty = "name" | "local-path" | "github-url";

export interface ActionVariable {
  id: string;
  name: string;
  category: VariableCategory;
  // For 'text' category
  textValue?: string;
  // For 'repo' category
  repoId?: string;
  repoProperty?: RepoProperty;
  // For 'branch' category
  branchRepoId?: string;
  // For 'action-input' category
  actionInputId?: string;
}

// ============================================
// Spotlight Data Types
// ============================================

export interface RepoItem {
  id: string;
  name: string;
  description?: string;
  repo_url?: string;
  branch?: string;
  fs_uri?: string;
  workspace_uuid?: string;
}

export interface SessionItem {
  session_id: string;
  name: string;
  repo_name: string;
  branch: string;
  status: string;
  is_active: boolean;
}

export interface BranchItem {
  name: string;
  is_current: boolean;
  is_remote: boolean;
}

export interface SpotlightData {
  repos: RepoItem[];
  sessions: SessionItem[];
  branches: BranchItem[];
  loadingRepos: boolean;
  loadingSessions: boolean;
  loadingBranches: boolean;
  fetchBranches: (repoId: string) => Promise<void>;
}

// ============================================
// Component Props
// ============================================

export interface CommandCardProps {
  definition: ActionDefinition;
  instance: ActionInstance;
  onUpdate: (newData: Record<string, unknown>) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  isDragging?: boolean;
  spotlightData?: SpotlightData;
  onClick?: () => void;
}

// ============================================
// Inline Template Types
// ============================================

export interface InlineTemplateProps {
  getValue: (key: string | number) => unknown;
  getUnit: (key: string | number) => string | undefined;
  onChange: (key: string | number, value: unknown) => void;
  title: string;
  repoOptions: DropdownOption[];
  spotlightData?: SpotlightData;
}

export interface InlineActionConfig {
  /** React component that renders the inline template */
  template: (props: InlineTemplateProps) => ReactNode;
  /** If true, show the inline template in the header row instead of as separate content (for compact single-line displays like "Wait for [5s]" or "When [trigger]") */
  showInlineInHeader?: boolean;
}
