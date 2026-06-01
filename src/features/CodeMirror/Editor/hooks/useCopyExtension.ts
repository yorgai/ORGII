/**
 * useCopyExtension Hook
 *
 * Creates a CodeMirror extension that adds file metadata to clipboard on copy.
 * This enables pasting with file reference information.
 */
import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { MutableRefObject, useMemo } from "react";

import type { CallbackRefs } from "../types";

/**
 * Hook to create copy handler extension with file metadata
 *
 * @param callbackRefs - Ref containing callback functions (including filePath)
 * @param filePath - Current file path (triggers recreation when path changes)
 * @returns Extension for enhanced copy, or null if no filePath
 */
export function useCopyExtension(
  callbackRefs: MutableRefObject<CallbackRefs>,
  filePath?: string
): Extension | null {
  // This MUST recreate when filePath changes (different file = different metadata)
  return useMemo(() => {
    if (!filePath) return null;

    return EditorView.domEventHandlers({
      copy(event, view) {
        const currentFilePath = callbackRefs.current.filePath;
        if (!currentFilePath) return false;

        const selection = view.state.selection.main;
        if (selection.empty) return false;

        // Get selected text and line range
        const doc = view.state.doc;
        const fromLine = doc.lineAt(selection.from).number;
        const toLine = doc.lineAt(selection.to).number;
        const selectedText = view.state.sliceDoc(selection.from, selection.to);

        // Add custom clipboard data with file reference
        const clipboardData = event.clipboardData;
        if (clipboardData) {
          // Set the file reference data
          const fileRef = JSON.stringify({
            filePath: currentFilePath,
            fileName: currentFilePath.split("/").pop() || currentFilePath,
            lineStart: fromLine,
            lineEnd: toLine,
            text: selectedText,
          });
          clipboardData.setData("application/x-orgii-file-reference", fileRef);
          // Also set plain text for normal paste
          clipboardData.setData("text/plain", selectedText);
          event.preventDefault();
          return true;
        }
        return false;
      },
    });
  }, [callbackRefs, filePath]);
}
