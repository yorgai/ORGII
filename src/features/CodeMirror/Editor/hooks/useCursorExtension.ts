/**
 * useCursorExtension Hook
 *
 * Creates a CodeMirror extension for tracking cursor position changes.
 * Uses refs for callbacks to prevent extension recreation on callback changes.
 */
import { Extension } from "@codemirror/state";
import { EditorView, ViewUpdate } from "@codemirror/view";
import { MutableRefObject, useMemo } from "react";

import type { CallbackRefs, CursorPosition } from "../types";

/**
 * Hook to create cursor position tracking extension
 *
 * @param callbackRefs - Ref containing callback functions
 * @param hasCursorCallback - Whether cursor callback is provided
 * @returns Extension for cursor tracking, or null if no callback
 */
export function useCursorExtension(
  callbackRefs: MutableRefObject<CallbackRefs>,
  hasCursorCallback: boolean
): Extension | null {
  return useMemo(() => {
    if (!hasCursorCallback) return null;

    return EditorView.updateListener.of((update: ViewUpdate) => {
      // Only fire on selection changes
      if (update.selectionSet || update.docChanged) {
        const callback = callbackRefs.current.onCursorChange;
        if (!callback) return;

        const state = update.state;
        const selection = state.selection.main;
        const doc = state.doc;

        // Get line and column (1-based)
        const line = doc.lineAt(selection.head);
        const lineNumber = line.number;
        const column = selection.head - line.from + 1;

        // Calculate selection info
        let selectedChars = 0;
        let selectedLines = 0;

        if (!selection.empty) {
          selectedChars = Math.abs(selection.to - selection.from);
          const fromLine = doc.lineAt(selection.from).number;
          const toLine = doc.lineAt(selection.to).number;
          selectedLines = toLine - fromLine + 1;
        }

        const cursorPosition: CursorPosition = {
          line: lineNumber,
          column,
          selectedChars: selectedChars > 0 ? selectedChars : undefined,
          selectedLines: selectedLines > 1 ? selectedLines : undefined,
        };

        callback(cursorPosition);
      }
    });
  }, [callbackRefs, hasCursorCallback]);
}
