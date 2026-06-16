import { useCallback, useMemo } from "react";

import { simulatorEventsAtom } from "@src/engines/SessionCore/derived/simulatorEvents";
import type { SimulatorAppConfig } from "@src/engines/Simulator/apps/core/types";
import { useSimulatorAppState } from "@src/engines/Simulator/apps/core/useSimulatorAppState";
import { buildSessionReplayDiffSectionItems } from "@src/modules/WorkStation/shared";

import { DIFF_APP_CONFIG } from "./config";
import type { DiffEntry, SimulatorDiffState } from "./types";

export interface UseDiffReturn {
  /** Replay diff entries. Non-authoritative for final impact; Orgtrack final diffs own final counts. */
  entries: DiffEntry[];
  /** Number of replay diff entries. */
  entryCount: number;
  /** Entry rendered in the right detail pane for replay/focus mode. */
  displayEntry: DiffEntry | null;
  /** Sidebar-selected entry id, or null when the cursor is in charge. */
  selectedEntryId: string | null;
  /** Select an entry inside the Diff app without moving the replay cursor. */
  selectEntry: (entryId: string) => void;
}

function hasRenderableDiffSection(entry: DiffEntry): boolean {
  return buildSessionReplayDiffSectionItems(entry).length > 0;
}

export function useDiff(): UseDiffReturn {
  const { state, selectedItemId, setSelectedItemId } =
    useSimulatorAppState<SimulatorDiffState>({
      config:
        DIFF_APP_CONFIG as unknown as SimulatorAppConfig<SimulatorDiffState>,
      eventsAtomOverride: simulatorEventsAtom,
    });

  const entries = useMemo(
    () => (state.entries ?? []).filter(hasRenderableDiffSection),
    [state.entries]
  );

  const entryCount = entries.length;

  const displayEntry = useMemo<DiffEntry | null>(() => {
    if (selectedItemId) {
      const match = entries.find((entry) => entry.entryId === selectedItemId);
      if (match) return match;
    }
    if (
      state.selectedEntry &&
      entries.some((entry) => entry.entryId === state.selectedEntry?.entryId)
    ) {
      return state.selectedEntry;
    }
    return entries[entries.length - 1] ?? null;
  }, [entries, selectedItemId, state.selectedEntry]);

  const selectEntry = useCallback(
    (entryId: string) => {
      setSelectedItemId(entryId);
    },
    [setSelectedItemId]
  );

  return {
    entries,
    entryCount,
    displayEntry,
    selectedEntryId: selectedItemId,
    selectEntry,
  };
}
