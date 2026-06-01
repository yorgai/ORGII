/**
 * PrimarySidebarLayout - Shared primary sidebar layout components
 *
 * Provides consistent sidebar structure for Workstation apps:
 * - CodeEditor (EditorPrimarySidebar)
 * - DatabaseManager (DatabasePrimarySidebar)
 * - Browser (BrowserPrimarySidebar)
 */

export {
  CollapsibleSection,
  default as CollapsibleSectionDefault,
} from "./CollapsibleSection";
export type { CollapsibleSectionProps } from "./CollapsibleSection";

export {
  PrimarySidebarLayoutWithSections,
  PrimarySidebarLayoutWithSections as PrimarySidebarLayout,
  default as PrimarySidebarLayoutDefault,
} from "./PrimarySidebarLayoutWithSections";
export type {
  PrimarySidebarLayoutWithSectionsProps,
  PrimarySidebarLayoutWithSectionsProps as PrimarySidebarLayoutProps,
  PrimarySidebarTab,
  PanelSection,
} from "./PrimarySidebarLayoutWithSections";

export {
  PanelSectionHeader,
  default as PanelSectionHeaderDefault,
} from "./PanelSectionHeader";
export type { PanelSectionHeaderProps } from "./PanelSectionHeader";
