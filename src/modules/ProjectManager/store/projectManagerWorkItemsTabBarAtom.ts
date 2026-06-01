/**
 * Workstation tab bar actions for Project Manager work-items surfaces.
 *
 * `WorkItemsPage` registers while its tab is active; `ProjectManagerLayout`
 * renders the buttons in `TabBar` trailingSlot. Embedded surfaces (e.g. Agent
 * Factory) omit `workStationTabId` and do not use this atom.
 */
import { atom } from "jotai";

export interface ProjectManagerWorkItemsTabBarPayload {
  workStationTabId: string;
  /** Whether the properties toggle is in the active (panel open) state */
  showPropertiesActive: boolean;
  onSearch: (() => void) | null;
  onRefresh: (() => void) | null;
  refreshLoading: boolean;
  onToggleProperties: (() => void) | null;
  onAddProject: (() => void) | null;
  onAddWorkItem: (() => void) | null;
}

export const projectManagerWorkItemsTabBarAtom =
  atom<ProjectManagerWorkItemsTabBarPayload | null>(null);

projectManagerWorkItemsTabBarAtom.debugLabel =
  "projectManagerWorkItemsTabBarAtom";
