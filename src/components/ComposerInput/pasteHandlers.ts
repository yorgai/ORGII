/**
 * Paste handling for ComposerInput.
 *
 * Mirrors `TiptapInput/editorHandlers/pasteHandler.ts` priority order:
 *   1. Image files → forwarded to `onImagePaste`, paste suppressed.
 *   2. Terminal selection (`window.__orgiiLastTerminalCopy` within window) →
 *      insert a terminal pill, suppress paste.
 *   3. File reference (`application/x-orgii-file-reference`) → insert a
 *      file-reference pill with line range, suppress paste.
 *   4. Otherwise, sanitize the plain-text payload and insert it manually so
 *      `contenteditable` does not pull in formatted HTML from the source.
 */
import { storePillText } from "@src/config/pillTokens";
import { createLogger } from "@src/hooks/logger";

import type { ComposerPillAttrs } from "./types";
import { TERMINAL_COPY_MAX_AGE, sanitizeText } from "./utils";

const logger = createLogger("ComposerInput");

export interface PasteHandlerContext {
  insertPill: (attrs: ComposerPillAttrs) => void;
  insertTextAtCaret: (text: string) => void;
  getOnImagePaste: () => ((files: File[]) => void) | undefined;
}

/**
 * Returns a `paste` event handler suitable for attaching directly to the
 * contenteditable host. Returns `true` if the event was consumed.
 */
export function createPasteHandler(ctx: PasteHandlerContext) {
  return (event: ClipboardEvent): boolean => {
    const clipboardData = event.clipboardData;
    if (!clipboardData) return false;

    const imageFiles: File[] = [];
    for (let index = 0; index < clipboardData.items.length; index++) {
      const item = clipboardData.items[index];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    const onImagePaste = ctx.getOnImagePaste();
    if (imageFiles.length > 0 && onImagePaste) {
      event.preventDefault();
      onImagePaste(imageFiles);
      return true;
    }

    const pastedText = clipboardData.getData("text/plain");

    const terminalCopy = window.__orgiiLastTerminalCopy;
    if (
      terminalCopy &&
      pastedText &&
      pastedText === terminalCopy.text &&
      Date.now() - terminalCopy.timestamp < TERMINAL_COPY_MAX_AGE
    ) {
      const terminalRef = { ...terminalCopy };
      window.__orgiiLastTerminalCopy = undefined;
      const lineCount = terminalRef.lineCount;
      const displayName =
        lineCount > 1
          ? `${terminalRef.sessionName} (1-${lineCount})`
          : terminalRef.sessionName;
      const pillPath = `terminal://${terminalRef.sessionId}/${Date.now()}`;
      ctx.insertPill({
        filePath: pillPath,
        fileName: displayName,
        isFolder: false,
        iconType: "terminal",
        lineStart: 1,
        lineEnd: lineCount,
      });
      storePillText(pillPath, terminalRef.text);
      event.preventDefault();
      return true;
    }

    const fileRefData = clipboardData.getData(
      "application/x-orgii-file-reference"
    );
    if (fileRefData) {
      try {
        const fileRef = JSON.parse(fileRefData) as {
          filePath: string;
          fileName: string;
          lineStart: number;
          lineEnd: number;
          text: string;
        };
        ctx.insertPill({
          filePath: fileRef.filePath,
          fileName: fileRef.fileName,
          isFolder: false,
          iconType: "file",
          lineStart: fileRef.lineStart,
          lineEnd: fileRef.lineEnd,
        });
        event.preventDefault();
        return true;
      } catch (parseError) {
        logger.warn("Failed to parse file reference:", parseError);
      }
    }

    // Fall back to a sanitized plain-text insert. We bypass the browser's
    // default paste to avoid letting Word/HTML formatting bleed into the
    // editor and to keep IME-tofu characters out of the document.
    if (pastedText) {
      event.preventDefault();
      ctx.insertTextAtCaret(sanitizeText(pastedText));
      return true;
    }

    return false;
  };
}
