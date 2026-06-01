/**
 * Zod schemas for symbol search and code navigation commands.
 *
 * Wire format rules for these commands:
 * - Tauri top-level command arguments: `#[tauri::command]` default maps Rust
 *   `snake_case` parameters to `camelCase` JS keys. Input schemas below use
 *   `camelCase`.
 * - Response structs (`SymbolInfo`, `SymbolSearchResult`, `Location`) have no
 *   `#[serde(rename_all)]`, so those fields stay `snake_case` on the wire.
 */
import { z } from "zod/v4";

// ── Shared value objects ────────────────────────────────────────────────────

export const SymbolInfoSchema = z.object({
  name: z.string(),
  kind: z.string(),
  line: z.number().int(),
  column: z.number().int(),
  end_line: z.number().int(),
  end_column: z.number().int(),
});

export const SymbolSearchResultSchema = z.object({
  file_path: z.string(),
  symbols: z.array(SymbolInfoSchema),
});

export const LocationSchema = z.object({
  file_path: z.string(),
  line: z.number().int(),
  column: z.number().int(),
  end_line: z.number().int(),
  end_column: z.number().int(),
  text: z.string(),
});

export type SymbolInfo = z.output<typeof SymbolInfoSchema>;
export type SymbolSearchResult = z.output<typeof SymbolSearchResultSchema>;
export type Location = z.output<typeof LocationSchema>;

// ── Input schemas ───────────────────────────────────────────────────────────

export const SearchSymbolsInput = z.object({
  query: z.string(),
  repoPaths: z.array(z.string()),
  symbolTypes: z.array(z.string()).optional(),
});

export const GetFileSymbolsInput = z.object({
  filePath: z.string(),
});

export const GotoDefinitionInput = z.object({
  filePath: z.string(),
  line: z.number().int(),
  column: z.number().int(),
});

export const FindReferencesInput = z.object({
  filePath: z.string(),
  line: z.number().int(),
  column: z.number().int(),
});
