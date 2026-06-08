/**
 * useTextSelectionDropdown Hook
 *
 * Manages text selection dropdown state for terminal and browser views.
 * Detects text selection and provides handlers for dropdown actions.
 *
 * Features:
 * - Listens for mouseup events to detect text selection
 * - Calculates dropdown position based on selection
 * - Provides action handlers for Ask Agent and Add to Context
 *
 * @example
 * const { visible, position, selectedText, hideDropdown, handleAction } = useTextSelectionDropdown({
 *   source: 'terminal',
 *   enabled: true,
 *   onAskAgent: (text) => */
import { useCallback, useEffect, useRef, useState } from "react";

import { useDebouncedCallback } from "@src/hooks/perf";
import { getUiScaleFromCssVar } from "@src/lib/dndKit";

import { DropdownAction } from "./config";
import {
  UseTextSelectionDropdownOptions,
  UseTextSelectionDropdownReturn,
} from "./types";

// ============================================
// Constants
// ============================================

const SELECTION_DEBOUNCE_MS = 100;

// ============================================
// Hook Implementation
// ============================================

export function useTextSelectionDropdown(
  options: UseTextSelectionDropdownOptions
): UseTextSelectionDropdownReturn {
  const { enabled = true, containerRef, onAskAgent, onAddToContext } = options;

  // State
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [selectedText, setSelectedText] = useState("");

  // Show dropdown at position
  const showDropdown = useCallback(
    (newPosition: { x: number; y: number }, text: string) => {
      if (!enabled || !text.trim()) return;

      setSelectedText(text.trim());
      setPosition(newPosition);
      setVisible(true);
    },
    [enabled]
  );

  // Hide dropdown
  const hideDropdown = useCallback(() => {
    setVisible(false);
    // Keep text for animation exit
    setTimeout(() => {
      setSelectedText("");
    }, 200);
  }, []);

  // Handle action selection
  const handleAction = useCallback(
    (action: DropdownAction, sessionId?: string | null) => {
      if (!selectedText) return;

      if (action === "ask-agent") {
        onAskAgent?.(selectedText);
      } else if (action === "add-to-context") {
        onAddToContext?.(selectedText, sessionId ?? null);
      }

      hideDropdown();
    },
    [selectedText, onAskAgent, onAddToContext, hideDropdown]
  );

  const debouncedHandleMouseUp = useDebouncedCallback((event: MouseEvent) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }

    const text = selection.toString().trim();
    if (!text) return;

    if (containerRef?.current) {
      const range = selection.getRangeAt(0);
      const commonAncestor = range.commonAncestorContainer;
      const container = containerRef.current;

      if (!container.contains(commonAncestor)) {
        return;
      }
    }

    const offsetX = 10;
    const offsetY = 10;
    const uiScale = getUiScaleFromCssVar();

    showDropdown(
      {
        x: event.clientX / uiScale + offsetX,
        y: event.clientY / uiScale + offsetY,
      },
      text
    );
  }, SELECTION_DEBOUNCE_MS);

  // Listen for mouseup events to detect selection
  useEffect(() => {
    if (!enabled) return;

    const handleMouseUp = (event: MouseEvent) => {
      debouncedHandleMouseUp(event);
    };

    // Handle click outside to close dropdown
    const handleClickOutside = (event: MouseEvent) => {
      if (visibleRef.current) {
        const target = event.target;
        if (!(target instanceof Node)) return;
        const dropdown = document.querySelector(".text-selection-dropdown");
        if (dropdown && !dropdown.contains(target)) {
          hideDropdown();
        }
      }
    };

    // Handle escape key
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && visibleRef.current) {
        hideDropdown();
      }
    };

    const container = containerRef?.current ?? document;
    container.addEventListener("mouseup", handleMouseUp as EventListener);
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      debouncedHandleMouseUp.cancel();
      container.removeEventListener("mouseup", handleMouseUp as EventListener);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    enabled,
    containerRef,
    showDropdown,
    hideDropdown,
    debouncedHandleMouseUp,
  ]);

  return {
    visible,
    position,
    selectedText,
    showDropdown,
    hideDropdown,
    handleAction,
  };
}

export default useTextSelectionDropdown;
