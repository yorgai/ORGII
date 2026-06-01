/**
 * Browser DevTools collapsed state.
 *
 * DevTools is the Browser app's secondary panel. It has its own
 * collapsed flag — independent from the Code Editor secondary panel
 * and from the primary sidebar — because DevTools toggles with a
 * different shortcut and targets a different surface.
 *
 * Position (right vs. bottom) lives in `secondaryPanelPositionAtoms.ts`
 * as `browserDevToolsPositionAtom`.
 */
import { atom } from "jotai";

import { getStoredValue, setStoredValue } from "./storage";

function getStoredDevToolsCollapsed(): boolean {
  const stored = getStoredValue("devtools_collapsed");
  return stored === "true";
}

export const workStationDevToolsCollapsedAtom = atom<boolean>(
  getStoredDevToolsCollapsed()
);
workStationDevToolsCollapsedAtom.debugLabel =
  "workStationDevToolsCollapsedAtom";

export const workStationDevToolsCollapsedPersistAtom = atom(
  (get) => get(workStationDevToolsCollapsedAtom),
  (get, set, value: boolean | "toggle") => {
    const next =
      value === "toggle" ? !get(workStationDevToolsCollapsedAtom) : value;
    set(workStationDevToolsCollapsedAtom, next);
    setStoredValue("devtools_collapsed", String(next));
  }
);
