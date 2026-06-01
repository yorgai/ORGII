/**
 * Search state types.
 * Extracted to avoid circular dependency with searchTabSessionCache.
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

export interface SearchResultFile {
  file_path: string;
  matches: SearchMatch[];
}

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  fileExtensions: string[];
  excludeDirs: string[];
  filesToInclude: string;
  filesToExclude: string;
  onlyOpenFiles: boolean;
}
