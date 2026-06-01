import type {
  SpreadsheetXlsxCellPatch,
  SpreadsheetXlsxSheetInfo,
} from "@src/api/tauri/spreadsheetXlsx";

const MAX_XLSX_DRAFT_CACHE_SIZE = 50;

export interface XlsxDraftSheetState {
  rows: string[][];
  originalRows: string[][];
  patches: SpreadsheetXlsxCellPatch[];
  nextRow: number;
  hasMoreRows: boolean;
}

export interface XlsxDraftEntry {
  sheetInfos: SpreadsheetXlsxSheetInfo[];
  sheetStates: Record<string, XlsxDraftSheetState>;
  activeSheet: number;
}

const draftCache = new Map<string, XlsxDraftEntry>();

if (typeof window !== "undefined") {
  window.addEventListener("filesync:file-discarded", (event) => {
    const path = (event as CustomEvent<{ path?: unknown }>).detail?.path;
    if (typeof path === "string") {
      clearXlsxDraft(path);
    }
  });
}

function cloneRows(rows: string[][]): string[][] {
  return rows.map((row) => [...row]);
}

function cloneSheetStates(
  sheetStates: Record<string, XlsxDraftSheetState>
): Record<string, XlsxDraftSheetState> {
  return Object.fromEntries(
    Object.entries(sheetStates).map(([sheetName, state]) => [
      sheetName,
      {
        rows: cloneRows(state.rows),
        originalRows: cloneRows(state.originalRows),
        patches: state.patches.map((patch) => ({ ...patch })),
        nextRow: state.nextRow,
        hasMoreRows: state.hasMoreRows,
      },
    ])
  );
}

function evictOldestDraftIfNeeded(): void {
  if (draftCache.size < MAX_XLSX_DRAFT_CACHE_SIZE) return;
  const firstKey = draftCache.keys().next().value;
  if (typeof firstKey === "string") {
    draftCache.delete(firstKey);
  }
}

export function getXlsxDraft(filePath: string): XlsxDraftEntry | null {
  const entry = draftCache.get(filePath);
  if (!entry) return null;
  draftCache.delete(filePath);
  draftCache.set(filePath, entry);
  return {
    sheetInfos: entry.sheetInfos.map((sheetInfo) => ({ ...sheetInfo })),
    sheetStates: cloneSheetStates(entry.sheetStates),
    activeSheet: entry.activeSheet,
  };
}

export function setXlsxDraft(filePath: string, entry: XlsxDraftEntry): void {
  draftCache.delete(filePath);
  evictOldestDraftIfNeeded();
  draftCache.set(filePath, {
    sheetInfos: entry.sheetInfos.map((sheetInfo) => ({ ...sheetInfo })),
    sheetStates: cloneSheetStates(entry.sheetStates),
    activeSheet: entry.activeSheet,
  });
}

export function clearXlsxDraft(filePath: string): void {
  draftCache.delete(filePath);
}
