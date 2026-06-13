/**
 * Search API Types
 *
 * Shared type definitions for regex, symbol, streaming, and helper modules.
 */

export interface SearchMatch {
  line: number;
  column: number;
  end_line: number;
  end_column: number;
  text: string;
  context_before: string;
  context_after: string;
}

export interface CodeSearchResult {
  file_path: string;
  matches: SearchMatch[];
}

export interface SymbolInfo {
  name: string;
  kind: string;
  line: number;
  column: number;
  end_line: number;
  end_column: number;
}

export interface SymbolSearchResult {
  file_path: string;
  symbols: SymbolInfo[];
}

export interface Location {
  file_path: string;
  line: number;
  column: number;
  end_line: number;
  end_column: number;
  text: string;
}

export interface SearchFilters {
  file_extensions?: string[];
  exclude_dirs?: string[];
  case_sensitive?: boolean;
  whole_word?: boolean;
  use_regex?: boolean;
  max_results?: number;
}

export interface LanguageInfo {
  language_ids: string[];
  extensions: string[];
}

export interface SearchResultEvent {
  search_id: string;
  result: CodeSearchResult;
  emitted_matches: number;
  emitted_files: number;
  actual_matches: number;
  actual_files: number;
}

export interface SearchCompleteEvent {
  search_id: string;
  emitted_matches: number;
  emitted_files: number;
  total_matches: number;
  total_files: number;
  duration_ms: number;
  has_more: boolean;
}

export interface IncrementalIndexResult {
  files_updated: number;
  files_failed: number;
  failed_paths: string[];
}
export interface SemanticHit {
  repo_id: string;
  repo_path: string;
  relative_path: string;
  language: string;
  content: string;
  start_line: number;
  end_line: number;
  score: number;
}

export interface EmbeddingModelStatus {
  installed: boolean;
  model_size_bytes?: number;
  model_dir: string;
}

export interface USearchIndexInfo {
  collection_name?: string;
  vector_count?: number;
  index_size_bytes?: number;
}

export type SearchMode = "regex" | "symbol";
