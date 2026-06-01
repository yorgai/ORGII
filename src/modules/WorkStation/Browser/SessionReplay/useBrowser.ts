/**
 * useBrowser Hook
 *
 * Hook for managing browser simulator state.
 * Handles both browser (external, Playwright/CDP) and internal_browser (DOM automation) subtools.
 */
import { useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";

import { replayModeAtom } from "@src/engines/SessionCore/core/atoms";
import { useSimulatorAppState } from "@src/engines/Simulator/apps/core/useSimulatorAppState";

import { BROWSER_APP_CONFIG } from "./config";
import type {
  BrowserEntry,
  InternalBrowserEntry,
  SimulatorBrowserState,
} from "./types";

export interface UseBrowserOptions {
  overrideEventId?: string;
}

export interface UseBrowserReturn {
  // External browser subtool (Playwright/CDP)
  browserEntries: BrowserEntry[];
  activeEntry: BrowserEntry | null;
  currentUrl: string | null;

  // Internal browser subtool
  internalBrowserEntries: InternalBrowserEntry[];
  activeInternalEntry: InternalBrowserEntry | null;
  activeWebview: string | null;
  isMaskShown: boolean;

  // Combined state
  activeSubtool: "browser" | "internal_browser" | null;
  selectedEntryId: string | null;
  selectEntry: (entryId: string) => void;
  isReplaying: boolean;
  jumpToEvent: (eventId: string) => void;
}

export function useBrowser(options: UseBrowserOptions = {}): UseBrowserReturn {
  const { state, selectedItemId, setSelectedItemId, isReplaying, jumpToEvent } =
    useSimulatorAppState<SimulatorBrowserState>({
      config: BROWSER_APP_CONFIG as never,
      overrideEventId: options.overrideEventId,
    });
  const setReplayMode = useSetAtom(replayModeAtom);

  const {
    browserEntries,
    activeEntry,
    currentUrl,
    internalBrowserEntries,
    activeInternalEntry,
    activeWebview,
    isMaskShown,
    activeSubtool,
  } = state;

  // Clicking a tab or sidebar entry within this app is free-browsing: the
  // user is picking a past artifact to inspect, which is incompatible with
  // follow-mode (where the agent decides what's on screen). Flip replayMode
  // to "replay" and update the local selection only — do NOT move the
  // replay bar or global currentEventId. Use `jumpToEvent` for explicit
  // time-travel (e.g. the global event tab bar).
  const selectEntry = useCallback(
    (entryId: string) => {
      setSelectedItemId(entryId);
      setReplayMode("replay");
    },
    [setSelectedItemId, setReplayMode]
  );

  // Display entry for external browser subtool
  const displayEntry = useMemo(() => {
    if (selectedItemId) {
      const agentEntry = browserEntries.find(
        (entry: BrowserEntry) => entry.entryId === selectedItemId
      );
      if (agentEntry) return agentEntry;
    }
    return activeEntry;
  }, [selectedItemId, browserEntries, activeEntry]);

  // Display entry for internal browser subtool
  const displayInternalEntry = useMemo(() => {
    if (selectedItemId) {
      const internalEntry = internalBrowserEntries.find(
        (entry) => entry.entryId === selectedItemId
      );
      if (internalEntry) return internalEntry;
    }
    return activeInternalEntry;
  }, [selectedItemId, internalBrowserEntries, activeInternalEntry]);

  const displayUrl = useMemo(() => {
    if (displayEntry) return displayEntry.url;
    return currentUrl;
  }, [displayEntry, currentUrl]);

  return {
    // External browser subtool
    browserEntries,
    activeEntry: displayEntry,
    currentUrl: displayUrl,

    // Internal browser subtool
    internalBrowserEntries,
    activeInternalEntry: displayInternalEntry,
    activeWebview,
    isMaskShown,

    // Combined state
    activeSubtool,
    selectedEntryId: selectedItemId,
    selectEntry,
    isReplaying,
    jumpToEvent,
  };
}
