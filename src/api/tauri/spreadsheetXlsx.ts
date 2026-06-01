import { invoke } from "@tauri-apps/api/core";

export interface SpreadsheetXlsxSheetInfo {
  name: string;
  rowCount: number;
  columnCount: number;
}

export interface SpreadsheetXlsxWorkbookInfo {
  sheets: SpreadsheetXlsxSheetInfo[];
}

export interface SpreadsheetXlsxPage {
  sheetName: string;
  rows: string[][];
  startRow: number;
  nextRow: number;
  hasMore: boolean;
  rowCount: number;
  columnCount: number;
}

export interface SpreadsheetXlsxCellPatch {
  sheetName: string;
  rowIndex: number;
  columnIndex: number;
  value: string;
}

export async function readSpreadsheetXlsxWorkbookInfo(params: {
  path: string;
}): Promise<SpreadsheetXlsxWorkbookInfo> {
  return invoke<SpreadsheetXlsxWorkbookInfo>("spreadsheet_xlsx_workbook_info", {
    request: params,
  });
}

export async function readSpreadsheetXlsxPage(params: {
  path: string;
  sheetName: string;
  startRow: number;
  pageSize: number;
}): Promise<SpreadsheetXlsxPage> {
  return invoke<SpreadsheetXlsxPage>("spreadsheet_xlsx_read_page", {
    request: params,
  });
}

export async function saveSpreadsheetXlsxPatches(params: {
  path: string;
  patches: SpreadsheetXlsxCellPatch[];
}): Promise<void> {
  return invoke<void>("spreadsheet_xlsx_save_patches", {
    request: params,
  });
}
