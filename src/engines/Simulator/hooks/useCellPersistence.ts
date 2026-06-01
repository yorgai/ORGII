/**
 * useCellPersistence Hook
 *
 * Manages per-cell persisted state (currentIndex, isPlaying, hasUserOverride)
 * via the global cellReplayStatesAtom. Uses a focused derived atom so writes
 * from other cells don't trigger re-renders here.
 */
import { atom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";

import {
  type CellReplayPersistState,
  cellReplayStatesAtom,
} from "@src/store/ui/simulatorAtom";

export interface CellPersistenceReturn {
  /** This cell's persisted state (may be undefined if never persisted). */
  persistedState: CellReplayPersistState | undefined;
  /** Whether the user has manually detached this cell from the main cursor. */
  hasUserOverride: boolean;
  /** Patch this cell's slice of the global persisted state. */
  patchCellState: (patch: Partial<CellReplayPersistState>) => void;
}

export function useCellPersistence(cellId: string): CellPersistenceReturn {
  const setCellStates = useSetAtom(cellReplayStatesAtom);

  const persistedState = useAtomValue(
    useMemo(
      () =>
        atom((get) => {
          const states = get(cellReplayStatesAtom);
          return states[cellId];
        }),
      [cellId]
    )
  );

  const hasUserOverride = persistedState?.hasUserOverride ?? false;

  const patchCellState = useCallback(
    (patch: Partial<CellReplayPersistState>) => {
      setCellStates((states) => {
        const prev = states[cellId];
        const next = { ...prev, ...patch };
        if (
          prev &&
          prev.currentIndex === next.currentIndex &&
          prev.isPlaying === next.isPlaying &&
          prev.hasUserOverride === next.hasUserOverride
        ) {
          return states;
        }
        return { ...states, [cellId]: next };
      });
    },
    [cellId, setCellStates]
  );

  return { persistedState, hasUserOverride, patchCellState };
}
