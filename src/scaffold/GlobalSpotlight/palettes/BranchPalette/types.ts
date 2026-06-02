/**
 * BranchPalette Types
 */
import type React from "react";

import type { BasePaletteProps } from "../../shared";
import type { BranchItem, SpotlightItem } from "../../types";

export type BranchPaletteMode = "checkout" | "add" | "add-from" | "remove";

export interface BranchPaletteProps extends BasePaletteProps {
  /** Callback when a branch is selected (checkout) */
  onSelect: (branchName: string, branch: BranchItem) => void;
  /** Repository ID to fetch branches for */
  repoId: string;
  /** Repository path (optional - will be looked up from atoms if not provided) */
  repoPath?: string;
  /** Repository name (for display) */
  repoName?: string;
  /** Currently selected branch name */
  currentBranchName?: string;
  /** Callback to create a new branch */
  onCreateBranch?: (branchName: string, startPoint?: string) => void;
  /** Callback to delete a branch */
  onDeleteBranch?: (branchName: string) => void | Promise<void>;
  /** Callback to checkout detached HEAD (current commit) */
  onCheckoutDetached?: () => void;

  // ============ GITHUB REMOTE REPO ============

  /** GitHub connection ID (for remote repos) */
  githubConnectionId?: string;
  /** GitHub repo full name (for remote repos) */
  githubRepoFullName?: string;

  // ============ VARIANT CONFIG ============

  /** Variant: "global" (default) or "create-session" */
  variant?: "global" | "create-session";
  /** Whether to show the remove mode (default: true for global, false for create-session) */
  showRemoveMode?: boolean;
  /** Render only the palette body when wrapped by a parent SpotlightShell. */
  asBody?: boolean;
  /** Hide the path pill close affordance. */
  hideActionClose?: boolean;
  /** Notifies an embedding shell when the internal mode changes. */
  onModeChange?: (mode: BranchPaletteMode) => void;
}

export interface UseBranchPaletteOptions {
  isOpen: boolean;
  repoId: string;
  repoPathProp?: string;
  currentBranchName?: string;
  onSelect: (branchName: string, branch: BranchItem) => void;
  onCreateBranch?: (branchName: string, startPoint?: string) => void;
  onDeleteBranch?: (branchName: string) => void | Promise<void>;
  onCheckoutDetached?: () => void;
  onClose: () => void;
  onGoBackToParent?: () => void;
  // Variant config
  variant: "global" | "create-session";
  effectiveShowRemoveMode: boolean;
  /** Treat the base checkout view as a dismissible parent sub-flow. */
  parentModalState?: boolean;
  // GitHub
  githubConnectionId?: string;
  githubRepoFullName?: string;
}

export interface UseBranchFetchOptions {
  isOpen: boolean;
  repoId: string;
  repoPath: string;
  isGitHubRepo: boolean;
  githubConnectionId?: string;
  githubRepoFullName?: string;
}

export interface UseBranchItemsOptions {
  activeMode: BranchPaletteMode;
  branches: BranchItem[];
  filteredBranches: BranchItem[];
  searchQuery: string;
  currentBranchName?: string;
  effectiveShowRemoveMode: boolean;
  onSelect: (branchName: string, branch: BranchItem) => void;
  onCreateBranch?: (branchName: string, startPoint?: string) => void;
  onDeleteBranch?: (branchName: string) => void | Promise<void>;
  onCheckoutDetached?: () => void;
  onClose: () => void;
  setActiveMode: (mode: BranchPaletteMode) => void;
  setSelectedStartPoint: (point: string | null) => void;
  focusInput: () => void;
  selectedBranchNames: Set<string>;
  toggleBranchSelection: (branchName: string) => void;
  renderBranchRemoveAction?: (branch: BranchItem) => React.ReactNode;
  pinnedActionItems?: SpotlightItem[];
}
