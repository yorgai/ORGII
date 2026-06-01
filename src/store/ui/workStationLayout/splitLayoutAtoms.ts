import { atom } from "jotai";

import { getStoredValue, setStoredValue } from "./storage";

export type LayoutMode = "left" | "right";
export type WorkStationInternalLayoutMode = "compact" | "comfort";

function getStoredLayoutMode(): LayoutMode {
  const stored = getStoredValue("layout_mode");
  if (stored && ["left", "right"].includes(stored)) {
    return stored as LayoutMode;
  }
  return "left";
}

export const workStationLayoutModeAtom = atom<LayoutMode>(
  getStoredLayoutMode()
);
workStationLayoutModeAtom.debugLabel = "workStationLayoutModeAtom";

export const workStationLayoutModePersistAtom = atom(
  (get) => get(workStationLayoutModeAtom),
  (_get, set, value: LayoutMode) => {
    set(workStationLayoutModeAtom, value);
    setStoredValue("layout_mode", value);
  }
);

function getStoredInternalLayoutMode(): WorkStationInternalLayoutMode {
  const stored = getStoredValue("internal_layout_mode");
  if (stored && ["compact", "comfort"].includes(stored)) {
    return stored as WorkStationInternalLayoutMode;
  }
  return "comfort";
}

export const workStationInternalLayoutModeAtom =
  atom<WorkStationInternalLayoutMode>(getStoredInternalLayoutMode());
workStationInternalLayoutModeAtom.debugLabel =
  "workStationInternalLayoutModeAtom";

export const workStationInternalLayoutModePersistAtom = atom(
  (get) => get(workStationInternalLayoutModeAtom),
  (_get, set, value: WorkStationInternalLayoutMode) => {
    set(workStationInternalLayoutModeAtom, value);
    setStoredValue("internal_layout_mode", value);
  }
);
