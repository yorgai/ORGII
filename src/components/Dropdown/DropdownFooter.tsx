/**
 * DropdownFooter Component
 *
 * Reusable footer for dropdown panels. Matches the multi-select footer layout:
 * flex, items-center, gap-2, border-t, p-1.
 *
 * Use for:
 * - Multi-select actions (Select All / primary button)
 * - Custom actions (e.g. "Clear", "Add new")
 *
 * @example
 * ```tsx
 * <DropdownFooter>
 *   <button onClick={onSelectAll}>Select All</button>
 *   <Button onClick={onPrimary}>Import (3)</Button>
 * </DropdownFooter>
 *
 * <DropdownFooter>
 *   <span className="text-text-3 text-xs">Optional hint</span>
 *   <Button size="small" onClick={onDone}>Done</Button>
 * </DropdownFooter>
 * ```
 */
import React from "react";

import { DROPDOWN_CLASSES } from "./tokens";

export interface DropdownFooterProps {
  children: React.ReactNode;
  className?: string;
}

const DropdownFooter: React.FC<DropdownFooterProps> = ({
  children,
  className = "",
}) => {
  return (
    <div className={`${DROPDOWN_CLASSES.footerContainer} ${className}`}>
      {children}
    </div>
  );
};

export default DropdownFooter;
