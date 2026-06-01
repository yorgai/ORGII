import type { ReactNode } from "react";

/**
 * Event Block Types
 */

/**
 * Header row composition (see `EventBlockHeaderTextSlots.tsx`):
 * **icon** (`EventBlockHeaderIcon`) → **title** → **subtitle** → **info** (all optional except icon + title in most blocks).
 */
export interface EventBlockHeaderProps {
  /** Whether the block is collapsed */
  isCollapsed: boolean;
  /** Whether to show hover effects and border */
  withHover?: boolean;
  /** Navigate handler — when provided, shows MoveDiagonal icon on hover */
  onNavigate?: () => void;
  /** Left content: typically icon + title + subtitle + info (see `EventBlockHeaderTextSlots`) */
  children: ReactNode;
  /** Additional right content (optional) */
  rightContent?: ReactNode;
  /** Click handler */
  onClick?: () => void;
  /** Mouse enter handler */
  onMouseEnter?: () => void;
  /** Mouse leave handler */
  onMouseLeave?: () => void;
  /** Additional className */
  className?: string;
}
