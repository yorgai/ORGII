/**
 * ContextMenu Types
 *
 * TypeScript type definitions for the unified context menu.
 */
import type { KeyboardEvent, MutableRefObject } from "react";

import { MenuItemId, RecentFile, SecondLayerId } from "./config";

// ============================================
// Search Result Item (moved from SearchFile)
// ============================================

export interface SearchResultItem {
  type: "file" | "folder";
  path: string;
  /** Optional display name (if different from path) */
  name?: string;
  /** Optional icon type for special items (terminal, session, project, work item) */
  iconType?: "terminal" | "session" | "project" | "workitem";
}

// ============================================
// Component Props
// ============================================

export interface ContextMenuCustomMentionOption {
  id: string;
  label: string;
  description?: string;
}

export interface ContextMenuProps {
  /** Whether the dropdown is visible */
  visible: boolean;
  /** Callback when dropdown should close */
  onClose: () => void;
  /** Callback when an item is selected (type, path/id, optional display name) */
  onSelect: (type: MenuItemId, value?: string, displayName?: string) => void;
  /** Additional first-class @mention suggestions rendered alongside normal context options. */
  customMentionOptions?: ReadonlyArray<ContextMenuCustomMentionOption>;
  onCustomMentionSelect?: (option: ContextMenuCustomMentionOption) => void;
  /** Current search query (for filtering) */
  searchQuery?: string;
  /** Recent files to show at top */
  recentFiles?: RecentFile[];
  /** Workspace root path for native file search */
  repoPath?: string;
  /** Custom class name */
  className?: string;
  /** Ref to expose keyboard handler to parent */
  keyboardHandlerRef?: MutableRefObject<((e: KeyboardEvent) => boolean) | null>;
  /** Position of file tree preview panel: "left" or "right" (default: "left") */
  treePosition?: "left" | "right";
}

// ============================================
// Hook Types
// ============================================

export interface UseContextMenuOptions {
  /** Repo path for native file search */
  repoPath?: string;
  /** Callback when selection is made (type, path/id, optional display name) */
  onSelect?: (type: MenuItemId, value?: string, displayName?: string) => void;
  /** Callback when dropdown closes */
  onClose?: () => void;
  /**
   * External search query from the parent input (text typed after `@`).
   * When provided, the hook derives secondLayer="files" and uses this as
   * the search query — avoiding two extra setState calls per keystroke.
   */
  externalSearchQuery?: string;
}

export interface UseContextMenuReturn {
  /** Current active menu item index */
  activeIndex: number;
  /** Set active menu item index */
  setActiveIndex: (index: number) => void;
  /** Whether the latest highlight change came from keyboard navigation */
  keyboardNavigated: boolean;
  /** Set keyboard navigation state */
  setKeyboardNavigated: (navigated: boolean) => void;
  /** Current second layer (null if not open) */
  secondLayer: SecondLayerId | null;
  /** Set second layer */
  setSecondLayer: (layer: SecondLayerId | null) => void;
  /** Search query for second layer */
  searchQuery: string;
  /** Set search query */
  setSearchQuery: (query: string) => void;
  /** Search results */
  searchResults: SearchResultItem[];
  /** Whether search is loading */
  searchLoading: boolean;
  /** Active index in second layer */
  secondLayerActiveIndex: number;
  /** Set active index in second layer */
  setSecondLayerActiveIndex: (index: number) => void;
  /** Handle keyboard navigation - returns true if event was handled */
  handleKeyDown: (e: KeyboardEvent) => boolean;
  /** Handle item selection (type, path/id, optional display name) */
  handleSelect: (
    type: MenuItemId,
    value?: string,
    displayName?: string
  ) => void;
  /** Go back to main menu (or from drilled project back to project list) */
  goBack: () => void;
  /** Reset state */
  reset: () => void;
  /** Name of the drilled-into project (null if at project list level) */
  drilledProjectName: string | null;
}

// ============================================
// Internal Types
// ============================================

export interface TerminalItem {
  id: string;
  name: string;
  cwd?: string;
  isActive?: boolean;
}
