/**
 * Zod schemas for regex / streaming / fast code search commands.
 *
 * Wire format rules for these commands:
 * - Tauri top-level command arguments: `#[tauri::command]` default maps Rust
 *   `snake_case` parameters to `camelCase` JS keys. Input schemas below use
 *   `camelCase` for top-level fields.
 * - Nested objects (`SearchFilters`) and response structs (`CodeSearchResult`,
 *   `SearchMatch`) have no `#[serde(rename_all)]`, so those fields stay
 *   `snake_case` on the wire. Do not convert them.
 */
import { z } from "zod/v4";

// ── Shared value objects ────────────────────────────────────────────────────

export const SearchFiltersSchema = z.object({
  file_extensions: z.array(z.string()).nullish(),
  exclude_dirs: z.array(z.string()).nullish(),
  case_sensitive: z.boolean().nullish(),
  whole_word: z.boolean().nullish(),
  use_regex: z.boolean().nullish(),
  max_results: z.number().int().nullish(),
});

export const SearchMatchSchema = z.object({
  line: z.number().int(),
  column: z.number().int(),
  end_line: z.number().int(),
  end_column: z.number().int(),
  text: z.string(),
  context_before: z.string(),
  context_after: z.string(),
});

export const CodeSearchResultSchema = z.object({
  file_path: z.string(),
  matches: z.array(SearchMatchSchema),
});

export type SearchFilters = z.output<typeof SearchFiltersSchema>;
export type SearchMatch = z.output<typeof SearchMatchSchema>;
export type CodeSearchResult = z.output<typeof CodeSearchResultSchema>;

// ── Input schemas ───────────────────────────────────────────────────────────

export const SearchCodeRegexInput = z.object({
  query: z.string(),
  repoPaths: z.array(z.string()),
  filters: SearchFiltersSchema.optional(),
});

export const SearchCodeStreamingInput = z.object({
  searchId: z.string(),
  query: z.string(),
  repoPath: z.string(),
  filters: SearchFiltersSchema.optional(),
});

export const CancelSearchInput = z.object({
  searchId: z.string(),
});

export const SearchCodeFastInput = z.object({
  searchId: z.string(),
  query: z.string(),
  repoPath: z.string(),
  filters: SearchFiltersSchema.optional(),
});
