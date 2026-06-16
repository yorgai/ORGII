/**
 * TurnFilesContext
 *
 * Supplies the per-round modified-file lists (materialized by the Rust turn
 * indexer) down to `GroupItemRenderer` without threading new props through
 * the memoized `ChatHistoryList`. Keyed by turnId; `turnIdByGroupIndex`
 * resolves a display group index to its turnId so the renderer can look up
 * the round's files.
 */
import { createContext, useContext } from "react";

import type { TurnModifiedFile } from "@src/engines/SessionCore/storage/sqliteCache";

export interface TurnFilesContextValue {
  filesByTurnId: Map<string, TurnModifiedFile[]>;
  turnIdByGroupIndex: (string | null)[];
}

const EMPTY_VALUE: TurnFilesContextValue = {
  filesByTurnId: new Map(),
  turnIdByGroupIndex: [],
};

export const TurnFilesContext =
  createContext<TurnFilesContextValue>(EMPTY_VALUE);

export function useTurnFiles(): TurnFilesContextValue {
  return useContext(TurnFilesContext);
}
