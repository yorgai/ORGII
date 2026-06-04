/**
 * DevRecord Toolbar Atoms
 *
 * Registry pattern: each DevRecord sub-view registers its refresh/filter
 * callbacks keyed by view name. The active view selector lets shared header
 * surfaces display only the current view's actions.
 *
 * Lives in src/store/ui/ so NavigationSidebar and shared headers can read
 * these without reaching into a module's
 * private store path.
 */
import { atom } from "jotai";

export type DevRecordView =
  | "git-dashboard"
  | "coding-profile"
  | "sessions"
  | "other-usage";

export interface DevRecordToolbarEntry {
  onRefresh?: () => void;
  loading?: boolean;
  filterVisible?: boolean;
  onToggleFilter?: () => void;
}

/**
 * Map of view key → toolbar entry. Each sub-view registers its own
 * refresh callback and/or filter toggle on mount; the toolbar picks
 * the active one via devRecordActiveViewAtom.
 */
export const devRecordToolbarRegistryAtom = atom<
  Partial<Record<DevRecordView, DevRecordToolbarEntry>>
>({});
devRecordToolbarRegistryAtom.debugLabel = "devRecord/toolbarRegistry";

export const devRecordActiveViewAtom = atom<DevRecordView>("git-dashboard");
devRecordActiveViewAtom.debugLabel = "devRecord/activeView";
