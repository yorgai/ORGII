import { atomWithStorage } from "jotai/utils";

export const devModeEnabledAtom = atomWithStorage<boolean>(
  "orgii:devModeEnabled",
  true
);
devModeEnabledAtom.debugLabel = "devModeEnabledAtom";
