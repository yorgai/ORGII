/**
 * Selection helpers for the contenteditable host.
 *
 * Pill spans are `contenteditable="false"`, so the browser already treats
 * the entire pill as a single navigation unit. The only piece we have to
 * handle ourselves is *programmatically* placing the caret — after
 * inserting a pill, after `setContent`, after `clear`, etc.
 */
import { PILL_DATA_ATTR } from "./utils";

/** Place the caret at the end of the contenteditable host. */
export function placeCaretAtEnd(host: HTMLElement): void {
  host.focus();
  const range = document.createRange();
  range.selectNodeContents(host);
  range.collapse(false);
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Place the caret immediately after the given DOM node. */
export function placeCaretAfter(node: Node): void {
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Return the currently active Range *if* it lives inside `host`. Otherwise
 * return a synthetic range positioned at the end of `host` so callers can
 * safely insert content even when the editor was never focused.
 */
export function rangeInsideHost(host: HTMLElement): Range {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    if (
      host.contains(range.startContainer) &&
      host.contains(range.endContainer)
    ) {
      return range.cloneRange();
    }
  }
  const fallback = document.createRange();
  fallback.selectNodeContents(host);
  fallback.collapse(false);
  return fallback;
}

/**
 * Insert a node at the current caret position (or at the end of `host` if
 * no in-host selection exists). The caret is placed immediately after the
 * inserted node so the next typed character lands after the pill.
 */
export function insertNodeAtCaret(host: HTMLElement, node: Node): void {
  host.focus();
  const range = rangeInsideHost(host);
  range.deleteContents();
  range.insertNode(node);
  placeCaretAfter(node);
}

/** Find the nearest pill ancestor (or self) of a DOM node, if any. */
export function findPillAncestor(node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as HTMLElement;
      if (element.getAttribute(PILL_DATA_ATTR) === "true") return element;
    }
    current = current.parentNode;
  }
  return null;
}

/**
 * Compute the offset (in plain-text characters, with pills counted as their
 * display name) from the start of `host` to the given DOM point. Used to
 * detect whether `/` was typed at position 0.
 */
export function caretTextOffset(host: HTMLElement, range: Range): number {
  const preRange = document.createRange();
  preRange.selectNodeContents(host);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length;
}
