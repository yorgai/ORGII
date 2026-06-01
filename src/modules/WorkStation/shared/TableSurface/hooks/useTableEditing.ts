import { useCallback, useState } from "react";

import { clampTableCell } from "../tableSurfaceUtils";
import type { TableCellAddress } from "../types";

interface UseTableEditingArgs {
  editable: boolean;
  rowCount: number;
  columnCount: number;
  getCellValue: (cell: TableCellAddress) => string;
  onCellChange?: (cell: TableCellAddress, value: string) => void;
  onSelectCell: (cell: TableCellAddress) => void;
  onFocusViewport: () => void;
}

export function useTableEditing({
  editable,
  rowCount,
  columnCount,
  getCellValue,
  onCellChange,
  onSelectCell,
  onFocusViewport,
}: UseTableEditingArgs) {
  const [editingCell, setEditingCell] = useState<TableCellAddress | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [selectDraftOnFocus, setSelectDraftOnFocus] = useState(false);

  const updateCellValue = useCallback(
    (cell: TableCellAddress, value: string) => {
      if (!editable || !onCellChange) return;
      onCellChange(cell, value);
    },
    [editable, onCellChange]
  );

  const startEditing = useCallback(
    (cell: TableCellAddress, initialValue?: string) => {
      if (!editable) return;
      const nextCell = clampTableCell(cell, rowCount, columnCount);
      onSelectCell(nextCell);
      setEditingCell(nextCell);
      setDraftValue(initialValue ?? getCellValue(nextCell));
      setSelectDraftOnFocus(initialValue === undefined);
    },
    [columnCount, editable, getCellValue, onSelectCell, rowCount]
  );

  const cancelEditing = useCallback(() => {
    setEditingCell(null);
    setDraftValue("");
    setSelectDraftOnFocus(false);
    onFocusViewport();
  }, [onFocusViewport]);

  const commitEditing = useCallback(
    (nextCell?: TableCellAddress) => {
      if (!editingCell) return;
      updateCellValue(editingCell, draftValue);
      setEditingCell(null);
      setDraftValue("");
      setSelectDraftOnFocus(false);
      if (nextCell) {
        onSelectCell(nextCell);
      }
      onFocusViewport();
    },
    [draftValue, editingCell, onFocusViewport, onSelectCell, updateCellValue]
  );

  const resetEditing = useCallback(() => {
    setEditingCell(null);
    setDraftValue("");
    setSelectDraftOnFocus(false);
  }, []);

  return {
    editingCell,
    draftValue,
    selectDraftOnFocus,
    setDraftValue,
    setEditingCell,
    updateCellValue,
    startEditing,
    cancelEditing,
    commitEditing,
    resetEditing,
  };
}
