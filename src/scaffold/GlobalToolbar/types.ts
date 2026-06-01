import type { ComponentType } from "react";

/**
 * GlobalToolbar Type Definitions
 *
 * Shared types used across toolbar components
 */

// ============================================
// Repository Types
// ============================================

export interface RepoOption {
  id: string;
  name: string;
  repo_url?: string;
  kind?: string;
}

export interface BranchOption {
  label: string;
  value: string;
  subLabel?: string;
}

// ============================================
// Component Props
// ============================================

export interface ToolbarButtonProps {
  icon: ComponentType<Record<string, unknown>>;
  onClick: () => void;
  title: string;
  size?: "small" | "medium" | "large";
  shape?: "square" | "round";
  selected?: boolean;
  disabled?: boolean;
}

export interface ToolbarButtonGroupItem {
  id: string;
  icon: ComponentType<Record<string, unknown>>;
  onClick: () => void;
  title: string;
  selected?: boolean;
}

// ============================================
// State Types
// ============================================

export interface ToolbarLayoutState {
  isMacOS: boolean;
  shouldShowUnfoldButton: boolean;
  needsTrafficLightPadding: boolean;
}
