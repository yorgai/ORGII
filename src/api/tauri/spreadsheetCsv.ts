import { invoke } from "@tauri-apps/api/core";

export interface SpreadsheetCsvPage {
  rows: string[][];
  startRow: number;
  nextRow: number;
  hasMore: boolean;
}

export interface SpreadsheetCsvCellPatch {
  rowIndex: number;
  columnIndex: number;
  value: string;
}

export async function readSpreadsheetCsvPage(params: {
  path: string;
  startRow: number;
  pageSize: number;
}): Promise<SpreadsheetCsvPage> {
  return invoke<SpreadsheetCsvPage>("spreadsheet_csv_read_page", {
    request: params,
  });
}

export async function saveSpreadsheetCsvPatches(params: {
  path: string;
  patches: SpreadsheetCsvCellPatch[];
}): Promise<void> {
  return invoke<void>("spreadsheet_csv_save_patches", {
    request: params,
  });
}
