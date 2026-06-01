/**
 * PlusDropdown Component
 *
 * Thin wrapper around ToolbarDropdown for the + button's dropdown menu.
 * Used when a route's + button needs to show multiple options (e.g.
 * Integrations Models tab: "Bring your own key" / "Create a ORGII API").
 */
import React from "react";

import ToolbarDropdown from "../ToolbarDropdown";
import type { ToolbarDropdownItem } from "../ToolbarDropdown/types";

interface PlusDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement>;
  items: ToolbarDropdownItem[];
}

export const PlusDropdown: React.FC<PlusDropdownProps> = ({
  isOpen,
  onClose,
  triggerRef,
  items,
}) => (
  <ToolbarDropdown
    isOpen={isOpen}
    onClose={onClose}
    triggerRef={triggerRef}
    items={items}
  />
);

export default PlusDropdown;
