import type { ReactNode } from "react";

/**
 * Shared Types for Work Items and Projects
 *
 * Common types used across work items, projects, and related features.
 */

// ============================================
// Person / User Types
// ============================================

/**
 * Person reference for assignees, leads, members
 */
export interface Person {
  id: string;
  name: string;
  avatar?: string;
  email?: string;
  color?: string;
}

// ============================================
// Label Types
// ============================================

/**
 * Label for categorizing work items and projects
 */
export interface Label {
  id: string;
  name: string;
  color: string;
}

// ============================================
// Team Types
// ============================================

/**
 * Team reference for project assignments
 */
export interface Team {
  id: string;
  name: string;
  icon?: string;
  color?: string;
}

// ============================================
// UI Component Types
// ============================================

/**
 * Context menu item for right-click menus
 */
export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  iconColor?: string;
  secondary?: string;
  shortcut?: string;
  shortcutId?: string;
  keybinding?: string;
  divider?: boolean;
  submenu?: ContextMenuItem[];
  action?: () => void;
  disabled?: boolean;
}

/**
 * Generic dropdown option
 */
export interface DropdownOption<T = string> {
  value: T;
  label: string;
  icon?: ReactNode;
  color?: string;
}
