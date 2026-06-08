/**
 * Shared types for DesignTab components
 */
import type { ReactNode } from "react";

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
