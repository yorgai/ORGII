/**
 * Settings Toolbar Atom
 *
 * Pub-sub channel used by Settings pages to register header actions
 * (refresh button, loading state).
 *
 * Lives in src/store/ui/ so shared header surfaces can read it without
 * reaching into a module's private store path.
 */
import { atom } from "jotai";

export interface SettingsToolbarEntry {
  onRefresh?: () => void;
  loading?: boolean;
}

export const settingsToolbarAtom = atom<SettingsToolbarEntry>({});
settingsToolbarAtom.debugLabel = "settings/toolbar";
