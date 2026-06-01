/**
 * Mobile Remote Control state.
 *
 * Read+write atom backed by the `mobileRemote.enabled` setting in the
 * settings JSON registry. Reading goes through `settingsAtom`, writing
 * fans out via `updateSettingAtom` so the settings file stays the
 * single source of truth.
 */
import { atom } from "jotai";

import {
  settingsAtom,
  updateSettingAtom,
} from "@src/store/settings/settingsAtom";

export const mobileRemoteEnabledAtom = atom(
  (get) => get(settingsAtom)["mobileRemote.enabled"],
  (_get, set, value: boolean) => {
    set(updateSettingAtom, { key: "mobileRemote.enabled", value });
  }
);
mobileRemoteEnabledAtom.debugLabel = "mobileRemoteEnabledAtom";
