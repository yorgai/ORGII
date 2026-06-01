/**
 * useOpenSearchTab Hook
 *
 * Encapsulates the logic for opening a search tab in the single main pane.
 * Falls back to directly creating a search tab via the store if no callback
 * is provided.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";

import {
  searchOptionsAtom,
  searchQueryAtom,
} from "@src/store/workstation/codeEditor/search";
import {
  createSearchTab,
  openTab,
  workstationLayoutAtom,
} from "@src/store/workstation/tabs";

export interface UseOpenSearchTabOptions {
  repoPath: string;
  onOpenSearchTab?: () => void;
}

export function useOpenSearchTab({
  repoPath,
  onOpenSearchTab,
}: UseOpenSearchTabOptions): () => void {
  const setLayout = useSetAtom(workstationLayoutAtom);
  const sidebarSearchQuery = useAtomValue(searchQueryAtom);
  const sidebarSearchOptions = useAtomValue(searchOptionsAtom);

  return useCallback(() => {
    if (onOpenSearchTab) {
      onOpenSearchTab();
      return;
    }

    const tab = createSearchTab(repoPath, {
      query: sidebarSearchQuery,
      options: sidebarSearchOptions,
    });
    setLayout((prev) => ({
      ...prev,
      mainPane: openTab(prev?.mainPane ?? { tabs: [], activeTabId: null }, tab),
    }));
  }, [
    onOpenSearchTab,
    repoPath,
    setLayout,
    sidebarSearchQuery,
    sidebarSearchOptions,
  ]);
}
