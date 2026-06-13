/**
 * Language Preference Atom
 *
 * Stores the user's preferred language.
 * Backed by the central settings system (~/.orgii/settings.jsonc).
 * Also mirrors to localStorage so that i18n can read it synchronously
 * on cold start (before React mounts and settings.jsonc is loaded async).
 *
 * Usage:
 * ```tsx
 * import { useAtom } from 'jotai';
 * import { languageAtom } from '@src/store/ui/languageAtom';
 *
 * function LanguageSelector() {
 *   const [language, setLanguage] = useAtom(languageAtom);
 *   // ...
 * }
 * ```
 */
import { atom } from "jotai";

import type { LanguagePreference } from "@src/i18n";
import {
  settingsAtom,
  updateSettingAtom,
} from "@src/store/settings/settingsAtom";

/** localStorage key used by i18n getPersistedLanguage() on cold start */
export const LANGUAGE_STORAGE_KEY = "app-language";

/**
 * Language preference atom (backed by settings.jsonc)
 */
export const languageAtom = atom(
  (get) => get(settingsAtom)["general.language"] as LanguagePreference,
  (_get, set, value: LanguagePreference) => {
    set(updateSettingAtom, { key: "general.language", value });
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, JSON.stringify(value));
    } catch {
      // localStorage may be unavailable in some edge cases
    }
  }
);
