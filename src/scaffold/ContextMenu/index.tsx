/**
 * ContextMenu Component
 *
 * Unified context menu for session input boxes.
 * Combines file search, folder search, terminals, design, and browser options.
 *
 * Features:
 * - Multi-level menu with keyboard navigation
 * - Recent files display (top 3)
 * - Native file search integration
 * - Fuzzy matching for files and folders
 * - File type specific icons
 */
import { AtSign } from "lucide-react";
import React, { memo, useCallback, useMemo, useRef } from "react";

import { useContextMenu } from "@src/hooks/workStation/panels/useContextMenu";
import { SpotlightFooter } from "@src/scaffold/GlobalSpotlight/components";

import {
  RecentFilesSection,
  SearchResultsPanel,
  SecondLayerPanel,
} from "./MenuSections";
import { MenuItemRow } from "./ResultItems";
import { MENU_ITEMS, STYLE_CONFIG } from "./config";
import type { ContextMenuProps } from "./types";
import { useMenuEffects } from "./useMenuEffects";

const ContextMenu: React.FC<ContextMenuProps> = ({
  visible,
  onClose,
  onSelect,
  customMentionOptions = [],
  onCustomMentionSelect,
  searchQuery: externalSearchQuery,
  recentFiles = [],
  repoPath,
  className = "",
  keyboardHandlerRef,
  treePosition = "left",
  panelWidth,
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);

  const recentCount = Math.min(
    recentFiles.length,
    STYLE_CONFIG.recentSectionMaxItems
  );

  const {
    activeIndex,
    setActiveIndex,
    secondLayer,
    setSecondLayer,
    searchResults,
    searchLoading,
    secondLayerActiveIndex,
    setSecondLayerActiveIndex,
    handleKeyDown,
    handleSelect,
    goBack,
    reset,
    drilledProjectName,
  } = useContextMenu({
    repoPath,
    onSelect,
    onClose,
    externalSearchQuery: externalSearchQuery || undefined,
  });

  const resetActiveIndex = useCallback(
    () => setActiveIndex(-1),
    [setActiveIndex]
  );
  const resetSecondLayerIndex = useCallback(
    () => setSecondLayerActiveIndex(-1),
    [setSecondLayerActiveIndex]
  );

  const isInlineSearching =
    externalSearchQuery && externalSearchQuery.length > 0;

  const filteredCustomMentionOptions = useMemo(() => {
    const query = (externalSearchQuery ?? "").trim().toLowerCase();
    if (!query) return customMentionOptions;
    return customMentionOptions.filter((option) => {
      const label = option.label.toLowerCase();
      const description = option.description?.toLowerCase() ?? "";
      return label.includes(query) || description.includes(query);
    });
  }, [customMentionOptions, externalSearchQuery]);

  const { handleMenuItemClick, handleRecentSelect, handleSearchResultSelect } =
    useMenuEffects({
      visible,
      onClose,
      dropdownRef,
      keyboardHandlerRef,
      handleKeyDown,
      handleSelect,
      setSecondLayer,
      secondLayer,
      searchResults,
      reset,
    });

  const handleMainItemHover = useCallback(
    (itemIndex: number) => {
      setActiveIndex(itemIndex);
    },
    [setActiveIndex]
  );

  if (!visible) return null;

  const showInlineSearch = isInlineSearching;
  const showSecondLayerPanel = secondLayer !== null && !isInlineSearching;

  const showSpotlightBackHint = showInlineSearch || showSecondLayerPanel;

  return (
    <div
      ref={dropdownRef}
      className={`context-menu flex flex-col gap-2 ${panelWidth ? "w-full" : ""} ${className}`}
      onKeyDown={handleKeyDown}
      onMouseDown={(e) => {
        e.preventDefault();
        e.nativeEvent.stopImmediatePropagation();
      }}
      tabIndex={-1}
    >
      <SpotlightFooter
        hasActiveAction={showSpotlightBackHint}
        variant="dropdown"
      />

      {/* Inline search results (when user types after @) */}
      {showInlineSearch && filteredCustomMentionOptions.length > 0 && (
        <div
          className="overflow-hidden rounded-[8px] border border-solid border-border-2 bg-bg-2 shadow-lg"
          style={{ width: panelWidth || STYLE_CONFIG.dropdownWidth }}
        >
          <div className="px-1 py-1">
            {filteredCustomMentionOptions.map((option) => (
              <MenuItemRow
                key={option.id}
                icon={AtSign}
                label={option.label}
                description={option.description}
                dataTestId="agent-org-mention-option"
                dataMentionId={option.id}
                onClick={() => onCustomMentionSelect?.(option)}
              />
            ))}
          </div>
        </div>
      )}

      {showInlineSearch && (
        <SearchResultsPanel
          searchQuery={externalSearchQuery || ""}
          results={searchResults}
          loading={searchLoading}
          activeIndex={secondLayerActiveIndex}
          onSelect={handleSearchResultSelect}
          onHover={setSecondLayerActiveIndex}
          onHoverEnd={resetSecondLayerIndex}
          repoPath={repoPath}
          treePosition={treePosition}
          panelWidth={panelWidth}
        />
      )}

      {/* Second layer panel (when user clicks Files & Folders or Terminal) */}
      {showSecondLayerPanel && secondLayer && (
        <SecondLayerPanel
          layerId={secondLayer}
          results={searchResults}
          loading={searchLoading}
          activeIndex={secondLayerActiveIndex}
          onSelect={handleSearchResultSelect}
          onHover={setSecondLayerActiveIndex}
          onHoverEnd={resetSecondLayerIndex}
          onBack={goBack}
          repoPath={repoPath}
          treePosition={treePosition}
          panelWidth={panelWidth}
          titleOverride={
            secondLayer === "projects" && drilledProjectName
              ? drilledProjectName
              : undefined
          }
        />
      )}

      {/* Main menu - shown when user just types @ without any text after */}
      {!showInlineSearch && !showSecondLayerPanel && (
        <div
          className="overflow-hidden rounded-[8px] border border-solid border-border-2 bg-bg-2 shadow-lg"
          style={{ width: panelWidth || STYLE_CONFIG.dropdownWidth }}
        >
          <RecentFilesSection
            files={recentFiles}
            onSelect={handleRecentSelect}
            activeIndex={activeIndex}
            baseIndex={0}
            onHover={setActiveIndex}
            onHoverEnd={resetActiveIndex}
          />

          {filteredCustomMentionOptions.length > 0 && (
            <div className="border-b border-solid border-border-1 px-1 py-1">
              {filteredCustomMentionOptions.map((option) => (
                <MenuItemRow
                  key={option.id}
                  icon={AtSign}
                  label={option.label}
                  description={option.description}
                  dataTestId="agent-org-mention-option"
                  dataMentionId={option.id}
                  onClick={() => onCustomMentionSelect?.(option)}
                />
              ))}
            </div>
          )}

          <div className="px-1 py-1">
            {MENU_ITEMS.map((item, idx) => {
              const itemIndex = recentCount + idx;
              return (
                <MenuItemRow
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  hasArrow={item.hasSecondLayer}
                  isActive={activeIndex === itemIndex}
                  onClick={() => handleMenuItemClick(item)}
                  onMouseEnter={() => handleMainItemHover(itemIndex)}
                  onMouseLeave={() => setActiveIndex(-1)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default memo(ContextMenu);
