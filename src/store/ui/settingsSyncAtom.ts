/**
 * Settings Sync Atom
 *
 * A simple timestamp atom used to trigger re-renders when settings
 * change in another window.
 *
 * How it works:
 * 1. useCrossWindowSettingsSync listens for storage events
 * 2. When a setting changes, it updates this timestamp
 * 3. Components using useSyncedSetting re-render and read fresh values
 */
import { atom } from "jotai";

/**
 * Timestamp of the last cross-window settings sync.
 * Updated whenever a setting changes in another window.
 * Components can depend on this to force re-reads from localStorage.
 */
export const settingsSyncTimestampAtom = atom<number>(0);
settingsSyncTimestampAtom.debugLabel = "settingsSyncTimestampAtom";
