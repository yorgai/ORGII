import { useCallback, useEffect } from "react";
import type React from "react";

import type { AgentExecMode } from "@src/config/sessionCreatorConfig";
import type { SlashItem } from "@src/types/extensions";

import type { ListEntry, OpenFlyoutState } from "./types";

interface UseKeyboardOptions {
  visible: boolean;
  entries: ListEntry[];
  totalFlat: number;
  highlightIndex: number;
  openFlyout: OpenFlyoutState | null;
  listRef: React.RefObject<HTMLDivElement | null>;
  setHighlightIndex: (idx: number) => void;
  setOpenFlyout: (state: OpenFlyoutState | null) => void;
  onSelect: (item: SlashItem) => void;
  onModeSelect: (mode: AgentExecMode) => void;
  onImageUpload?: () => void;
  onClose: () => void;
  keyboardHandlerRef: React.MutableRefObject<
    ((e: KeyboardEvent) => boolean) | null
  >;
}

/**
 * Wires keyboard navigation (ArrowUp/Down, Enter, Tab, Escape) for the
 * slash command menu, including flyout open/close. The handler is stored in
 * `keyboardHandlerRef` so the parent editor can delegate key events without
 * React synthetic event plumbing.
 */
export function useKeyboard({
  visible,
  entries,
  totalFlat,
  highlightIndex,
  openFlyout,
  listRef,
  setHighlightIndex,
  setOpenFlyout,
  onSelect,
  onModeSelect,
  onImageUpload,
  onClose,
  keyboardHandlerRef,
}: UseKeyboardOptions): void {
  const selectAtIndex = useCallback(
    (idx: number) => {
      for (const entry of entries) {
        if (entry.kind === "image" && entry.flatIndex === idx) {
          onImageUpload?.();
          onClose();
          return;
        }
        if (entry.kind === "mode" && entry.flatIndex === idx) {
          onModeSelect(entry.mode.id);
          return;
        }
        if (entry.kind === "item" && entry.flatIndex === idx) {
          onSelect(entry.item);
          return;
        }
        if (entry.kind === "flyout" && entry.flatIndex === idx) {
          const itemEls =
            listRef.current?.querySelectorAll("[data-slash-flat]");
          const el = itemEls?.[idx] as HTMLElement | undefined;
          if (el) {
            setOpenFlyout({
              kind: "category",
              category: entry.category,
              anchorTop: el.getBoundingClientRect().top,
              items: entry.items,
            });
          }
          return;
        }
        if (entry.kind === "mode-flyout" && entry.flatIndex === idx) {
          const itemEls =
            listRef.current?.querySelectorAll("[data-slash-flat]");
          const el = itemEls?.[idx] as HTMLElement | undefined;
          if (el) {
            setOpenFlyout({
              kind: "modes",
              anchorTop: el.getBoundingClientRect().top,
            });
          }
          return;
        }
        if (entry.kind === "models-flyout" && entry.flatIndex === idx) {
          const itemEls =
            listRef.current?.querySelectorAll("[data-slash-flat]");
          const el = itemEls?.[idx] as HTMLElement | undefined;
          if (el) {
            setOpenFlyout({
              kind: "models",
              anchorTop: el.getBoundingClientRect().top,
            });
          }
          return;
        }
      }
    },
    [
      entries,
      onImageUpload,
      onModeSelect,
      onSelect,
      setOpenFlyout,
      listRef,
      onClose,
    ]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      if (!visible) return false;

      if (openFlyout && event.key === "Escape") {
        setOpenFlyout(null);
        return true;
      }

      switch (event.key) {
        case "ArrowDown":
          setHighlightIndex(
            highlightIndex < totalFlat - 1 ? highlightIndex + 1 : 0
          );
          return true;
        case "ArrowUp":
          setHighlightIndex(
            highlightIndex > 0 ? highlightIndex - 1 : totalFlat - 1
          );
          return true;
        case "Enter":
        case "Tab":
          selectAtIndex(highlightIndex);
          return true;
        case "Escape":
          onClose();
          return true;
        default:
          return false;
      }
    },
    [
      visible,
      openFlyout,
      totalFlat,
      highlightIndex,
      selectAtIndex,
      setHighlightIndex,
      setOpenFlyout,
      onClose,
    ]
  );

  useEffect(() => {
    keyboardHandlerRef.current = handleKeyDown;
    return () => {
      keyboardHandlerRef.current = null;
    };
  }, [handleKeyDown, keyboardHandlerRef]);
}
