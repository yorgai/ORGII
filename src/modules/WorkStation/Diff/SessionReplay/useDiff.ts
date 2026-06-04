/**
 * useDiff
 *
 * Adapts `useSimulatorAppState` for the Diff app: pulls derived entries,
 * applies the current filter, computes per-filter counts, and resolves the
 * entry that should be shown in the right pane (preferring the user's
 * sidebar selection, falling back to the replay cursor's diff, and
 * finally to the newest entry in the active filter bucket).
 */
import { useCallback, useMemo } from "react";

import { simulatorEventsAtom } from "@src/engines/SessionCore/derived/simulatorEvents";
import type { SimulatorAppConfig } from "@src/engines/Simulator/apps/core/types";
import { useSimulatorAppState } from "@src/engines/Simulator/apps/core/useSimulatorAppState";
import { buildConsolidatedSessionReplayDiffSectionItems } from "@src/modules/WorkStation/shared";

import { DIFF_APP_CONFIG } from "./config";
import type { DiffEntry, DiffFilter, SimulatorDiffState } from "./types";

export interface UseDiffOptions {
  /** Active filter tab. */
  filter: DiffFilter;
}

export interface DiffCounts {
  all: number;
  code: number;
  other: number;
}

export interface UseDiffReturn {
  /** All diff entries surfaced by the simulator app state. */
  entries: DiffEntry[];
  /** Entries narrowed by the active filter. */
  filteredEntries: DiffEntry[];
  /** Counts for each filter bucket — drive the tab labels. */
  counts: DiffCounts;
  /** Entry rendered in the right detail pane (after filter resolution). */
  displayEntry: DiffEntry | null;
  /** Sidebar-selected entry id, or null when the cursor is in charge. */
  selectedEntryId: string | null;
  /** Select an entry inside the Diff app without moving the replay cursor. */
  selectEntry: (entryId: string) => void;
}

function applyFilter(entries: DiffEntry[], filter: DiffFilter): DiffEntry[] {
  if (filter === "all") return entries;
  if (filter === "code") return entries.filter((entry) => entry.isCode);
  return entries.filter((entry) => !entry.isCode);
}

export function useDiff({ filter }: UseDiffOptions): UseDiffReturn {
  const { state, selectedItemId, setSelectedItemId } =
    useSimulatorAppState<SimulatorDiffState>({
      // The factory config is component-less; the registry layer is the only
      // surface that supplies a component, so it's safe to widen here.
      config:
        DIFF_APP_CONFIG as unknown as SimulatorAppConfig<SimulatorDiffState>,
      eventsAtomOverride: simulatorEventsAtom,
    });

  const entries = useMemo(() => state.entries ?? [], [state.entries]);

  const counts = useMemo<DiffCounts>(() => {
    const codeEntries = entries.filter((entry) => entry.isCode);
    const otherEntries = entries.filter((entry) => !entry.isCode);
    return {
      all: buildConsolidatedSessionReplayDiffSectionItems(entries).length,
      code: buildConsolidatedSessionReplayDiffSectionItems(codeEntries).length,
      other:
        buildConsolidatedSessionReplayDiffSectionItems(otherEntries).length,
    };
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const base = applyFilter(entries, filter);
    // Keep the currently selected/replay-active entry visible even if it
    // would otherwise be filtered out — surprises like "the row I just
    // clicked vanished" are worse than a one-off ordering bend.
    const activeId = selectedItemId ?? state.selectedEntry?.entryId ?? null;
    if (!activeId) return base;
    if (base.some((entry) => entry.entryId === activeId)) return base;
    const active = entries.find((entry) => entry.entryId === activeId);
    return active ? [...base, active] : base;
  }, [entries, filter, selectedItemId, state.selectedEntry]);

  const displayEntry = useMemo<DiffEntry | null>(() => {
    if (selectedItemId) {
      const match = entries.find((entry) => entry.entryId === selectedItemId);
      if (match) return match;
    }
    if (state.selectedEntry) return state.selectedEntry;
    return filteredEntries[filteredEntries.length - 1] ?? null;
  }, [entries, filteredEntries, selectedItemId, state.selectedEntry]);

  const selectEntry = useCallback(
    (entryId: string) => {
      setSelectedItemId(entryId);
    },
    [setSelectedItemId]
  );

  return {
    entries,
    filteredEntries,
    counts,
    displayEntry,
    selectedEntryId: selectedItemId,
    selectEntry,
  };
}
