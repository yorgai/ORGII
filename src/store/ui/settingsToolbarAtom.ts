/**
 * Settings Toolbar Atom
 *
 * Pub-sub channel used by Settings pages to register toolbar actions
 * (refresh button, loading state) into the GlobalToolbar.
 *
 * Lives in src/store/ui/ so that the scaffold layer (GlobalToolbar) can
 * read it without reaching into a module's private store path.
 */
import { atom } from "jotai";

export interface SettingsToolbarEntry {
  onRefresh?: () => void;
  loading?: boolean;
}

export const settingsToolbarAtom = atom<SettingsToolbarEntry>({});
settingsToolbarAtom.debugLabel = "settings/toolbar";
