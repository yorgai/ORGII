import { type ClipboardEvent, useCallback } from "react";

import type { TableCellAddress, TableCellRange } from "../types";

const MAX_CLIPBOARD_TEXT_LENGTH = 100_000;
const MAX_CLIPBOARD_CELL_COUNT = 10_000;

export function parseClipboardText(text: string): string[][] | null {
  if (text.length > MAX_CLIPBOARD_TEXT_LENGTH) return null;
  const rows = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line, index, lines) => index < lines.length - 1 || line !== "")
    .map((line) => line.split("\t"));
  let cellCount = 0;
  for (const row of rows) {
    cellCount += row.length;
    if (cellCount > MAX_CLIPBOARD_CELL_COUNT) return null;
  }
  return rows;
}

function stringifyRangeAsTsv(
  range: TableCellRange,
  getCellValue: (cell: TableCellAddress) => string
): string {
  const lines: string[] = [];
  for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex += 1) {
    const values: string[] = [];
    for (
      let columnIndex = range.startColumn;
      columnIndex <= range.endColumn;
      columnIndex += 1
    ) {
      values.push(getCellValue({ rowIndex, columnIndex }));
    }
    lines.push(values.join("\t"));
  }
  return lines.join("\n");
}

interface UseTableClipboardArgs {
  editable: boolean;
  activeCell: TableCellAddress | null;
  getActiveRange: () => TableCellRange | null;
  getCellValue: (cell: TableCellAddress) => string;
  onPasteCells?: (
    startCell: TableCellAddress,
    values: string[][],
    activeRange: TableCellRange | null
  ) => void;
}

export function useTableClipboard({
  editable,
  activeCell,
  getActiveRange,
  getCellValue,
  onPasteCells,
}: UseTableClipboardArgs) {
  const handleCopy = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (event.target instanceof HTMLInputElement) return;
      const activeRange = getActiveRange();
      if (!activeRange) return;
      event.preventDefault();
      event.clipboardData.setData(
        "text/plain",
        stringifyRangeAsTsv(activeRange, getCellValue)
      );
    },
    [getActiveRange, getCellValue]
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (event.target instanceof HTMLInputElement) return;
      if (!editable || !activeCell || !onPasteCells) return;
      const text = event.clipboardData.getData("text/plain");
      if (text === "") return;
      event.preventDefault();
      const values = parseClipboardText(text);
      if (!values) return;
      onPasteCells(activeCell, values, getActiveRange());
    },
    [activeCell, editable, getActiveRange, onPasteCells]
  );

  return { handleCopy, handlePaste };
}
