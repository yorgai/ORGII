/**
 * Prevent System Sleep — settings-backed toggle.
 *
 * When enabled, the frontend asks the Rust backend to hold a platform
 * sleep-inhibitor (macOS IOPMAssertion / Windows SetThreadExecutionState)
 * for as long as at least one agent session is actively working.
 *
 * The actual acquire/release effect lives in `useSleepInhibitor`; this atom
 * is the persisted user preference, mirrored to `~/.orgii/settings.jsonc`.
 */
import { atom } from "jotai";

import {
  settingsAtom,
  updateSettingAtom,
} from "@src/store/settings/settingsAtom";

export const preventSleepWhileRunningAtom = atom(
  (get) => get(settingsAtom)["general.preventSleepWhileRunning"] ?? false,
  (_get, set, value: boolean) => {
    set(updateSettingAtom, {
      key: "general.preventSleepWhileRunning",
      value,
    });
  }
);
preventSleepWhileRunningAtom.debugLabel = "preventSleepWhileRunningAtom";
