/**
 * useDropdownKeyboard Hook
 *
 * Keyboard navigation for dropdown options lists.
 * Handles ArrowUp/Down, Enter to select, and type-ahead search.
 */
import { type KeyboardEvent, useCallback, useState } from "react";

import type { DropdownOption } from "./types";

export interface UseDropdownKeyboardOptions {
  options: DropdownOption[];
  isOpen: boolean;
  onSelect: (option: DropdownOption) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export interface UseDropdownKeyboardReturn {
  highlightedIndex: number;
  keyboardNavigated: boolean;
  handleKeyDown: (event: KeyboardEvent) => void;
  resetHighlight: () => void;
  clearKeyboardNavigation: () => void;
  getOptionMouseEnterProps: (index: number) => {
    "data-dropdown-keyboard-mode"?: "true";
    onMouseEnter: () => void;
  };
}

export function useDropdownKeyboard({
  options,
  isOpen,
  onSelect,
  onOpen,
  onClose,
}: UseDropdownKeyboardOptions): UseDropdownKeyboardReturn {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [keyboardNavigated, setKeyboardNavigated] = useState(false);

  const resetHighlight = useCallback(() => {
    setHighlightedIndex(0);
    setKeyboardNavigated(false);
  }, []);

  const clearKeyboardNavigation = useCallback(() => {
    setKeyboardNavigated(false);
  }, []);

  const getOptionMouseEnterProps = useCallback(
    (index: number) => ({
      ...(keyboardNavigated
        ? { "data-dropdown-keyboard-mode": "true" as const }
        : {}),
      onMouseEnter: () => {
        setHighlightedIndex(index);
        clearKeyboardNavigation();
      },
    }),
    [keyboardNavigated, clearKeyboardNavigation]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!isOpen) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen?.();
        }
        return;
      }

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setKeyboardNavigated(true);
          setHighlightedIndex((prev) => Math.min(prev + 1, options.length - 1));
          break;
        case "ArrowUp":
          event.preventDefault();
          setKeyboardNavigated(true);
          setHighlightedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          event.preventDefault();
          if (options[highlightedIndex]) {
            onSelect(options[highlightedIndex]);
          }
          break;
        case "Escape":
          event.preventDefault();
          onClose?.();
          break;
      }
    },
    [isOpen, options, highlightedIndex, onSelect, onOpen, onClose]
  );

  return {
    highlightedIndex,
    keyboardNavigated,
    handleKeyDown,
    resetHighlight,
    clearKeyboardNavigation,
    getOptionMouseEnterProps,
  };
}
