/**
 * useListNavigation Hook
 *
 * Unified keyboard navigation for list-based UIs (spotlight, selectors, dropdowns).
 *
 * Features:
 * - Arrow up/down navigation with selectable item filtering
 * - Enter to select
 * - Escape to close/go back (via handleKeyDown on the focused input)
 * - Backspace to clear/pop segment
 * - Tab navigation for filter tabs
 * - Auto-scroll to selected item
 *
 * Architecture:
 * - handleKeyDown: Prop-based handler for the focused input element.
 *   Handles ALL keys including Escape.
 * - Global listener (enableGlobalListener): Capture-phase document listener
 *   for navigation keys (Arrow, Tab, Backspace) when focus is outside the
 *   spotlight input. Does NOT handle Escape — the wrapping SpotlightPortal
 *   owns Escape-to-close via its own listener.
 *
 * Performance: The global listener uses refs for frequently-changing values
 * (items, selectedIndex, searchQuery) to avoid re-attaching the listener
 * on every state change.
 */
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";

import { useTauriSelectAllShortcut } from "./useTauriSelectAllShortcut";

// ============================================
// Type Definitions
// ============================================

export interface ListItem {
  action?: () => void;
  [key: string]: unknown;
}

export interface UseListNavigationOptions<T extends ListItem> {
  items: T[];
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  onSelect?: (item: T, index: number) => void;
  onClose: () => void;
  onBackspace?: () => void;
  onTab?: (forward: boolean) => void;
  isItemSelectable?: (item: T, index: number) => boolean;
  searchQuery?: string;
  enableAutoScroll?: boolean;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  additionalKeyHandlers?: Record<
    string,
    (event: ReactKeyboardEvent) => boolean | void
  >;
  enableGlobalListener?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  hasModalState?: boolean;
  onGoBack?: () => void;
  onEscape?: () => void;
}

export interface UseListNavigationReturn {
  handleKeyDown: (event: ReactKeyboardEvent) => void;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

interface NativeKeyboardEvent extends Event {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
  target: EventTarget | null;
  preventDefault(): void;
  stopPropagation(): void;
}

// ============================================
// Pure Helpers (testable without React)
// ============================================

/**
 * Find the next selectable index starting from `startIndex` in the given
 * direction.
 *
 * - When `startIndex < 0`, search begins at the first (direction=1) or last
 *   (direction=-1) item.
 * - When no selectable item is found in the search direction, returns
 *   `startIndex` (boundary clamp — no wrap-around).
 * - Returns -1 only when the list is empty, or when `startIndex < 0` and
 *   nothing in the list is selectable.
 */
export function findNextSelectableIndex<T>(
  items: readonly T[],
  startIndex: number,
  direction: 1 | -1,
  isItemSelectable: (item: T, index: number) => boolean = () => true
): number {
  const itemCount = items.length;
  if (itemCount === 0) return -1;

  if (startIndex < 0) {
    const searchStart = direction === 1 ? 0 : itemCount - 1;
    for (
      let index = searchStart;
      direction === 1 ? index < itemCount : index >= 0;
      index += direction
    ) {
      if (isItemSelectable(items[index], index)) {
        return index;
      }
    }
    return -1;
  }

  for (
    let index = startIndex + direction;
    direction === 1 ? index < itemCount : index >= 0;
    index += direction
  ) {
    if (isItemSelectable(items[index], index)) {
      return index;
    }
  }

  return startIndex;
}

// ============================================
// Hook Implementation
// ============================================

export function useListNavigation<T extends ListItem>(
  options: UseListNavigationOptions<T>
): UseListNavigationReturn {
  const {
    items,
    selectedIndex,
    onSelectedIndexChange,
    onSelect,
    onClose,
    onBackspace,
    onTab,
    isItemSelectable = () => true,
    searchQuery = "",
    enableAutoScroll = true,
    scrollContainerRef: externalScrollRef,
    additionalKeyHandlers = {},
    enableGlobalListener = false,
    inputRef,
    hasModalState = false,
    onGoBack,
    onEscape,
  } = options;

  const internalScrollRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = externalScrollRef || internalScrollRef;

  const tauriSelectAll = useTauriSelectAllShortcut();

  // Refs for frequently-changing values used in the global listener.
  // This prevents re-attaching the listener on every state change.
  const stateRef = useRef({
    items,
    selectedIndex,
    searchQuery,
    hasModalState,
  });
  useEffect(() => {
    stateRef.current = {
      items,
      selectedIndex,
      searchQuery,
      hasModalState,
    };
  });

  const callbackRef = useRef({
    onSelectedIndexChange,
    onClose,
    onBackspace,
    onTab,
    onGoBack,
    onEscape,
    isItemSelectable,
  });
  useEffect(() => {
    callbackRef.current = {
      onSelectedIndexChange,
      onClose,
      onBackspace,
      onTab,
      onGoBack,
      onEscape,
      isItemSelectable,
    };
  });

  // ============================================
  // Find next/previous selectable item
  // ============================================
  const findNextSelectableIndexInItems = useCallback(
    (startIndex: number, direction: 1 | -1): number => {
      return findNextSelectableIndex(
        items,
        startIndex,
        direction,
        isItemSelectable
      );
    },
    [items, isItemSelectable]
  );

  // Ref-based version for use inside the global listener
  const findNextSelectableIndexFromRef = useCallback(
    (startIndex: number, direction: 1 | -1): number => {
      const { items: refItems } = stateRef.current;
      const { isItemSelectable: refSelectable } = callbackRef.current;
      return findNextSelectableIndex(
        refItems as T[],
        startIndex,
        direction,
        refSelectable
      );
    },
    []
  );

  // ============================================
  // Auto-scroll to selected item
  // ============================================
  useEffect(() => {
    if (!enableAutoScroll || selectedIndex < 0 || !scrollContainerRef.current) {
      return;
    }

    const container = scrollContainerRef.current;
    const selectedElement = container.querySelector(
      `[data-spotlight-item-index="${selectedIndex}"]`
    ) as HTMLElement;

    if (selectedElement) {
      selectedElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedIndex, enableAutoScroll, scrollContainerRef]);

  // ============================================
  // Global keyboard listener (navigation only)
  //
  // Handles Arrow, Tab, and Backspace when focus is outside the spotlight
  // input. Escape is NOT handled here — SpotlightPortal owns that.
  // ============================================
  useEffect(() => {
    if (!enableGlobalListener) return;

    const handler = (event: Event) => {
      const keyboardEvent = event as NativeKeyboardEvent;
      if (keyboardEvent.isComposing) return;

      const state = stateRef.current;
      const callbacks = callbackRef.current;
      const target = keyboardEvent.target;
      const isOurInput = inputRef && target === inputRef.current;

      if (isOurInput) return;
      if (!(target instanceof HTMLElement)) return;

      if (
        target.isContentEditable ||
        target.closest(".cm-editor") !== null ||
        target.closest('[contenteditable="true"]') !== null ||
        target.closest(".xterm") !== null
      )
        return;

      const isFormInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        target.getAttribute("contenteditable") === "true" ||
        target.closest(".cm-editor") !== null ||
        target.closest(".cm-content") !== null ||
        target.closest('[contenteditable="true"]') !== null ||
        target.closest(".xterm") !== null;

      // Arrow keys — navigate the list
      if (
        keyboardEvent.key === "ArrowDown" ||
        keyboardEvent.key === "ArrowUp"
      ) {
        if (isFormInput && !isOurInput) return;

        keyboardEvent.preventDefault();
        keyboardEvent.stopPropagation();

        if (state.items.length === 0) return;

        const direction = keyboardEvent.key === "ArrowUp" ? -1 : 1;
        const nextIndex = findNextSelectableIndexFromRef(
          state.selectedIndex,
          direction
        );
        if (nextIndex !== state.selectedIndex) {
          callbacks.onSelectedIndexChange(nextIndex);
        }

        if (inputRef?.current) {
          setTimeout(() => inputRef.current?.focus(), 0);
        }
        return;
      }

      // Tab — always prevent default to keep focus in the spotlight
      if (keyboardEvent.key === "Tab") {
        if (isFormInput && !isOurInput) return;

        keyboardEvent.preventDefault();
        keyboardEvent.stopPropagation();

        if (callbacks.onTab) {
          callbacks.onTab(!keyboardEvent.shiftKey);
        }

        if (inputRef?.current) {
          setTimeout(() => inputRef.current?.focus(), 0);
        }
        return;
      }

      // Backspace/Delete — go back or clear
      if (keyboardEvent.key === "Backspace" || keyboardEvent.key === "Delete") {
        if (isFormInput) {
          if (state.hasModalState && callbacks.onGoBack) {
            const inputTarget = target as
              | HTMLInputElement
              | HTMLTextAreaElement;
            if (inputTarget.value === "") {
              keyboardEvent.preventDefault();
              keyboardEvent.stopPropagation();
              callbacks.onGoBack();
            }
          }
          return;
        }

        keyboardEvent.preventDefault();

        if (state.hasModalState && callbacks.onGoBack) {
          callbacks.onGoBack();
        } else if (callbacks.onBackspace) {
          callbacks.onBackspace();
        }
        return;
      }
    };

    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [enableGlobalListener, inputRef, findNextSelectableIndexFromRef]);

  // ============================================
  // Main keyboard handler (for focused input)
  // ============================================
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.nativeEvent.isComposing) {
        return;
      }

      tauriSelectAll(event);
      if (event.defaultPrevented) return;

      const additionalHandler = additionalKeyHandlers[event.key];
      if (additionalHandler) {
        const handled = additionalHandler(event);
        if (handled === true) {
          return;
        }
      }

      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          if (items.length === 0) return;

          const nextIndex = findNextSelectableIndexInItems(selectedIndex, 1);
          if (nextIndex !== selectedIndex) {
            onSelectedIndexChange(nextIndex);
          }
          break;
        }

        case "ArrowUp": {
          event.preventDefault();
          if (items.length === 0) return;

          const prevIndex = findNextSelectableIndexInItems(selectedIndex, -1);
          if (prevIndex !== selectedIndex) {
            onSelectedIndexChange(prevIndex);
          }
          break;
        }

        case "Enter": {
          event.preventDefault();

          if (selectedIndex < 0 || selectedIndex >= items.length) {
            return;
          }

          const item = items[selectedIndex];
          if (!isItemSelectable(item, selectedIndex)) {
            return;
          }

          if (onSelect) {
            onSelect(item, selectedIndex);
          } else if (item.action) {
            item.action();
          }
          break;
        }

        case "Escape": {
          event.preventDefault();
          if (onEscape) {
            onEscape();
          } else if (hasModalState && onGoBack) {
            onGoBack();
          } else {
            onClose();
          }
          break;
        }

        case "Backspace": {
          if (searchQuery === "") {
            if (hasModalState && onGoBack) {
              event.preventDefault();
              onGoBack();
            } else if (onBackspace) {
              event.preventDefault();
              onBackspace();
            }
          }
          break;
        }

        case "Tab": {
          event.preventDefault();
          if (onTab) {
            onTab(!event.shiftKey);
          }
          break;
        }
      }
    },
    [
      items,
      selectedIndex,
      onSelectedIndexChange,
      onSelect,
      onClose,
      onBackspace,
      onTab,
      isItemSelectable,
      searchQuery,
      additionalKeyHandlers,
      findNextSelectableIndexInItems,
      onEscape,
      hasModalState,
      onGoBack,
      tauriSelectAll,
    ]
  );

  return {
    handleKeyDown,
    scrollContainerRef,
  };
}

export default useListNavigation;
