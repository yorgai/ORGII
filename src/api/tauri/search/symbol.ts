/**
 * Symbol Search & Code Navigation API
 *
 * Symbol search (functions, classes, variables) and code navigation
 * (go-to-definition, find-references).
 */
import { rpc } from "@src/api/tauri/rpc";

import type {
  LanguageInfo,
  Location,
  SymbolInfo,
  SymbolSearchResult,
} from "./types";

// ============================================
// Symbol Search
// ============================================

export async function searchSymbols(
  query: string,
  repoPaths: string[],
  symbolTypes?: string[]
): Promise<SymbolSearchResult[]> {
  return rpc.searchSymbol.search({
    query,
    repoPaths,
    symbolTypes,
  }) as Promise<SymbolSearchResult[]>;
}

export async function getFileSymbols(filePath: string): Promise<SymbolInfo[]> {
  return rpc.searchSymbol.getFileSymbols({
    filePath,
  }) as Promise<SymbolInfo[]>;
}

// ============================================
// Code Navigation
// ============================================

export async function gotoDefinition(
  filePath: string,
  line: number,
  column: number
): Promise<Location[]> {
  return rpc.searchSymbol.gotoDefinition({
    filePath,
    line,
    column,
  }) as Promise<Location[]>;
}

export async function findReferences(
  filePath: string,
  line: number,
  column: number
): Promise<Location[]> {
  return rpc.searchSymbol.findReferences({
    filePath,
    line,
    column,
  }) as Promise<Location[]>;
}

export async function getSupportedLanguages(): Promise<LanguageInfo[]> {
  return rpc.searchSymbol.getSupportedLanguages() as unknown as Promise<
    LanguageInfo[]
  >;
}
