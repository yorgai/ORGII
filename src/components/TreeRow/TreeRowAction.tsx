/**
 * Tree Row Action Button
 *
 * Shared action button for tree rows. Follows the same pattern across:
 * - Source Control (discard, stage/unstage, resolve)
 * - Context Signals (send, dismiss)
 *
 * Button hover drives icon color change (via group/action),
 * NOT the icon's own hover state.
 *
 * Hover tier: parent tree row hovers to fill-2, so the button steps up to
 * fill-3 (or a colored variant background) to remain visible.
 *
 * Variants:
 *   default — bg-fill-3 on hover, icon stays text-text-2
 *   danger  — bg-danger-1 on hover, icon turns text-danger-6
 *   primary — bg-fill-3 on hover, icon turns text-primary-6
 *   success — bg-success-1 on hover, icon stays text-success-6 (static)
 */
import type { LucideIcon } from "lucide-react";
import React, { memo } from "react";

// ============================================
// Types
// ============================================

/** Icon size for tree row action buttons (matches HEADER_ICON_SIZE.sm). */
const TREE_ROW_ACTION_ICON_SIZE = 14;

export interface TreeRowActionProps {
  /** Lucide icon component to render */
  icon: LucideIcon;
  /** Click handler */
  onClick: (event: React.MouseEvent) => void;
  /** Tooltip text */
  title: string;
  /** Color variant (default: "default") */
  variant?: "default" | "danger" | "primary" | "success";
  /** Only show when parent row is hovered (default: true) */
  showOnRowHover?: boolean;
}

// ============================================
// Variant styles
// ============================================

const VARIANT_STYLES = {
  default: {
    buttonBg: "hover:bg-fill-3",
    iconColor: "text-text-2",
  },
  danger: {
    buttonBg: "hover:bg-danger-1",
    iconColor: "text-text-2 group-hover/action:text-danger-6",
  },
  primary: {
    buttonBg: "hover:bg-fill-3",
    iconColor: "text-text-2 group-hover/action:text-primary-6",
  },
  success: {
    buttonBg: "hover:bg-success-1",
    iconColor: "text-success-6",
  },
} as const;

// ============================================
// Component
// ============================================

export const TreeRowAction: React.FC<TreeRowActionProps> = memo(
  ({
    icon: Icon,
    onClick,
    title,
    variant = "default",
    showOnRowHover = true,
  }) => {
    const styles = VARIANT_STYLES[variant];
    const visibilityClass = showOnRowHover
      ? "hidden group-hover/item:flex group-focus-within/item:flex"
      : "flex";

    return (
      <button
        className={`action-btn group/action ${visibilityClass} h-5 w-5 flex-shrink-0 items-center justify-center rounded ${styles.buttonBg}`}
        onClick={onClick}
        title={title}
      >
        <Icon
          size={TREE_ROW_ACTION_ICON_SIZE}
          strokeWidth={1.75}
          className={styles.iconColor}
        />
      </button>
    );
  }
);

TreeRowAction.displayName = "TreeRowAction";
