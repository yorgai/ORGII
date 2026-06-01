import { describe, expect, it } from "vitest";

import {
  clampTableCell,
  defaultFormatTableCellValue,
  getTableCellAfterMove,
  getTablePrintableCharacter,
  isCellInTableRange,
  tableCellKey,
  tableColumnLabel,
  tableRange,
} from "../tableSurfaceUtils";
import type { TableCellAddress, TableCellRange } from "../types";

describe("tableColumnLabel", () => {
  it("formats zero-based indexes as spreadsheet column labels", () => {
    expect(tableColumnLabel(0)).toBe("A");
    expect(tableColumnLabel(25)).toBe("Z");
    expect(tableColumnLabel(26)).toBe("AA");
    expect(tableColumnLabel(27)).toBe("AB");
    expect(tableColumnLabel(701)).toBe("ZZ");
    expect(tableColumnLabel(702)).toBe("AAA");
  });

  it("returns an empty label for indexes before the first column", () => {
    expect(tableColumnLabel(-1)).toBe("");
  });
});

describe("clampTableCell", () => {
  it("clamps row and column indexes within table bounds", () => {
    const cell: TableCellAddress = { rowIndex: 10, columnIndex: -3 };

    expect(clampTableCell(cell, 4, 5)).toEqual({
      rowIndex: 3,
      columnIndex: 0,
    });
  });

  it("clamps to the origin when table dimensions are empty", () => {
    expect(clampTableCell({ rowIndex: 12, columnIndex: 8 }, 0, 0)).toEqual({
      rowIndex: 0,
      columnIndex: 0,
    });
  });
});

describe("tableRange", () => {
  it("normalizes anchor and target addresses regardless of drag direction", () => {
    expect(
      tableRange(
        { rowIndex: 7, columnIndex: 2 },
        { rowIndex: 3, columnIndex: 5 }
      )
    ).toEqual({
      startRow: 3,
      endRow: 7,
      startColumn: 2,
      endColumn: 5,
    });
  });
});

describe("isCellInTableRange", () => {
  const range: TableCellRange = {
    startRow: 2,
    endRow: 4,
    startColumn: 1,
    endColumn: 3,
  };

  it("includes cells on range boundaries", () => {
    expect(isCellInTableRange({ rowIndex: 2, columnIndex: 1 }, range)).toBe(
      true
    );
    expect(isCellInTableRange({ rowIndex: 4, columnIndex: 3 }, range)).toBe(
      true
    );
  });

  it("excludes cells outside the row or column bounds", () => {
    expect(isCellInTableRange({ rowIndex: 1, columnIndex: 2 }, range)).toBe(
      false
    );
    expect(isCellInTableRange({ rowIndex: 3, columnIndex: 4 }, range)).toBe(
      false
    );
  });
});

describe("getTableCellAfterMove", () => {
  it("moves one cell in each navigation direction", () => {
    const origin: TableCellAddress = { rowIndex: 2, columnIndex: 2 };

    expect(getTableCellAfterMove(origin, "up", 5, 5)).toEqual({
      rowIndex: 1,
      columnIndex: 2,
    });
    expect(getTableCellAfterMove(origin, "down", 5, 5)).toEqual({
      rowIndex: 3,
      columnIndex: 2,
    });
    expect(getTableCellAfterMove(origin, "left", 5, 5)).toEqual({
      rowIndex: 2,
      columnIndex: 1,
    });
    expect(getTableCellAfterMove(origin, "right", 5, 5)).toEqual({
      rowIndex: 2,
      columnIndex: 3,
    });
  });

  it("does not move beyond table edges", () => {
    expect(
      getTableCellAfterMove({ rowIndex: 0, columnIndex: 0 }, "up", 2, 2)
    ).toEqual({
      rowIndex: 0,
      columnIndex: 0,
    });
    expect(
      getTableCellAfterMove({ rowIndex: 1, columnIndex: 1 }, "right", 2, 2)
    ).toEqual({
      rowIndex: 1,
      columnIndex: 1,
    });
  });
});

describe("getTablePrintableCharacter", () => {
  it("returns a single printable key unchanged", () => {
    expect(getTablePrintableCharacter("x")).toBe("x");
    expect(getTablePrintableCharacter(" ")).toBe(" ");
  });

  it("returns null for non-single-character key names", () => {
    expect(getTablePrintableCharacter("Enter")).toBeNull();
    expect(getTablePrintableCharacter("")).toBeNull();
  });
});

describe("tableCellKey", () => {
  it("serializes a cell address into a stable key", () => {
    expect(tableCellKey({ rowIndex: 12, columnIndex: 4 })).toBe("12:4");
  });
});

describe("defaultFormatTableCellValue", () => {
  it("formats nullish and primitive values", () => {
    expect(defaultFormatTableCellValue(null)).toBe("NULL");
    expect(defaultFormatTableCellValue(undefined)).toBe("");
    expect(defaultFormatTableCellValue("text")).toBe("text");
    expect(defaultFormatTableCellValue(42)).toBe("42");
    expect(defaultFormatTableCellValue(false)).toBe("false");
  });

  it("serializes array and object values as JSON", () => {
    expect(defaultFormatTableCellValue(["a", 1])).toBe('["a",1]');
    expect(defaultFormatTableCellValue({ status: "ok", count: 2 })).toBe(
      '{"status":"ok","count":2}'
    );
  });
});
