/**
 * Search Result Types
 */

export interface SearchMatch {
  line: number;
  column: number;
  end_column?: number;
  text: string;
  context_before: string;
  context_after: string;
}

export interface SearchResultFile {
  file_path: string;
  matches: SearchMatch[];
}
