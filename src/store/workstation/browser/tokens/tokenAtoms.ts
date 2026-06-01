/**
 * Token Atoms - Shared state for design tokens
 *
 * Manages which tokens are "imported" (selected for use in previews)
 */
import { atom } from "jotai";

// ============================================
// Types
// ============================================

export interface TokenDefinition {
  /** Token name (without -- prefix) */
  name: string;
  /** Token value */
  value: string;
  /** Source file path */
  source: string;
}

export interface ImportedToken extends TokenDefinition {
  /** Custom value override (if user edited it) */
  customValue?: string;
}

// ============================================
// Atoms
// ============================================

/**
 * All scanned tokens from the repo
 */
export const scannedTokensAtom = atom<TokenDefinition[]>([]);

/**
 * Imported (selected) tokens - these get injected into previews
 */
export const importedTokensAtom = atom<ImportedToken[]>([]);

/**
 * Whether to auto-import all tokens (vs manual selection)
 */
export const autoImportAllTokensAtom = atom<boolean>(true);

// ============================================
// Derived Atoms
// ============================================

/**
 * Tokens to inject - either all scanned (if auto) or just imported
 */
export const tokensToInjectAtom = atom((get) => {
  const autoImport = get(autoImportAllTokensAtom);
  if (autoImport) {
    return get(scannedTokensAtom);
  }
  return get(importedTokensAtom);
});

/**
 * Generate CSS string from tokens to inject
 */
export const tokenCSSAtom = atom((get) => {
  const tokens = get(tokensToInjectAtom);
  if (tokens.length === 0) return "";

  const rules = tokens
    .map((t) => {
      const value =
        "customValue" in t && t.customValue ? t.customValue : t.value;
      return `  --${t.name}: ${value};`;
    })
    .join("\n");

  return `:root {\n${rules}\n}`;
});

/**
 * Set of imported token names (for quick lookup)
 */
export const importedTokenNamesAtom = atom((get) => {
  const imported = get(importedTokensAtom);
  return new Set(imported.map((t) => t.name));
});
