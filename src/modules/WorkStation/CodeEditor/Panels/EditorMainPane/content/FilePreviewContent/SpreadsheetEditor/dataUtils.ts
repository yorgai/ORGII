import {
  MIN_COLUMNS,
  MIN_ROWS,
  TRAILING_BLANK_COLUMNS,
  TRAILING_BLANK_ROWS,
} from "./constants";
import type {
  CellAddress,
  CellRange,
  NavigationDirection,
  SpreadsheetData,
  SpreadsheetSheet,
} from "./types";

export function columnLabel(index: number): string {
  let label = "";
  let value = index + 1;

  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }

  return label;
}

export function getSourceRowCount(data: SpreadsheetData): number {
  return data.length;
}

export function getSourceColumnCount(data: SpreadsheetData): number {
  return Math.max(0, ...data.map((row) => row.length));
}

export function getRenderedColumnCount(data: SpreadsheetData): number {
  return Math.max(
    MIN_COLUMNS,
    getSourceColumnCount(data) + TRAILING_BLANK_COLUMNS
  );
}

export function normalizeData(
  data: SpreadsheetData,
  visibleSourceRowLimit: number = data.length,
  hasExternalHiddenRows = false
): SpreadsheetData {
  const visibleData = data.slice(0, visibleSourceRowLimit);
  const hasHiddenSourceRows = visibleSourceRowLimit < data.length;
  const shouldAppendTrailingRows =
    !hasHiddenSourceRows && !hasExternalHiddenRows;
  const rowCount = Math.max(
    MIN_ROWS,
    visibleData.length + (shouldAppendTrailingRows ? TRAILING_BLANK_ROWS : 0)
  );
  const columnCount = getRenderedColumnCount(data);

  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const sourceRow = visibleData[rowIndex] ?? [];
    return Array.from({ length: columnCount }, (_, columnIndex) => {
      return sourceRow[columnIndex] ?? "";
    });
  });
}

export function trimData(data: SpreadsheetData): SpreadsheetData {
  const rows = data.map((row) => [...row]);

  while (
    rows.length > 0 &&
    rows[rows.length - 1].every((cell) => cell === "")
  ) {
    rows.pop();
  }

  let maxColumnIndex = -1;
  rows.forEach((row) => {
    row.forEach((cell, columnIndex) => {
      if (cell !== "") {
        maxColumnIndex = Math.max(maxColumnIndex, columnIndex);
      }
    });
  });

  if (maxColumnIndex < 0) {
    return [];
  }

  return rows.map((row) => row.slice(0, maxColumnIndex + 1));
}

export function cloneSheetsWithData(
  sheets: SpreadsheetSheet[],
  sheetIndex: number,
  data: SpreadsheetData,
  trimTrailingEmptyRows = true
): SpreadsheetSheet[] {
  return sheets.map((sheet, index) =>
    index === sheetIndex
      ? { ...sheet, data: trimTrailingEmptyRows ? trimData(data) : data }
      : sheet
  );
}

export function toRange(anchor: CellAddress, target: CellAddress): CellRange {
  return {
    startRow: Math.min(anchor.rowIndex, target.rowIndex),
    endRow: Math.max(anchor.rowIndex, target.rowIndex),
    startColumn: Math.min(anchor.columnIndex, target.columnIndex),
    endColumn: Math.max(anchor.columnIndex, target.columnIndex),
  };
}

export function isCellInRange(cell: CellAddress, range: CellRange): boolean {
  return (
    cell.rowIndex >= range.startRow &&
    cell.rowIndex <= range.endRow &&
    cell.columnIndex >= range.startColumn &&
    cell.columnIndex <= range.endColumn
  );
}

export function areCellsEqual(
  left: CellAddress | null,
  right: CellAddress
): boolean {
  return (
    left?.rowIndex === right.rowIndex && left.columnIndex === right.columnIndex
  );
}

export function clampCell(
  cell: CellAddress,
  rowCount: number,
  columnCount: number
): CellAddress {
  return {
    rowIndex: Math.max(0, Math.min(rowCount - 1, cell.rowIndex)),
    columnIndex: Math.max(0, Math.min(columnCount - 1, cell.columnIndex)),
  };
}

export function getCellAfterMove(
  cell: CellAddress,
  direction: NavigationDirection,
  rowCount: number,
  columnCount: number
): CellAddress {
  switch (direction) {
    case "up":
      return clampCell(
        { ...cell, rowIndex: cell.rowIndex - 1 },
        rowCount,
        columnCount
      );
    case "down":
      return clampCell(
        { ...cell, rowIndex: cell.rowIndex + 1 },
        rowCount,
        columnCount
      );
    case "left":
      return clampCell(
        { ...cell, columnIndex: cell.columnIndex - 1 },
        rowCount,
        columnCount
      );
    case "right":
      return clampCell(
        { ...cell, columnIndex: cell.columnIndex + 1 },
        rowCount,
        columnCount
      );
  }
}

export function getPrintableCharacter(key: string): string | null {
  if (key.length !== 1) return null;
  return key;
}

export function isSingleCellRange(range: CellRange): boolean {
  return (
    range.startRow === range.endRow && range.startColumn === range.endColumn
  );
}

export function getUsedRange(data: SpreadsheetData): CellRange {
  const trimmedData = trimData(data);
  if (trimmedData.length === 0) {
    return toRange(
      { rowIndex: 0, columnIndex: 0 },
      { rowIndex: 0, columnIndex: 0 }
    );
  }

  return toRange(
    { rowIndex: 0, columnIndex: 0 },
    {
      rowIndex: trimmedData.length - 1,
      columnIndex: Math.max(0, getSourceColumnCount(trimmedData) - 1),
    }
  );
}

export function ensureDataSize(
  data: SpreadsheetData,
  rowCount: number,
  columnCount: number
): SpreadsheetData {
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const sourceRow = data[rowIndex] ?? [];
    return Array.from(
      { length: columnCount },
      (_, columnIndex) => sourceRow[columnIndex] ?? ""
    );
  });
}
