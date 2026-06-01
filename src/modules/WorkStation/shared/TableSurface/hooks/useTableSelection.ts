import { useCallback, useState } from "react";

import { clampTableCell, tableRange } from "../tableSurfaceUtils";
import type { TableCellAddress, TableCellRange } from "../types";

interface UseTableSelectionArgs {
  rowCount: number;
  columnCount: number;
  onRevealCell?: (cell: TableCellAddress) => void;
}

export function useTableSelection({
  rowCount,
  columnCount,
  onRevealCell,
}: UseTableSelectionArgs) {
  const [activeCell, setActiveCell] = useState<TableCellAddress | null>(null);
  const [selectionAnchor, setSelectionAnchor] =
    useState<TableCellAddress | null>(null);
  const [selectionRange, setSelectionRange] = useState<TableCellRange | null>(
    null
  );

  const selectCell = useCallback(
    (cell: TableCellAddress) => {
      const nextCell = clampTableCell(cell, rowCount, columnCount);
      setActiveCell(nextCell);
      setSelectionAnchor(nextCell);
      setSelectionRange(tableRange(nextCell, nextCell));
      onRevealCell?.(nextCell);
    },
    [columnCount, onRevealCell, rowCount]
  );

  const extendSelectionTo = useCallback(
    (cell: TableCellAddress) => {
      const anchor = selectionAnchor ?? activeCell ?? cell;
      const nextCell = clampTableCell(cell, rowCount, columnCount);
      setActiveCell(nextCell);
      setSelectionAnchor(anchor);
      setSelectionRange(tableRange(anchor, nextCell));
      onRevealCell?.(nextCell);
    },
    [activeCell, columnCount, onRevealCell, rowCount, selectionAnchor]
  );

  const getActiveRange = useCallback((): TableCellRange | null => {
    if (selectionRange) return selectionRange;
    if (!activeCell) return null;
    return tableRange(activeCell, activeCell);
  }, [activeCell, selectionRange]);

  const clearSelection = useCallback(() => {
    setActiveCell(null);
    setSelectionAnchor(null);
    setSelectionRange(null);
  }, []);

  return {
    activeCell,
    selectionAnchor,
    selectionRange,
    setActiveCell,
    setSelectionAnchor,
    setSelectionRange,
    selectCell,
    extendSelectionTo,
    getActiveRange,
    clearSelection,
  };
}
