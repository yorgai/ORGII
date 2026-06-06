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
import React, { memo, useCallback, useEffect, useMemo, useRef } from "react";

import { DROPDOWN_CLASSES } from "@src/components/Dropdown/tokens";
import { useContextMenu } from "@src/hooks/workStation/panels/useContextMenu";

import { SearchResultsPanel, SecondLayerPanel } from "./MenuSections";
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
  inlineSearchOnEmpty = false,
  recentFiles = [],
  repoPath,
  className = "",
  keyboardHandlerRef,
  treePosition = "left",
  keyboardOpened = false,
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);

  const recentCount = Math.min(
    recentFiles.length,
    STYLE_CONFIG.recentSectionMaxItems
  );

  const filteredCustomMentionOptions = useMemo(() => {
    const query = (externalSearchQuery ?? "").trim().toLowerCase();
    if (!query) return customMentionOptions;
    return customMentionOptions.filter((option) => {
      const label = option.label.toLowerCase();
      const description = option.description?.toLowerCase() ?? "";
      return label.includes(query) || description.includes(query);
    });
  }, [customMentionOptions, externalSearchQuery]);

  const handleCustomMentionIndexSelect = useCallback(
    (optionIndex: number) => {
      const option = filteredCustomMentionOptions[optionIndex];
      if (option) onCustomMentionSelect?.(option);
    },
    [filteredCustomMentionOptions, onCustomMentionSelect]
  );

  const {
    activeIndex,
    setActiveIndex,
    keyboardNavigated,
    setKeyboardNavigated,
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
    externalSearchQuery,
    inlineSearchOnEmpty,
    recentCount,
    customMentionCount: filteredCustomMentionOptions.length,
    onCustomMentionIndexSelect: handleCustomMentionIndexSelect,
    keyboardOpened,
  });

  const resetActiveIndex = useCallback(() => {
    setKeyboardNavigated(false);
    setActiveIndex(-1);
  }, [setActiveIndex, setKeyboardNavigated]);
  const resetSecondLayerIndex = useCallback(() => {
    setKeyboardNavigated(false);
    setSecondLayerActiveIndex(-1);
  }, [setSecondLayerActiveIndex, setKeyboardNavigated]);

  useEffect(() => {
    if (!visible || !keyboardOpened) return;
    setKeyboardNavigated(true);
    setActiveIndex(0);
    setSecondLayerActiveIndex(0);
  }, [
    visible,
    keyboardOpened,
    externalSearchQuery,
    setActiveIndex,
    setKeyboardNavigated,
    setSecondLayerActiveIndex,
  ]);

  const isInlineSearching =
    externalSearchQuery !== undefined &&
    (inlineSearchOnEmpty || externalSearchQuery.length > 0);

  const { handleMenuItemClick, handleSearchResultSelect } = useMenuEffects({
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
      setKeyboardNavigated(false);
      setActiveIndex(itemIndex);
    },
    [setActiveIndex, setKeyboardNavigated]
  );

  const handleSecondLayerHover = useCallback(
    (itemIndex: number) => {
      setKeyboardNavigated(false);
      setSecondLayerActiveIndex(itemIndex);
    },
    [setSecondLayerActiveIndex, setKeyboardNavigated]
  );

  if (!visible) return null;

  const showInlineSearch = isInlineSearching;
  const showSecondLayerPanel = secondLayer !== null && !isInlineSearching;
  return (
    <div
      ref={dropdownRef}
      className={`context-menu flex flex-col gap-2 ${className}`}
      data-dropdown-keyboard-mode={keyboardNavigated ? "true" : undefined}
      onKeyDown={handleKeyDown}
      onMouseDown={(e) => {
        e.preventDefault();
        e.nativeEvent.stopImmediatePropagation();
      }}
      tabIndex={-1}
    >
      {/* Inline search results (when user types after @) */}
      {showInlineSearch && filteredCustomMentionOptions.length > 0 && (
        <div
          className={DROPDOWN_CLASSES.panel}
          style={{ width: STYLE_CONFIG.dropdownWidth }}
        >
          <div className={DROPDOWN_CLASSES.itemsColumnPadded}>
            {filteredCustomMentionOptions.map((option, optionIndex) => (
              <MenuItemRow
                key={option.id}
                icon={AtSign}
                label={option.label}
                description={option.description}
                isActive={keyboardNavigated && activeIndex === optionIndex}
                dataTestId="agent-org-mention-option"
                dataMentionId={option.id}
                onClick={() => onCustomMentionSelect?.(option)}
                onMouseEnter={() => handleMainItemHover(optionIndex)}
                onMouseLeave={resetActiveIndex}
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
          onHover={handleSecondLayerHover}
          onHoverEnd={resetSecondLayerIndex}
          repoPath={repoPath}
          treePosition={treePosition}
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
          onHover={handleSecondLayerHover}
          onHoverEnd={resetSecondLayerIndex}
          onBack={goBack}
          repoPath={repoPath}
          treePosition={treePosition}
          recentFiles={secondLayer === "files" ? recentFiles : undefined}
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
          className={DROPDOWN_CLASSES.panel}
          style={{ width: STYLE_CONFIG.dropdownWidth }}
        >
          {filteredCustomMentionOptions.length > 0 && (
            <>
              <div className={DROPDOWN_CLASSES.itemsColumnPadded}>
                {filteredCustomMentionOptions.map((option, optionIndex) => {
                  const itemIndex = recentCount + optionIndex;
                  return (
                    <MenuItemRow
                      key={option.id}
                      icon={AtSign}
                      label={option.label}
                      description={option.description}
                      isActive={keyboardNavigated && activeIndex === itemIndex}
                      dataTestId="agent-org-mention-option"
                      dataMentionId={option.id}
                      onClick={() => onCustomMentionSelect?.(option)}
                      onMouseEnter={() => handleMainItemHover(itemIndex)}
                      onMouseLeave={resetActiveIndex}
                    />
                  );
                })}
              </div>
              <div className={DROPDOWN_CLASSES.menuSeparatorInset} />
            </>
          )}

          <div className={DROPDOWN_CLASSES.itemsColumnPadded}>
            {MENU_ITEMS.map((item, idx) => {
              const itemIndex =
                recentCount + filteredCustomMentionOptions.length + idx;
              return (
                <MenuItemRow
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  hasArrow={item.hasSecondLayer}
                  isActive={keyboardNavigated && activeIndex === itemIndex}
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
