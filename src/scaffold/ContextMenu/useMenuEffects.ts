/**
 * ContextMenu Effects & Handlers
 *
 * Encapsulates visibility management, keyboard handler ref assignment,
 * click-outside detection, and menu item selection callbacks.
 */
import React, { useCallback, useEffect } from "react";

import { MENU_ITEMS, type MenuItemId, SecondLayerId } from "./config";
import type { SearchResultItem } from "./types";

interface UseMenuEffectsOptions {
  visible: boolean;
  onClose: () => void;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  keyboardHandlerRef?: React.MutableRefObject<
    ((e: React.KeyboardEvent) => boolean) | null
  >;
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
  handleSelect: (
    type: MenuItemId,
    value?: string,
    displayName?: string
  ) => void;
  setSecondLayer: (layer: SecondLayerId | null) => void;
  secondLayer: SecondLayerId | null;
  searchResults: SearchResultItem[];
  reset: () => void;
}

export function useMenuEffects({
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
}: UseMenuEffectsOptions) {
  // Reset when visibility changes
  useEffect(() => {
    if (!visible) {
      reset();
    }
  }, [visible, reset]);

  // Expose keyboard handler to parent via ref.
  // NOTE: We intentionally do NOT null the ref in cleanup — that was causing
  // a micro-window where keystrokes were swallowed between effect cleanup
  // and re-assignment on every handleKeyDown recreation.
  useEffect(() => {
    if (keyboardHandlerRef) {
      keyboardHandlerRef.current = handleKeyDown;
    }
  }, [keyboardHandlerRef, handleKeyDown]);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        onClose();
      }
    };

    if (visible) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [visible, onClose, dropdownRef]);

  // Handle menu item click
  const handleMenuItemClick = useCallback(
    (item: (typeof MENU_ITEMS)[0]) => {
      if (item.hasSecondLayer) {
        setSecondLayer(item.id as SecondLayerId);
      } else {
        handleSelect(item.id);
      }
    },
    [setSecondLayer, handleSelect]
  );

  // Handle recent file selection
  const handleRecentSelect = useCallback(
    (path: string) => {
      handleSelect("files", path);
    },
    [handleSelect]
  );

  // Handle search result selection
  const handleSearchResultSelect = useCallback(
    (path: string) => {
      const item = searchResults.find((s) => s.path === path);
      const type =
        item?.iconType ??
        (secondLayer === "files" && item?.type === "folder"
          ? "folder"
          : null) ??
        secondLayer ??
        "files";
      handleSelect(type, path, item?.name);
    },
    [handleSelect, secondLayer, searchResults]
  );

  return {
    handleMenuItemClick,
    handleRecentSelect,
    handleSearchResultSelect,
  };
}
