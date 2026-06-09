/**
 * useAddToAgentInsertion
 *
 * Shared hook consumed by both the active-session InputArea and the
 * SessionCreator. Watches `addToAgentAtom` for pending "add file/lines to
 * agent" requests written by the WorkStation code-editor text-selection
 * dropdown, inserts the appropriate pill/reference into the provided
 * ComposerInput ref, and then clears the atom.
 *
 * A scheduled retry loop handles both React's passive-effect timing and the
 * case where ComposerInput hasn't finished initialising yet (e.g. the chat panel just
 * opened and the ref is still null on the first render).
 */
import { useAtomValue, useSetAtom } from "jotai";
import { type RefObject, useEffect } from "react";

import type { ComposerInputRef } from "@src/components/ComposerInput";
import { storePillText } from "@src/config/pillTokens";
import { addToAgentAtom } from "@src/store/ui/addToAgentAtom";

export function useAddToAgentInsertion(
  composerInputRef: RefObject<ComposerInputRef | null>
): void {
  const request = useAtomValue(addToAgentAtom);
  const clearRequest = useSetAtom(addToAgentAtom);

  useEffect(() => {
    if (!request) return;

    const stableRequest = request;
    let cancelled = false;
    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;

    function scheduleInsert(delayMs: number) {
      retryTimeoutId = setTimeout(tryInsert, delayMs);
    }

    function tryInsert() {
      if (cancelled) return;
      retryTimeoutId = null;

      const editor = composerInputRef.current;
      if (!editor) {
        scheduleInsert(50);
        return;
      }

      if (stableRequest.type === "lines") {
        editor.insertFileReference({
          filePath: stableRequest.filePath,
          fileName: stableRequest.fileName,
          lineStart: stableRequest.lineStart,
          lineEnd: stableRequest.lineEnd,
        });
      } else if (stableRequest.type === "terminal") {
        const lineCount = stableRequest.text.split("\n").length;
        const pillPath = `terminal://selection/${Date.now()}`;
        const label =
          stableRequest.displayName ??
          (lineCount > 1 ? `Terminal (1-${lineCount})` : "Terminal");
        storePillText(pillPath, stableRequest.text);
        editor.insertFilePill(pillPath, false, "terminal", label);
      } else if (stableRequest.type === "dom-element") {
        const pillPath = `dom-element://selection/${Date.now()}`;
        storePillText(pillPath, stableRequest.text);
        editor.insertFilePill(
          pillPath,
          false,
          "dom-element",
          stableRequest.displayName
        );
      } else {
        editor.insertFilePill(stableRequest.filePath, false, "file");
      }

      editor.focus();
      clearRequest(null);
    }

    scheduleInsert(0);

    return () => {
      cancelled = true;
      if (retryTimeoutId !== null) clearTimeout(retryTimeoutId);
    };
  }, [request, composerInputRef, clearRequest]);
}
