/**
 * useSearchQuery Hook
 *
 * Manages search query and options state via Jotai atoms.
 * Provides the input side of the search functionality.
 */
import { useAtom } from "jotai";
import { useCallback } from "react";

import {
  type SearchOptions as StoreSearchOptions,
  searchOptionsAtom,
  searchQueryAtom,
} from "@src/store/workstation/codeEditor/search";

import type { SearchOptions } from "../types";
import { toUIOptions } from "./transformers";

export interface UseSearchQueryReturn {
  /** Current search query */
  query: string;
  /** Set search query */
  setQuery: (query: string) => void;
  /** Search options (UI format) */
  options: SearchOptions;
  /** Update search options */
  setOptions: (options: Partial<SearchOptions>) => void;
  /** Raw store options (for execution hooks) */
  storeOptions: StoreSearchOptions;
}

export function useSearchQuery(): UseSearchQueryReturn {
  // Read from Jotai atoms
  const [query, setQueryAtom] = useAtom(searchQueryAtom);
  const [storeOptions, setStoreOptions] = useAtom(searchOptionsAtom);

  // Convert store options to UI format
  const options = toUIOptions(storeOptions);

  const setQuery = useCallback(
    (newQuery: string) => {
      setQueryAtom(newQuery);
    },
    [setQueryAtom]
  );

  const setOptions = useCallback(
    (newOptions: Partial<SearchOptions>) => {
      setStoreOptions((prev) => ({
        ...prev,
        caseSensitive: newOptions.caseSensitive ?? prev.caseSensitive,
        wholeWord: newOptions.wholeWord ?? prev.wholeWord,
        useRegex: newOptions.useRegex ?? prev.useRegex,
        fileExtensions: newOptions.fileExtensions ?? prev.fileExtensions,
        excludeDirs: newOptions.excludeDirs ?? prev.excludeDirs,
        filesToInclude: newOptions.filesToInclude ?? prev.filesToInclude,
        filesToExclude: newOptions.filesToExclude ?? prev.filesToExclude,
        onlyOpenFiles: newOptions.onlyOpenFiles ?? prev.onlyOpenFiles,
      }));
    },
    [setStoreOptions]
  );

  return {
    query,
    setQuery,
    options,
    setOptions,
    storeOptions,
  };
}
