/**
 * Cut handling for ComposerInput.
 *
 * The browser's default cut only serializes visible text, so pill elements
 * (which are `contenteditable="false"` spans) are removed from the DOM but
 * never written to the clipboard.  This handler intercepts the `cut` event,
 * serializes the selected content to the clipboard with two MIME types:
 *
 *   text/plain                          — human-readable, pills as display names
 *   application/x-orgii-composer-fragment — JSON snapshot parts (text/newline/pill)
 *     so pasting back into the editor restores pills with all their metadata
 *
 * After writing to the clipboard the handler explicitly deletes the selected
 * range so no separate `deleteByCut` / `input` sequence is needed.
 */
import type { ComposerPillAttrs, ComposerSnapshot } from "./types";
import { PILL_DATA_ATTR, readPillAttrs } from "./utils";

export type ComposerFragmentPart = ComposerSnapshot["parts"][number];

/**
 * Walk a DOM Range and collect the parts it contains in document order.
 *
 * The Range may partially overlap text nodes (only part of the text is
 * selected).  For pill spans, the browser either includes the whole span in
 * the range (when it straddles or fully encompasses the span) or excludes it,
 * so pills are treated as atomic units — either fully included or skipped.
 */
function collectRangeParts(range: Range): ComposerFragmentPart[] {
  if (range.collapsed) return [];

  const parts: ComposerFragmentPart[] = [];

  // Build a temporary DocumentFragment from the range so we can walk it with
  // the same approach used by `captureSnapshot` / `walkEditorDom`.
  // `cloneContents()` deep-clones the selected nodes (pill spans and text
  // nodes) without removing them from the live DOM.
  const fragment = range.cloneContents();

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text) parts.push({ kind: "text", text });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;

    if (element.getAttribute(PILL_DATA_ATTR) === "true") {
      const attrs: ComposerPillAttrs = readPillAttrs(element);
      parts.push({ kind: "pill", attrs });
      return;
    }

    const tag = element.tagName;
    if (tag === "BR") {
      parts.push({ kind: "newline" });
      return;
    }

    element.childNodes.forEach(visit);
  };

  fragment.childNodes.forEach(visit);
  return parts;
}

/**
 * Render snapshot parts to a plain-text string.  Pills become their display
 * name so the clipboard text is readable in any app.
 */
export function partsToPlainText(parts: ComposerFragmentPart[]): string {
  return parts
    .map((part) => {
      if (part.kind === "text") return part.text;
      if (part.kind === "newline") return "\n";
      return part.attrs.fileName ?? part.attrs.filePath ?? "";
    })
    .join("")
    .replace(/\u200B/g, "");
}

export interface CutHandlerContext {
  reconcilePillsFromDom: () => void;
  onAfterCut: () => void;
}

/**
 * Returns a `cut` event handler suitable for attaching directly to the
 * contenteditable host.  The returned function always calls
 * `event.preventDefault()` and handles the deletion itself so the caller
 * does not have to do anything extra.
 */
export function createCutHandler(ctx: CutHandlerContext) {
  return (event: ClipboardEvent): void => {
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (range.collapsed) return;

    // Collect selected parts before deleting them.
    const parts = collectRangeParts(range);
    const plainText = partsToPlainText(parts);

    // Suppress the browser default so we control the clipboard payload.
    event.preventDefault();

    // Write both representations to the clipboard.
    clipboardData.setData("text/plain", plainText);
    try {
      clipboardData.setData(
        "application/x-orgii-composer-fragment",
        JSON.stringify(parts)
      );
    } catch {
      // Some environments (JSDOM) do not support arbitrary MIME types.
    }

    // Delete the selected range from the live DOM.
    range.deleteContents();
    selection.removeAllRanges();

    // Sync pill registry and notify content-change subscribers.
    ctx.reconcilePillsFromDom();
    ctx.onAfterCut();
  };
}
