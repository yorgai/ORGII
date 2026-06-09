/**
 * SearchTab Configuration
 *
 * Defines the Search tab structure.
 *
 * PERFORMANCE (Jan 2026):
 * Contains SearchPanelContent component that encapsulates useOpenEditorFiles hook.
 * This hook only runs when the Search tab is first visited (lazy mounting).
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";

import type { SectionHeaderAction } from "@src/components/TreePanelSidebar/types";
import { useOpenEditorFiles } from "@src/hooks/workStation/editor/useOpenEditorFiles";
import type { PrimarySidebarTab } from "@src/modules/WorkStation/shared";

import { ICON_CONFIG, PANEL_CONSTANTS } from "../config";
import SearchContent from "../content/SearchContent";
import type { SearchContentHandle } from "../content/SearchContent/types";

// ============================================
// Search Panel Content (Lazy-loaded)
// ============================================

export interface SearchPanelContentHandle {
  collapseAll: () => void;
}

interface SearchPanelContentProps {
  repoPath: string;
  onResultClick: (filePath: string, line: number) => void;
  showFilters: boolean;
  onOpenInTab?: () => void;
}

/**
 * Internal component that wraps SearchContent with useOpenEditorFiles.
 * Only mounts when Search tab is visited, deferring the hook execution.
 */
const SearchPanelContent = forwardRef<
  SearchPanelContentHandle,
  SearchPanelContentProps
>(({ repoPath, onResultClick, showFilters, onOpenInTab }, ref) => {
  const searchPanelRef = useRef<SearchContentHandle>(null);

  // PERFORMANCE: This hook only runs when this component mounts
  const { openFiles } = useOpenEditorFiles();

  // PERFORMANCE: Use ref to keep callback stable, preventing re-renders
  const onResultClickRef = useRef(onResultClick);
  useEffect(() => {
    onResultClickRef.current = onResultClick;
  }, [onResultClick]);

  // Stable callback that delegates to the ref
  const stableOnResultClick = useCallback((filePath: string, line: number) => {
    onResultClickRef.current(filePath, line);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      collapseAll: () => searchPanelRef.current?.collapseAll(),
    }),
    []
  );

  return (
    <SearchContent
      ref={searchPanelRef}
      repoPath={repoPath}
      onResultClick={stableOnResultClick}
      openFiles={openFiles}
      showFilters={showFilters}
      onOpenInTab={onOpenInTab}
    />
  );
});

SearchPanelContent.displayName = "SearchPanelContent";

// ============================================
// Tab Config Hook
// ============================================

export interface SearchTabConfigProps {
  repoPath: string;
  onResultClick: (filePath: string, line: number) => void;
  showFilters: boolean;
  searchPanelRef: React.RefObject<SearchPanelContentHandle | null>;
  actions?: SectionHeaderAction[];
  onOpenInTab?: () => void;
}

export function useSearchTabConfig({
  repoPath,
  onResultClick,
  showFilters,
  searchPanelRef,
  actions = [],
  onOpenInTab,
}: SearchTabConfigProps): PrimarySidebarTab {
  const { t } = useTranslation();
  const SearchIcon = ICON_CONFIG.search;

  // PERFORMANCE: Use ref for callback to ensure content JSX can be stably memoized
  const onResultClickRef = useRef(onResultClick);
  useEffect(() => {
    onResultClickRef.current = onResultClick;
  }, [onResultClick]);

  const stableOnResultClick = useCallback((filePath: string, line: number) => {
    onResultClickRef.current(filePath, line);
  }, []);

  // PERFORMANCE: Memoize the content JSX to prevent unnecessary re-renders
  const searchContent = useMemo(
    () => (
      <SearchPanelContent
        ref={searchPanelRef}
        repoPath={repoPath}
        onResultClick={stableOnResultClick}
        showFilters={showFilters}
        onOpenInTab={onOpenInTab}
      />
    ),
    [repoPath, showFilters, searchPanelRef, stableOnResultClick, onOpenInTab]
  );

  // PERFORMANCE: Memoize icon to prevent re-renders
  const searchIcon = useMemo(
    () => <SearchIcon size={PANEL_CONSTANTS.TAB_ICON_SIZE} />,
    [SearchIcon]
  );

  // PERFORMANCE: Memoize sections array
  const sections = useMemo(
    () => [
      {
        key: "search-results",
        title: t("tabs.search"),
        content: searchContent,
        defaultFlexGrow: 2,
        resizable: true,
        actions,
      },
    ],
    [searchContent, actions, t]
  );

  // PERFORMANCE: Memoize entire tab config to prevent parent re-renders
  return useMemo(
    () => ({
      key: "search" as const,
      label: t("tabs.search"),
      icon: searchIcon,
      sections,
    }),
    [searchIcon, sections, t]
  );
}

// Re-export handle type for external use
export type { SearchPanelContentHandle as SearchTabHandle };
