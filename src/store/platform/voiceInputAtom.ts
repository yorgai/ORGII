/**
 * Voice Input — settings-backed toggle.
 *
 * Controls whether the microphone button appears in composer toolbars
 * (ChatPanel InputArea + SessionCreator EditorArea) and whether the
 * Ctrl+M push-to-talk shortcut is active.
 *
 * Default is ON. Persisted to `~/.orgii/settings.jsonc` via the
 * shared `settingsAtom`.
 */
import { atom } from "jotai";

import {
  settingsAtom,
  updateSettingAtom,
} from "@src/store/settings/settingsAtom";

export const voiceInputEnabledAtom = atom(
  (get) => get(settingsAtom)["general.voiceInputEnabled"] ?? true,
  (_get, set, value: boolean) => {
    set(updateSettingAtom, {
      key: "general.voiceInputEnabled",
      value,
    });
  }
);
voiceInputEnabledAtom.debugLabel = "voiceInputEnabledAtom";
