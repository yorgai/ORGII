import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  SearchOptions as StoreSearchOptions,
  SearchResultFile as StoreSearchResultFile,
} from "@src/store/workstation/codeEditor/search";
import {
  DEFAULT_SEARCH_TAB_OPTIONS,
  createDefaultSearchTabSessionState,
  getSearchTabSessionState,
  setSearchTabSessionState,
} from "@src/store/workstation/codeEditor/search";

import { SEARCH_CONSTANTS } from "../../../EditorPrimarySidebar/content/SearchContent/config";
import type {
  SearchMode,
  SearchOptions,
  SearchResultFile,
} from "../../../EditorPrimarySidebar/content/SearchContent/types";
import {
  toUIOptions,
  toUIResult,
} from "../../../EditorPrimarySidebar/content/SearchContent/useSearchContent/transformers";
import { useSearchExecution } from "../../../EditorPrimarySidebar/content/SearchContent/useSearchContent/useSearchExecution";

interface UseSearchTabContentOptions {
  repoPath: string;
  openFiles?: string[];
  searchMode: SearchMode;
  sessionScopeId: string;
  initialQuery?: string;
  initialOptions?: StoreSearchOptions;
}

interface UseSearchTabContentReturn {
  query: string;
  setQuery: (value: string) => void;
  options: SearchOptions;
  setOptions: (value: Partial<SearchOptions>) => void;
  results: SearchResultFile[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  actualTotalMatches: number;
  actualTotalFiles: number;
  hasMore: boolean;
  isTruncated: boolean;
}

export function useSearchTabContent({
  repoPath,
  openFiles = [],
  searchMode,
  sessionScopeId,
  initialQuery,
  initialOptions,
}: UseSearchTabContentOptions): UseSearchTabContentReturn {
  const initialState = useMemo(() => {
    const cachedState = getSearchTabSessionState(sessionScopeId);
    if (cachedState) {
      return cachedState;
    }

    const seededState = createDefaultSearchTabSessionState();
    return {
      ...seededState,
      query: initialQuery ?? "",
      options: initialOptions ?? DEFAULT_SEARCH_TAB_OPTIONS,
    };
  }, [sessionScopeId, initialQuery, initialOptions]);
  const [query, setQuery] = useState<string>(initialState.query);
  const [storeOptions, setStoreOptions] = useState<StoreSearchOptions>(
    initialState.options
  );
  const [storeResults, setStoreResults] = useState<StoreSearchResultFile[]>(
    initialState.results
  );
  const [loading, setLoading] = useState<boolean>(initialState.loading);
  const [loadingMore, _setLoadingMore] = useState<boolean>(
    initialState.loadingMore
  );
  const [error, setError] = useState<string | null>(initialState.error);
  const [hasMore, setHasMore] = useState<boolean>(initialState.hasMore);
  const [actualTotalMatches, setActualTotalMatches] = useState<number>(
    initialState.actualTotalMatches
  );
  const [actualTotalFiles, setActualTotalFiles] = useState<number>(
    initialState.actualTotalFiles
  );

  const options = useMemo(() => toUIOptions(storeOptions), [storeOptions]);
  const results = useMemo(() => storeResults.map(toUIResult), [storeResults]);

  const setOptions = useCallback((value: Partial<SearchOptions>) => {
    setStoreOptions((previousOptions) => ({
      ...previousOptions,
      caseSensitive: value.caseSensitive ?? previousOptions.caseSensitive,
      wholeWord: value.wholeWord ?? previousOptions.wholeWord,
      useRegex: value.useRegex ?? previousOptions.useRegex,
      fileExtensions: value.fileExtensions ?? previousOptions.fileExtensions,
      excludeDirs: value.excludeDirs ?? previousOptions.excludeDirs,
      filesToInclude: value.filesToInclude ?? previousOptions.filesToInclude,
      filesToExclude: value.filesToExclude ?? previousOptions.filesToExclude,
      onlyOpenFiles: value.onlyOpenFiles ?? previousOptions.onlyOpenFiles,
    }));
  }, []);

  const resultActions = useMemo(
    () => ({
      setResults: setStoreResults,
      setLoading,
      setError,
      setHasMore,
      setActualTotalMatches,
      setActualTotalFiles,
      appendResults: (incomingResults: StoreSearchResultFile[]) => {
        setStoreResults((previousResults) => [
          ...previousResults,
          ...incomingResults,
        ]);
      },
      clearAtom: () => {
        setStoreResults([]);
        setError(null);
        setHasMore(false);
        setActualTotalMatches(0);
        setActualTotalFiles(0);
      },
    }),
    []
  );

  useSearchExecution({
    query,
    searchMode,
    repoPath,
    openFiles,
    storeOptions,
    resultActions,
  });

  useEffect(() => {
    setSearchTabSessionState(sessionScopeId, {
      query,
      options: storeOptions,
      results: storeResults,
      loading,
      loadingMore,
      error,
      hasMore,
      actualTotalMatches,
      actualTotalFiles,
    });
  }, [
    sessionScopeId,
    query,
    storeOptions,
    storeResults,
    loading,
    loadingMore,
    error,
    hasMore,
    actualTotalMatches,
    actualTotalFiles,
  ]);

  const isTruncated = actualTotalMatches >= SEARCH_CONSTANTS.MAX_TOTAL_RESULTS;

  return {
    query,
    setQuery,
    options,
    setOptions,
    results,
    loading,
    loadingMore,
    error,
    actualTotalMatches,
    actualTotalFiles,
    hasMore,
    isTruncated,
  };
}
