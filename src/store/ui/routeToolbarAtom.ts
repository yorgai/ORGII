/**
 * Route Toolbar Types
 *
 * Defines per-route toolbar configuration used by route-local header actions.
 * No atoms — the registry is a pure
 * synchronous lookup; runtime context comes from dedicated atoms
 * (e.g. integrationsCategoryAtom).
 */
import type { LucideIcon, LucideProps } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

// ============================================
// Types
// ============================================

export type ToolbarDropdownIcon = LucideIcon | ComponentType<LucideProps>;

export interface ToolbarDropdownItem {
  id: string;
  label: string;
  icon: ToolbarDropdownIcon;
  onClick: () => void;
  isDanger?: boolean;
  show?: boolean;
}

export interface RouteToolbarButton {
  /** Unique identifier for the button */
  id: string;
  /** Fully custom button element. When set, icon/onClick/title fields are ignored by SettingsHeaderActions. */
  element?: ReactNode;
  /** Lucide icon component (use this OR iconElement, not both) */
  icon?: LucideIcon;
  /** Pre-rendered icon element for custom SVGs (use this OR icon, not both) */
  iconElement?: ReactNode;
  /** Click handler */
  onClick: () => void;
  /** Tooltip text */
  title?: string;
  /** Custom tooltip content. When set, native title is disabled. */
  tooltipContent?: ReactNode;
  /** Whether this button is currently selected/active */
  selected?: boolean;
  /** CSS class to apply to the icon element (e.g. spin animation) */
  iconClassName?: string;
  /** Whether the button is disabled (e.g. during refresh spin) */
  disabled?: boolean;
}

export interface RouteToolbarConfig {
  /** Custom ellipsis menu items for this route. When undefined, shows default repo items. */
  ellipsisItems?: ToolbarDropdownItem[];
  /** Extra buttons to add to the toolbar button group (after ellipsis, before +). */
  extraButtons?: RouteToolbarButton[];
  /** Custom handler for the + button. When omitted (and no plusDropdownItems), the + button is hidden. */
  onPlusClick?: () => void;
  /** Custom tooltip for + button when onPlusClick is provided. */
  plusTitle?: string;
  /** Dropdown items for the + button. When set, + opens a dropdown instead of a single action. */
  plusDropdownItems?: ToolbarDropdownItem[];
}
