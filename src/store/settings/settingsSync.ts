/**
 * Settings Sync
 *
 * Listens to Tauri events from the file watcher and updates the settings atom.
 * Also handles initialization on app startup, including syncing the persisted
 * language preference to i18next after settings load from disk.
 *
 * This should be called once in a root-level component or provider.
 */
import { listen } from "@tauri-apps/api/event";
import i18n from "i18next";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";

import type { SupportedLanguage } from "@src/i18n";
import { LANGUAGE_STORAGE_KEY } from "@src/store/ui/languageAtom";

import {
  handleExternalChangeAtom,
  handleFileDeletedAtom,
  initSettingsAtom,
  settingsAtom,
  settingsLoadedAtom,
} from "./settingsAtom";

/** Tauri event names (must match the Rust constants) */
const SETTINGS_CHANGED_EVENT = "settings-file-changed";
const SETTINGS_DELETED_EVENT = "settings-file-deleted";

/**
 * Hook that initializes the settings system and listens for file changes.
 *
 * Call this once in a top-level component (e.g., App.tsx or a provider).
 *
 * @example
 * ```tsx
 * function App() {
 *   useSettingsSync();
 *   return <MainLayout />;
 * }
 * ```
 */
export function useSettingsSync(): void {
  const initSettings = useSetAtom(initSettingsAtom);
  const handleExternalChange = useSetAtom(handleExternalChangeAtom);
  const handleFileDeleted = useSetAtom(handleFileDeletedAtom);
  const settingsLoaded = useAtomValue(settingsLoadedAtom);
  const settings = useAtomValue(settingsAtom);

  const writingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    initSettings();

    const unlistenChange = listen<Record<string, unknown>>(
      SETTINGS_CHANGED_EVENT,
      (event) => {
        if (cancelled) return;
        if (writingRef.current) {
          writingRef.current = false;
          return;
        }
        handleExternalChange(event.payload);
      }
    );

    const unlistenDelete = listen(SETTINGS_DELETED_EVENT, () => {
      if (cancelled) return;
      handleFileDeleted();
    });

    return () => {
      cancelled = true;
      unlistenChange.then((unlisten) => unlisten());
      unlistenDelete.then((unlisten) => unlisten());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync language to i18next + localStorage after settings load from disk.
  // This bridges the gap between the async settings.jsonc load and the
  // synchronous i18n init that reads localStorage on cold start.
  useEffect(() => {
    if (!settingsLoaded) return;

    const diskLanguage = settings["general.language"] as SupportedLanguage;
    if (!diskLanguage) return;

    if (i18n.language !== diskLanguage) {
      i18n.changeLanguage(diskLanguage);
    }

    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, JSON.stringify(diskLanguage));
    } catch {
      // localStorage may be unavailable
    }
  }, [settingsLoaded, settings]);
}
