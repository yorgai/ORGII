import type { SymbolInfo } from "@src/api/tauri/search";

import type { OutlineSymbol, SymbolKind } from "./types";

const VALID_SYMBOL_KINDS: SymbolKind[] = [
  "function",
  "class",
  "interface",
  "type",
  "const",
  "let",
  "var",
  "export",
  "import",
  "method",
  "property",
  "enum",
];

export function mapToOutlineSymbol(
  sym: SymbolInfo,
  filePath: string
): OutlineSymbol {
  const kind: SymbolKind = VALID_SYMBOL_KINDS.includes(sym.kind as SymbolKind)
    ? (sym.kind as SymbolKind)
    : "function";

  return {
    id: `${filePath}:${sym.line}:${sym.column}:${sym.kind}:${sym.name}`,
    name: sym.name,
    kind,
    line: sym.line,
    column: sym.column,
    endLine: sym.end_line,
    endColumn: sym.end_column,
    expanded: true,
    children: [],
  };
}

function isSymbolContainedIn(
  child: OutlineSymbol,
  parent: OutlineSymbol
): boolean {
  if (child.line < parent.line) return false;
  if (child.line === parent.line && child.column <= parent.column) {
    return false;
  }
  if (child.endLine > parent.endLine) return false;
  if (child.endLine === parent.endLine && child.endColumn > parent.endColumn) {
    return false;
  }
  return true;
}

function findParentAndInsert(
  symbol: OutlineSymbol,
  candidates: OutlineSymbol[]
): boolean {
  for (let idx = candidates.length - 1; idx >= 0; idx--) {
    const candidate = candidates[idx];
    if (isSymbolContainedIn(symbol, candidate)) {
      if (candidate.children.length > 0) {
        const insertedInChild = findParentAndInsert(symbol, candidate.children);
        if (insertedInChild) return true;
      }
      candidate.children.push(symbol);
      return true;
    }
  }
  return false;
}

export function buildSymbolTree(flatSymbols: OutlineSymbol[]): OutlineSymbol[] {
  if (flatSymbols.length === 0) return [];

  const sorted = [...flatSymbols].sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    if (a.column !== b.column) return a.column - b.column;
    return b.endLine - b.line - (a.endLine - a.line);
  });

  const rootSymbols: OutlineSymbol[] = [];
  const processed = new Set<string>();

  for (const symbol of sorted) {
    if (processed.has(symbol.id)) continue;
    processed.add(symbol.id);
    const foundParent = findParentAndInsert(symbol, rootSymbols);
    if (!foundParent) {
      rootSymbols.push(symbol);
    }
  }

  return rootSymbols;
}

export function isExtensionSupported(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return ["ts", "tsx", "js", "jsx", "py", "rs"].includes(ext);
}
