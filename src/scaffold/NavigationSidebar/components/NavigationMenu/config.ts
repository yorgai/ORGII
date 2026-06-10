// ============================================
// NavigationMenu Configuration
// ============================================
import type { LucideIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

export interface NavigationMenuRowAction {
  icon?: LucideIcon;
  label: string;
  active?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * Navigation menu item configuration
 * Defines structure for menu items used in sidebar navigation
 *
 * Tab Types:
 * - mainApp: app, terminal, browser
 * - code: editor
 */
export interface NavigationMenuItem {
  id: string;
  key: string;
  label: string;
  /** Optional secondary line rendered below the label (e.g. branch name). */
  subtitle?: ReactNode;
  icon?: LucideIcon | string;
  iconName?: string;
  /** Arbitrary rendered icon — takes precedence over `icon` when set. */
  iconElement?: ReactNode;
  /** Optional element rendered at the far right edge of the row. */
  trailingElement?: ReactNode;
  /**
   * Status indicator (e.g. "working" breathing dot) rendered at the trailing
   * edge but BEFORE the grid-stacked content, and NOT faded out on hover.
   * Use when a state must remain visible while hover-only content
   * (timestamps, action buttons) is shown.
   */
  workingIndicator?: ReactNode;
  /** Shows a chevron to indicate the row opens a deeper sidebar level. */
  showDrillDownIndicator?: boolean;
  visualTone?: "default" | "secondary";
  /** Show hover-only row action buttons. */
  showMoreActions?: boolean;
  rowActions?: NavigationMenuRowAction[];
  rowActionIcon?: LucideIcon;
  rowActionLabel?: string;
  onRowActionClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  routePath?: string;
  /** Tab type for proper tab handling */
  tabType?: "app" | "terminal" | "browser" | "editor";
  children?: NavigationMenuItem[];
  shortcut?: string;
  disabled?: boolean;
  dataTestId?: string;
}
