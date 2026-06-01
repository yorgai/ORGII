import { useCallback, useMemo, useState } from "react";

import type {
  TableCellAddress,
  TableCellRange,
  TableSurfaceColumn,
  TableSurfaceRow,
} from "@src/modules/WorkStation/shared/TableSurface";

import { INITIAL_VISIBLE_ROWS, ROW_LOAD_INCREMENT } from "./constants";
import {
  cloneSheetsWithData,
  ensureDataSize,
  getSourceColumnCount,
  getSourceRowCount,
  isSingleCellRange,
  normalizeData,
} from "./dataUtils";
import type { SpreadsheetData, SpreadsheetEditorProps } from "./types";

interface UseSpreadsheetTableAdapterArgs {
  sheets: SpreadsheetEditorProps["sheets"];
  activeSheetIndex: number;
  readOnly: boolean;
  onSheetsChange: SpreadsheetEditorProps["onSheetsChange"];
  hasExternalMoreRows: boolean;
  trimTrailingEmptyRowsOnChange: boolean;
  onLoadMoreRows: SpreadsheetEditorProps["onLoadMoreRows"];
}

export function useSpreadsheetTableAdapter({
  sheets,
  activeSheetIndex,
  readOnly,
  onSheetsChange,
  hasExternalMoreRows,
  trimTrailingEmptyRowsOnChange,
  onLoadMoreRows,
}: UseSpreadsheetTableAdapterArgs) {
  const activeSheet = sheets[activeSheetIndex] ?? sheets[0];
  const [visibleRowsBySheet, setVisibleRowsBySheet] = useState<
    Record<number, number>
  >({});

  const sourceData = useMemo(
    () => activeSheet?.data ?? [],
    [activeSheet?.data]
  );
  const sourceRowCount = getSourceRowCount(sourceData);
  const usesExternalRowPaging = Boolean(onLoadMoreRows);
  const currentVisibleRowLimit = usesExternalRowPaging
    ? sourceRowCount
    : (visibleRowsBySheet[activeSheetIndex] ?? INITIAL_VISIBLE_ROWS);
  const visibleSourceRowCount = Math.min(
    sourceRowCount,
    currentVisibleRowLimit
  );
  const hasInternalMoreRows = visibleSourceRowCount < sourceRowCount;
  const hasMoreRows = usesExternalRowPaging
    ? hasExternalMoreRows
    : hasInternalMoreRows;

  const normalizedData = useMemo(
    () => normalizeData(sourceData, visibleSourceRowCount, hasExternalMoreRows),
    [hasExternalMoreRows, sourceData, visibleSourceRowCount]
  );

  const columns = useMemo<TableSurfaceColumn[]>(() => {
    const columnCount = normalizedData[0]?.length ?? 0;
    return Array.from({ length: columnCount }, (_, columnIndex) => ({
      id: `column-${columnIndex}`,
      label: spreadsheetColumnLabel(columnIndex),
    }));
  }, [normalizedData]);

  const rows = useMemo<TableSurfaceRow[]>(
    () =>
      normalizedData.map((row, rowIndex) => ({
        id: `row-${rowIndex}`,
        cells: row,
      })),
    [normalizedData]
  );

  const revealRowsForSheet = useCallback(
    (sheetIndex: number, requiredRowCount: number) => {
      setVisibleRowsBySheet((current) => {
        const currentLimit = current[sheetIndex] ?? INITIAL_VISIBLE_ROWS;
        const nextLimit = Math.max(currentLimit, requiredRowCount);
        if (nextLimit === currentLimit) return current;
        return { ...current, [sheetIndex]: nextLimit };
      });
    },
    []
  );

  const handleLoadMoreRows = useCallback(() => {
    if (onLoadMoreRows) {
      void onLoadMoreRows();
      return;
    }
    revealRowsForSheet(
      activeSheetIndex,
      Math.min(sourceRowCount, visibleSourceRowCount + ROW_LOAD_INCREMENT)
    );
  }, [
    activeSheetIndex,
    onLoadMoreRows,
    revealRowsForSheet,
    sourceRowCount,
    visibleSourceRowCount,
  ]);

  const replaceActiveSheetData = useCallback(
    (nextData: SpreadsheetData) => {
      if (!activeSheet || !onSheetsChange) return;
      onSheetsChange(
        cloneSheetsWithData(
          sheets,
          activeSheetIndex,
          nextData,
          trimTrailingEmptyRowsOnChange
        )
      );
    },
    [
      activeSheet,
      activeSheetIndex,
      onSheetsChange,
      sheets,
      trimTrailingEmptyRowsOnChange,
    ]
  );

  const handleCellChange = useCallback(
    (cell: TableCellAddress, value: string) => {
      if (readOnly || !activeSheet || !onSheetsChange) return;
      const nextData = ensureDataSize(
        sourceData,
        Math.max(sourceData.length, cell.rowIndex + 1),
        Math.max(getSourceColumnCount(sourceData), cell.columnIndex + 1)
      );
      nextData[cell.rowIndex][cell.columnIndex] = value;
      replaceActiveSheetData(nextData);
    },
    [activeSheet, onSheetsChange, readOnly, replaceActiveSheetData, sourceData]
  );

  const handlePasteCells = useCallback(
    (
      startCell: TableCellAddress,
      clipboardData: string[][],
      selectedRange: TableCellRange | null
    ) => {
      if (readOnly || !activeSheet || !onSheetsChange) return;
      const clipboardRowCount = clipboardData.length;
      const clipboardColumnCount = Math.max(
        1,
        ...clipboardData.map((row) => row.length)
      );
      const fillSelectedRange =
        clipboardRowCount === 1 &&
        clipboardColumnCount === 1 &&
        selectedRange !== null &&
        !isSingleCellRange(selectedRange);
      const targetEndRow = fillSelectedRange
        ? selectedRange.endRow
        : startCell.rowIndex + clipboardRowCount - 1;
      const targetEndColumn = fillSelectedRange
        ? selectedRange.endColumn
        : startCell.columnIndex + clipboardColumnCount - 1;
      const nextData = ensureDataSize(
        sourceData,
        Math.max(sourceData.length, targetEndRow + 1),
        Math.max(
          getSourceColumnCount(sourceData),
          columns.length,
          targetEndColumn + 1
        )
      );

      if (!usesExternalRowPaging) {
        revealRowsForSheet(activeSheetIndex, targetEndRow + 1);
      }

      if (fillSelectedRange && selectedRange) {
        fillRange(nextData, selectedRange, clipboardData[0]?.[0] ?? "");
      } else {
        pasteRange(nextData, startCell, clipboardData);
      }

      replaceActiveSheetData(nextData);
    },
    [
      activeSheet,
      activeSheetIndex,
      columns.length,
      onSheetsChange,
      readOnly,
      replaceActiveSheetData,
      revealRowsForSheet,
      sourceData,
      usesExternalRowPaging,
    ]
  );

  const handleClearRange = useCallback(
    (range: TableCellRange) => {
      if (readOnly || !activeSheet || !onSheetsChange) return;
      const nextData = ensureDataSize(
        sourceData,
        Math.max(sourceData.length, range.endRow + 1),
        Math.max(getSourceColumnCount(sourceData), range.endColumn + 1)
      );
      fillRange(nextData, range, "");
      replaceActiveSheetData(nextData);
    },
    [activeSheet, onSheetsChange, readOnly, replaceActiveSheetData, sourceData]
  );

  return {
    activeSheet,
    columns,
    rows,
    hasMoreRows,
    handleLoadMoreRows,
    handleCellChange,
    handlePasteCells,
    handleClearRange,
  };
}

function fillRange(
  data: SpreadsheetData,
  range: TableCellRange,
  value: string
): void {
  for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex += 1) {
    for (
      let columnIndex = range.startColumn;
      columnIndex <= range.endColumn;
      columnIndex += 1
    ) {
      data[rowIndex][columnIndex] = value;
    }
  }
}

function pasteRange(
  data: SpreadsheetData,
  startCell: TableCellAddress,
  clipboardData: string[][]
): void {
  clipboardData.forEach((row, rowOffset) => {
    row.forEach((cellValue, columnOffset) => {
      data[startCell.rowIndex + rowOffset][
        startCell.columnIndex + columnOffset
      ] = cellValue;
    });
  });
}

function spreadsheetColumnLabel(index: number): string {
  let label = "";
  let value = index + 1;

  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }

  return label;
}
