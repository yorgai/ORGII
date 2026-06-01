import type { TableCellAddress, TableCellRange } from "./types";

export const TABLE_ROW_HEIGHT = 32;
export const TABLE_HEADER_HEIGHT = 32;
export const TABLE_ROW_NUMBER_WIDTH = 42;
export const TABLE_DEFAULT_COLUMN_WIDTH = 150;
export const TABLE_OVERSCAN = 6;

export function tableColumnLabel(index: number): string {
  let label = "";
  let value = index + 1;

  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }

  return label;
}

export function clampTableCell(
  cell: TableCellAddress,
  rowCount: number,
  columnCount: number
): TableCellAddress {
  return {
    rowIndex: Math.max(0, Math.min(Math.max(0, rowCount - 1), cell.rowIndex)),
    columnIndex: Math.max(
      0,
      Math.min(Math.max(0, columnCount - 1), cell.columnIndex)
    ),
  };
}

export function tableRange(
  anchor: TableCellAddress,
  target: TableCellAddress
): TableCellRange {
  return {
    startRow: Math.min(anchor.rowIndex, target.rowIndex),
    endRow: Math.max(anchor.rowIndex, target.rowIndex),
    startColumn: Math.min(anchor.columnIndex, target.columnIndex),
    endColumn: Math.max(anchor.columnIndex, target.columnIndex),
  };
}

export function isCellInTableRange(
  cell: TableCellAddress,
  range: TableCellRange
): boolean {
  return (
    cell.rowIndex >= range.startRow &&
    cell.rowIndex <= range.endRow &&
    cell.columnIndex >= range.startColumn &&
    cell.columnIndex <= range.endColumn
  );
}

export type TableNavigationDirection = "up" | "down" | "left" | "right";

export function getTableCellAfterMove(
  cell: TableCellAddress,
  direction: TableNavigationDirection,
  rowCount: number,
  columnCount: number
): TableCellAddress {
  switch (direction) {
    case "up":
      return clampTableCell(
        { ...cell, rowIndex: cell.rowIndex - 1 },
        rowCount,
        columnCount
      );
    case "down":
      return clampTableCell(
        { ...cell, rowIndex: cell.rowIndex + 1 },
        rowCount,
        columnCount
      );
    case "left":
      return clampTableCell(
        { ...cell, columnIndex: cell.columnIndex - 1 },
        rowCount,
        columnCount
      );
    case "right":
      return clampTableCell(
        { ...cell, columnIndex: cell.columnIndex + 1 },
        rowCount,
        columnCount
      );
  }
}

export function getTablePrintableCharacter(key: string): string | null {
  if (key.length !== 1) return null;
  return key;
}

export function tableCellKey(address: TableCellAddress): string {
  return `${address.rowIndex}:${address.columnIndex}`;
}

export function defaultFormatTableCellValue(value: unknown): string {
  if (value === null) return "NULL";
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}
