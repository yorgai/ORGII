/**
 * EllipsisDropdown Component
 *
 * Thin wrapper around ToolbarDropdown for the ellipsis (more options) menu.
 * Re-exports the DropdownMenuItem type for backward compatibility.
 */
import React from "react";

import ToolbarDropdown from "../ToolbarDropdown";
import type { ToolbarDropdownItem } from "../ToolbarDropdown/types";

// ============================================
// Types (re-export for backward compat)
// ============================================

export type DropdownMenuItem = ToolbarDropdownItem;

interface EllipsisDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement>;
  menuItems: DropdownMenuItem[];
}

// ============================================
// Component
// ============================================

export const EllipsisDropdown: React.FC<EllipsisDropdownProps> = ({
  isOpen,
  onClose,
  triggerRef,
  menuItems,
}) => (
  <ToolbarDropdown
    isOpen={isOpen}
    onClose={onClose}
    triggerRef={triggerRef}
    items={menuItems}
  />
);

export default EllipsisDropdown;
