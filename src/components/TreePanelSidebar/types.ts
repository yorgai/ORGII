/**
 * TreePanelSidebar Types
 *
 * Type definitions for the TreePanelSidebar component
 */
import React from "react";

// ============================================
// Tab Configuration
// ============================================

export interface TabConfig<TTab extends string = string> {
  key: TTab;
  label: string;
  icon?: React.ReactNode;
}

// ============================================
// Tree Node Structure
// ============================================

export interface TreePanelNode {
  /** Unique identifier for the node */
  id: string;
  /** Display name */
  name: string;
  /** Full path or identifier */
  path: string;
  /** Node type */
  type: "file" | "directory";
  /** Child nodes (for directories) */
  children?: TreePanelNode[];
  /** Whether the directory is expanded */
  expanded?: boolean;
  /** Optional icon override */
  icon?: React.ReactNode;
  /** Optional secondary text */
  secondaryText?: string;
  /** Whether this node is currently active/selected by agent */
  isAgentSelected?: boolean;

  /** Git status (optional - only present if file has changes) */
  gitStatus?: "modified" | "added" | "deleted" | "renamed" | "conflicted";
  /** Whether git changes are staged */
  gitStaged?: boolean;
  /** Aggregate status for folders (highest priority status of children) */
  aggregateStatus?: "modified" | "added" | "deleted" | "renamed" | "conflicted";

  /** Whether this is a symbolic link */
  isSymlink?: boolean;
  /** Whether this file is ignored by .gitignore */
  isIgnored?: boolean;
}

// ============================================
// Section Header Actions
// ============================================

export type SectionHeaderButtonAction = {
  /** Unique action key */
  key: string;
  /** Icon element */
  icon: React.ReactNode;
  /** Optional label text (displayed next to icon) */
  label?: string;
  /** Tooltip text */
  tooltip: string;
  /** Click callback */
  onClick: () => void;
  /** When true, forces the actions bar to remain visible (e.g. dropdown is open) */
  forceVisible?: boolean;
};

export type SectionHeaderCustomAction = {
  /** Unique action key */
  key: string;
  /** Custom render replacing the default button (for dropdowns, etc.) */
  customRender: React.ReactNode;
  /** When true, forces the actions bar to remain visible (e.g. dropdown is open) */
  forceVisible?: boolean;
};

export type SectionHeaderAction =
  | SectionHeaderButtonAction
  | SectionHeaderCustomAction;

/** Type guard to check if an action uses custom rendering. */
export function isSectionHeaderCustomAction(
  action: SectionHeaderAction
): action is SectionHeaderCustomAction {
  return "customRender" in action;
}

// ============================================
// Main Component Props
// ============================================

export interface TreePanelSidebarProps<TTab extends string = string> {
  /** Tab configuration */
  tabs: TabConfig<TTab>[];
  /** Active tab key */
  activeTab: TTab;
  /** Tab change callback */
  onTabChange: (tab: TTab) => void;
  /** Whether to show only icons in tabs (default: false) */
  tabIconOnly?: boolean;

  /** Search/filter query */
  filterQuery: string;
  /** Filter change callback */
  onFilterChange: (query: string) => void;
  /** Filter placeholder text */
  filterPlaceholder?: string;

  /** Tree data */
  treeData: TreePanelNode[];
  /** Currently selected node path */
  selectedPath: string | null;
  /** Node select callback */
  onSelectNode: (path: string, node: TreePanelNode) => void;
  /** Directory toggle callback */
  onToggleDirectory: (path: string) => void;

  /** Optional: custom node renderer */
  renderNode?: (
    node: TreePanelNode,
    isSelected: boolean,
    depth: number
  ) => React.ReactNode;

  /** Loading state */
  loading?: boolean;
  /** Error message */
  error?: string | null;
  /** Empty state message */
  emptyMessage?: string;
  /** No results message (when filter has no matches) */
  noResultsMessage?: string;

  /** Optional width class */
  widthClass?: string;

  /** Whether tabs should fill available width (default: true) */
  tabsFillWidth?: boolean;

  /** Optional section header title (e.g., repo name) */
  sectionTitle?: string;
  /** Whether section is collapsible (default: false) */
  sectionCollapsible?: boolean;
  /** Default section expanded state (default: true) */
  sectionDefaultExpanded?: boolean;
  /** Action buttons for section header */
  sectionActions?: SectionHeaderAction[];
}
