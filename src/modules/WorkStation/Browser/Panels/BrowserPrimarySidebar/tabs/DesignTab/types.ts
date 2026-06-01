/**
 * Shared types for DesignTab components
 */
import type { ReactNode } from "react";

import type { CatalogEntry } from "@src/modules/WorkStation/Browser/hooks/useComponentCatalog";
import type {
  ProjectFileInfo,
  ProjectInfo,
} from "@src/modules/WorkStation/Browser/hooks/useOrgiiProjects";

// ============================================
// Page Types
// ============================================

export interface PageItem {
  id: string;
  name: string;
  path: string;
  isActive?: boolean;
}

export interface DesignTabPagesProps {
  pages: PageItem[];
  activePageId?: string | null;
  onSelectPage?: (pageId: string) => void;
  /** Whether to show filter input (controlled by parent via header action) */
  showFilter?: boolean;
  /** Callback to register the collapseAll function with parent */
  onRegisterCollapseAll?: (collapseAll: () => void) => void;
}

// ============================================
// Global Tokens Types
// ============================================

export interface DesignTabGlobalTokensProps {
  /** Repository path for token scanning */
  repoPath?: string;
  /** Called when Color Tokens is clicked - opens consolidated tab */
  onOpenColorTokens?: () => void;
  /** Whether to show filter input */
  showFilter?: boolean;
  /** Callback to register the refresh function with parent */
  onRegisterRefresh?: (refresh: () => void) => void;
}

// ============================================
// Added Components Types
// ============================================

export interface DesignTabAddedComponentsProps {
  /** Repository path for component scanning */
  repoPath?: string;
  /** Called when user clicks a component to preview */
  onSelectComponent?: (projectFile: ProjectFileInfo) => void;
  /** Currently selected project file path */
  selectedPath?: string | null;
  /** Whether to show filter input */
  showFilter?: boolean;
  /** Callback to register the refresh function with parent */
  onRegisterRefresh?: (refresh: () => void) => void;
}

// ============================================
// Repo Components Types
// ============================================

export interface DesignTabRepoComponentsProps {
  /** Repository path for component scanning */
  repoPath?: string;
  /** Called when user clicks a component to preview */
  onPreviewComponent?: (entry: CatalogEntry) => void;
  /** Called when user clicks a project to preview */
  onPreviewProject?: (
    entry: CatalogEntry,
    project: ProjectInfo,
    projectFile: ProjectFileInfo
  ) => void;
  /** Whether to show filter input */
  showFilter?: boolean;
  /** Callback to register the collapseAll function with parent */
  onRegisterCollapseAll?: (collapseAll: () => void) => void;
  /** Callback to register the refresh function with parent */
  onRegisterRefresh?: (refresh: () => void) => void;
}

// ============================================
// Action Types
// ============================================

export interface ActionItem {
  key: string;
  icon: ReactNode;
  tooltip: string;
  onClick: () => void;
}

export interface PagesActionsOptions {
  showFilter: boolean;
  onToggleFilter: () => void;
  onCollapseAll?: () => void;
  onAddPage?: () => void;
}

export interface GlobalTokensActionsOptions {
  showFilter: boolean;
  onToggleFilter: () => void;
  onRefresh?: () => void;
}

export interface AddedComponentsActionsOptions {
  showFilter: boolean;
  onToggleFilter: () => void;
  onCollapseAll?: () => void;
  onRefresh?: () => void;
}

export interface CandidatesActionsOptions {
  showFilter: boolean;
  onToggleFilter: () => void;
  onCollapseAll?: () => void;
  onRefresh?: () => void;
}
