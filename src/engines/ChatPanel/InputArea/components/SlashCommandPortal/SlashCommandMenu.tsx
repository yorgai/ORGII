/**
 * SlashCommandMenu — the main dropdown panel.
 *
 * Composes useEntries, usePortalPosition, useKeyboard, FlyoutSubmenu,
 * and the individual MenuRow components into the full slash command experience.
 */
import { Search } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
} from "@src/components/Dropdown/tokens";
import { useTauriSelectAllShortcut } from "@src/hooks/keyboard";

import FlyoutSubmenu from "./FlyoutSubmenu";
import {
  DividerRow,
  FlyoutTriggerRow,
  ImageRow,
  ModeRow,
  SectionHeaderRow,
  SlashItemRow,
} from "./MenuRows";
import type { OpenFlyoutState, SlashCommandPortalProps } from "./types";
import { useEntries } from "./useEntries";
import { useKeyboard } from "./useKeyboard";
import { usePortalPosition } from "./usePortalPosition";

const PANEL_WIDTH = 280;

const SlashCommandMenu: React.FC<SlashCommandPortalProps> = ({
  visible,
  containerRef,
  items,
  loading,
  currentMode,
  searchQuery = "",
  onClose,
  onSelect,
  onModeSelect,
  keyboardHandlerRef,
  searchMode = "inline",
  onSearchQueryChange,
  showActionFlyouts = false,
  onImageUpload,
  showModeRows = true,
  direction = "up",
}) => {
  const { t } = useTranslation("sessions");
  const isHeaderMode = searchMode === "header";

  const portalContainerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const tauriSelectAll = useTauriSelectAllShortcut();

  const [highlightIndex, setHighlightIndex] = useState(0);
  const [keyboardNavigated, setKeyboardNavigated] = useState(!isHeaderMode);
  const [openFlyout, setOpenFlyout] = useState<OpenFlyoutState | null>(null);
  const [flyoutHighlightIndex, setFlyoutHighlightIndex] = useState(0);
  const [panelRight, setPanelRight] = useState(0);

  // Position the portal above the container
  const { position, isPositioned } = usePortalPosition(visible, containerRef);

  // Build the unified entry list
  const { entries, totalFlat } = useEntries({
    items,
    searchQuery,
    showActionFlyouts,
    hasImageUpload: Boolean(onImageUpload),
    showModeRows,
  });

  // Reset highlight to 0 when the list shape changes (derived state)
  const listIdentity = useMemo(
    () =>
      `${items.map((i) => `${i.source}:${i.category}:${i.name}`).join("\0")}\0${searchQuery}`,
    [items, searchQuery]
  );
  const [trackedIdentity, setTrackedIdentity] = useState(listIdentity);
  if (trackedIdentity !== listIdentity) {
    setTrackedIdentity(listIdentity);
    setHighlightIndex(0);
    setKeyboardNavigated(!isHeaderMode);
  }

  // Close flyout when a search query is active (derived state)
  const [trackedQuery, setTrackedQuery] = useState(searchQuery);
  if (trackedQuery !== searchQuery) {
    setTrackedQuery(searchQuery);
    if (searchQuery) setOpenFlyout(null);
  }

  // Reset flyout highlight when the flyout opens or its items change (derived state)
  const flyoutItemsKey =
    openFlyout?.kind === "category"
      ? (openFlyout.items?.map((i) => i.name).join("\0") ?? "")
      : (openFlyout?.kind ?? "");
  const [trackedFlyoutKey, setTrackedFlyoutKey] = useState(flyoutItemsKey);
  if (trackedFlyoutKey !== flyoutItemsKey) {
    setTrackedFlyoutKey(flyoutItemsKey);
    setFlyoutHighlightIndex(0);
  }

  useEffect(() => {
    if (!isHeaderMode || !visible || !isPositioned) return;
    const frame = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isHeaderMode, visible, isPositioned]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return;
    const itemEls = listRef.current.querySelectorAll("[data-slash-flat]");
    itemEls[highlightIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex]);

  // Keep panelRight in sync after DOM mutation and window resize
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => setPanelRight(el.getBoundingClientRect().right);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [position, isPositioned]);

  // Click outside → close (but not when clicking inside a flyout portal)
  useEffect(() => {
    if (!visible || !isPositioned) return;
    const handler = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        portalContainerRef.current &&
        !portalContainerRef.current.contains(target)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [visible, isPositioned, onClose]);

  // Wire keyboard navigation
  useKeyboard({
    visible,
    entries,
    totalFlat,
    highlightIndex,
    openFlyout,
    listRef,
    setHighlightIndex,
    setKeyboardNavigated,
    setOpenFlyout,
    onSelect,
    onModeSelect,
    onImageUpload,
    onClose,
    keyboardHandlerRef,
    flyoutHighlightIndex,
    setFlyoutHighlightIndex,
  });

  const openCategoryFlyout = useCallback(
    (
      event: React.MouseEvent<HTMLDivElement>,
      payload: OpenFlyoutState | null
    ) => {
      setOpenFlyout(
        payload
          ? {
              ...payload,
              anchorTop: event.currentTarget.getBoundingClientRect().top,
            }
          : null
      );
    },
    []
  );

  if (!isPositioned) return null;

  const portalStyle =
    direction === "down"
      ? {
          top: position.bottom,
          left: position.left,
          width: PANEL_WIDTH,
        }
      : {
          top: position.top,
          left: position.left,
          width: PANEL_WIDTH,
          transform: "translateY(-100%)",
        };

  return createPortal(
    <div
      ref={portalContainerRef}
      className="fixed z-[99999] flex flex-col gap-2 pb-2"
      style={portalStyle}
    >
      {/* Main panel */}
      <div
        ref={listRef}
        data-testid="slash-command-menu"
        data-dropdown-keyboard-mode={keyboardNavigated ? "true" : undefined}
        className={DROPDOWN_CLASSES.panel}
        onMouseDown={(e) => {
          if (
            isHeaderMode &&
            (e.target as HTMLElement).closest("[data-slash-search-input]")
          ) {
            return;
          }
          e.preventDefault();
        }}
      >
        {isHeaderMode && (
          <div
            className={DROPDOWN_CLASSES.searchContainer}
            data-testid="slash-command-search"
          >
            <Search
              size={DROPDOWN_ITEM.iconSize}
              className="shrink-0 text-text-3"
            />
            <input
              ref={searchInputRef}
              data-slash-search-input="true"
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange?.(e.target.value)}
              onKeyDown={(e) => {
                tauriSelectAll(e);
                if (e.defaultPrevented) return;
                if (keyboardHandlerRef.current?.(e.nativeEvent)) {
                  e.preventDefault();
                }
              }}
              placeholder={t("creator.slashSearchPlaceholder", {
                defaultValue: "Search commands…",
              })}
              className={DROPDOWN_CLASSES.searchInput}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
        )}

        <div
          className={`max-h-[320px] overflow-y-auto ${DROPDOWN_PANEL.paddingClass} scrollbar-hide`}
        >
          {entries.map((entry, mapIdx) => {
            if (entry.kind === "divider") {
              return <DividerRow key={`divider-${mapIdx}`} />;
            }

            if (entry.kind === "header") {
              return (
                <SectionHeaderRow
                  key={`header-${entry.label}`}
                  label={
                    entry.translationKey
                      ? t(entry.translationKey, { defaultValue: entry.label })
                      : entry.label
                  }
                />
              );
            }

            if (entry.kind === "image") {
              return (
                <ImageRow
                  key="image-upload"
                  isActive={
                    keyboardNavigated && entry.flatIndex === highlightIndex
                  }
                  onMouseEnter={() => {
                    setKeyboardNavigated(false);
                    setHighlightIndex(entry.flatIndex);
                    setOpenFlyout(null);
                  }}
                  onMouseDown={() => {
                    onImageUpload?.();
                    onClose();
                  }}
                />
              );
            }

            if (entry.kind === "mode") {
              return (
                <ModeRow
                  key={`mode-${entry.mode.id}`}
                  mode={entry.mode}
                  isActive={
                    keyboardNavigated && entry.flatIndex === highlightIndex
                  }
                  isCurrent={entry.mode.id === currentMode}
                  onMouseEnter={() => {
                    setKeyboardNavigated(false);
                    setHighlightIndex(entry.flatIndex);
                    setOpenFlyout(null);
                  }}
                  onMouseDown={() => onModeSelect(entry.mode.id)}
                />
              );
            }

            if (entry.kind === "flyout") {
              const { flatIndex, category, label, items: flyoutItems } = entry;
              return (
                <FlyoutTriggerRow
                  key={`flyout-${category}`}
                  category={category}
                  label={label}
                  isActive={keyboardNavigated && flatIndex === highlightIndex}
                  isOpen={
                    openFlyout?.kind === "category" &&
                    openFlyout.category === category
                  }
                  onMouseEnter={(e) => {
                    setKeyboardNavigated(false);
                    setHighlightIndex(flatIndex);
                    setOpenFlyout({
                      kind: "category",
                      category,
                      anchorTop: e.currentTarget.getBoundingClientRect().top,
                      items: flyoutItems,
                    });
                  }}
                  onMouseDown={(e) => {
                    openCategoryFlyout(
                      e,
                      openFlyout?.kind === "category" &&
                        openFlyout.category === category
                        ? null
                        : {
                            kind: "category",
                            category,
                            anchorTop: 0,
                            items: flyoutItems,
                          }
                    );
                  }}
                />
              );
            }

            // entry.kind === "item" (flat rows when searching)
            const { item, flatIndex } = entry;
            return (
              <SlashItemRow
                key={`${item.category}-${item.source}-${item.name}`}
                item={item}
                isActive={keyboardNavigated && flatIndex === highlightIndex}
                onMouseEnter={() => {
                  setKeyboardNavigated(false);
                  setHighlightIndex(flatIndex);
                  setOpenFlyout(null);
                }}
                onClick={() => onSelect(item)}
              />
            );
          })}

          {loading && items.length === 0 && (
            <div className="px-3 py-2 text-sm text-text-3">
              {t("status.loading", { ns: "common" })}
            </div>
          )}
          {!loading && entries.length === 0 && (
            <div className="px-3 py-2 text-sm text-text-3">
              {t("placeholders.noItems", { ns: "common" })}
            </div>
          )}
        </div>
      </div>

      {/* Category flyout (Skills / MCP Servers) */}
      {openFlyout?.kind === "category" &&
        openFlyout.items &&
        openFlyout.category && (
          <FlyoutSubmenu
            items={openFlyout.items}
            category={openFlyout.category}
            anchorTop={openFlyout.anchorTop}
            panelRight={panelRight}
            highlightIndex={flyoutHighlightIndex}
            keyboardNavigated={keyboardNavigated}
            onHighlightChange={setFlyoutHighlightIndex}
            onPointerNavigate={() => setKeyboardNavigated(false)}
            onSelect={(item) => {
              onSelect(item);
              setOpenFlyout(null);
            }}
            onClose={() => setOpenFlyout(null)}
          />
        )}
    </div>,
    document.body
  );
};

SlashCommandMenu.displayName = "SlashCommandMenu";

export default SlashCommandMenu;
