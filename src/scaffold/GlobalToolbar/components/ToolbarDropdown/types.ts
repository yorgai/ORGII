/**
 * Toolbar dropdown types only — no store/theme imports.
 * Store layers (e.g. routeToolbarAtom) import from here to avoid pulling
 * `useCurrentTheme` → `@src/store` circular graphs.
 */
import type { LucideIcon, LucideProps } from "lucide-react";
import type { ComponentType, RefObject } from "react";

/** Lucide icons or brand marks that accept the same size/className props (e.g. MCP logo). */
export type ToolbarDropdownIcon = LucideIcon | ComponentType<LucideProps>;

export interface ToolbarDropdownItem {
  id: string;
  label: string;
  icon: ToolbarDropdownIcon;
  onClick: () => void;
  isDanger?: boolean;
  show?: boolean;
}

export interface ToolbarDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: RefObject<HTMLElement>;
  items: ToolbarDropdownItem[];
}
