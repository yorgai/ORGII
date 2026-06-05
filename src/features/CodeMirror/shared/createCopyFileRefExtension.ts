import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { getFileName } from "@src/util/file/pathUtils";

export function createCopyFileRefExtension(filePath: string): Extension {
  return EditorView.domEventHandlers({
    copy(event, view) {
      const selection = view.state.selection.main;
      if (selection.empty) return false;
      const doc = view.state.doc;
      const fromLine = doc.lineAt(selection.from).number;
      const toLine = doc.lineAt(selection.to).number;
      const text = view.state.sliceDoc(selection.from, selection.to);
      const clipboardData = event.clipboardData;
      if (!clipboardData) return false;
      clipboardData.setData(
        "application/x-orgii-file-reference",
        JSON.stringify({
          filePath,
          fileName: getFileName(filePath),
          lineStart: fromLine,
          lineEnd: toLine,
        })
      );
      clipboardData.setData("text/plain", text);
      event.preventDefault();
      return true;
    },
  });
}
