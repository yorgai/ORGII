/**
 * useSelectionExtension Hook
 *
 * Creates a CodeMirror extension for tracking text selection.
 * Requires long-press selection (like Cursor) to avoid triggering on quick selections.
 */
import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { MutableRefObject, useEffect, useRef, useState } from "react";

import { getUiScaleFromCssVar } from "@src/lib/dndKit";

import {
  MIN_HOLD_DURATION_MS,
  MIN_SELECTION_LENGTH,
  SHOW_DELAY_MS,
} from "../config";
import type { CallbackRefs } from "../types";

/** Get current timestamp - extracted to module scope to satisfy linter purity rules */
function getCurrentTime(): number {
  return Date.now();
}

/**
 * Creates the selection extension with event handlers.
 * Extracted to avoid useMemo purity issues with Date.now() and ref access.
 */
function createSelectionExtension(
  callbackRefs: MutableRefObject<CallbackRefs>,
  selectionTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
  mouseDownTimeRef: MutableRefObject<number>
): Extension {
  return EditorView.domEventHandlers({
    mouseup: (event: MouseEvent, view: EditorView) => {
      const callback = callbackRefs.current.onTextSelection;
      if (!callback) return false;

      const state = view.state;
      const selection = state.selection.main;

      // Clear any pending timer
      if (selectionTimerRef.current) {
        clearTimeout(selectionTimerRef.current);
        selectionTimerRef.current = null;
      }

      // Check if this was a long-press (held mouse for sufficient duration)
      const holdDuration = getCurrentTime() - mouseDownTimeRef.current;
      const isLongPress = holdDuration >= MIN_HOLD_DURATION_MS;

      // Only fire if: non-empty selection + sufficient length + long press
      if (!selection.empty && isLongPress) {
        const doc = state.doc;
        const selectedText = state.sliceDoc(selection.from, selection.to);

        // Require minimum selection length
        if (selectedText.trim().length < MIN_SELECTION_LENGTH) {
          return false;
        }

        const fromLine = doc.lineAt(selection.from).number;
        const toLine = doc.lineAt(selection.to).number;

        // Capture event coordinates for delayed callback
        const uiScale = getUiScaleFromCssVar();
        const posX = event.clientX / uiScale;
        const posY = event.clientY / uiScale;

        // Short delay after mouseup to show dropdown
        selectionTimerRef.current = setTimeout(() => {
          callback({
            text: selectedText,
            fromLine,
            toLine,
            position: { x: posX, y: posY },
          });
          selectionTimerRef.current = null;
        }, SHOW_DELAY_MS);
      } else {
        // Clear selection if clicking without selection or not long press
        callback(null);
      }

      return false; // Don't prevent default behavior
    },
    mousedown: (_event: MouseEvent, _view: EditorView) => {
      // Record mousedown time for long-press detection
      mouseDownTimeRef.current = getCurrentTime();

      // Clear dropdown and pending timer on mousedown (start of new selection)
      if (selectionTimerRef.current) {
        clearTimeout(selectionTimerRef.current);
        selectionTimerRef.current = null;
      }
      const callback = callbackRefs.current.onTextSelection;
      callback?.(null);
      return false;
    },
  });
}

/**
 * Hook to create text selection tracking extension
 *
 * @param callbackRefs - Ref containing callback functions
 * @param hasSelectionCallback - Whether selection callback is provided
 * @returns Extension for selection tracking, or null if no callback
 */
export function useSelectionExtension(
  callbackRefs: MutableRefObject<CallbackRefs>,
  hasSelectionCallback: boolean
): Extension | null {
  // Track selection timer for debounced dropdown
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track mousedown timestamp for long-press detection
  const mouseDownTimeRef = useRef<number>(0);

  // Store the extension in state - initialized as null, created in effect
  const [extension, setExtension] = useState<Extension | null>(null);

  // Create/update extension when callback availability changes
  // Refs are only accessed inside this effect, not during render
  useEffect(() => {
    if (hasSelectionCallback) {
      setExtension(
        createSelectionExtension(
          callbackRefs,
          selectionTimerRef,
          mouseDownTimeRef
        )
      );
    } else {
      setExtension(null);
    }
  }, [callbackRefs, hasSelectionCallback]);

  // Cleanup timer on unmount
  useEffect(() => {
    // Capture ref value for cleanup (per exhaustive-deps rule)
    const timerRef = selectionTimerRef;
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return extension;
}
