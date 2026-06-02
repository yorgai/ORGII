/**
 * Editor operations for ComposerInput.
 *
 * Owns the in-DOM pill registry and provides mutation helpers used by the
 * imperative handle, the paste handler, and the keyboard handler. Splitting
 * this out keeps `index.tsx` under the file-size limit.
 *
 * Pills are mounted as `<span data-composer-pill="true" data-pill-id="...">`
 * directly into the contenteditable host. The host component renders a
 * React Portal into each span so the React tree owns the pill UI while the
 * DOM owns the document order (which is what Selection / Range APIs need).
 */
import { useCallback, useMemo, useRef, useState } from "react";

import {
  insertNodeAtCaret,
  placeCaretAfter,
  placeCaretAtEnd,
} from "./selection";
import type { ComposerPillAttrs, ComposerSnapshot } from "./types";
import { PILL_DATA_ATTR, extractPlainText, pillDataAttributes } from "./utils";

const PILL_ID_ATTR = "data-pill-id";

let pillIdCounter = 0;
function nextPillId(): string {
  pillIdCounter += 1;
  return `composer-pill-${Date.now().toString(36)}-${pillIdCounter}`;
}

export interface PillEntry {
  id: string;
  attrs: ComposerPillAttrs;
}

export interface UseEditorOperationsResult {
  hostRef: React.MutableRefObject<HTMLDivElement | null>;
  pillEntries: PillEntry[];
  /** Insert a pill at the current caret position */
  insertPill: (attrs: ComposerPillAttrs) => void;
  /** Insert text at the current caret position (preserves newlines) */
  insertTextAtCaret: (text: string) => void;
  /** Replace all contents with `text` (no pills) */
  setHostContent: (text: string) => void;
  /** Restore the editor from a structured snapshot (text + pills + newlines) */
  restoreSnapshot: (snapshot: ComposerSnapshot) => void;
  /** Capture a structured snapshot of the current document */
  captureSnapshot: () => ComposerSnapshot;
  /** Empty the editor */
  clearHost: () => void;
  /** Insert a literal newline (`<br>`) at the caret */
  insertNewline: () => void;
  /** Focus the editor at the end */
  focusHost: () => void;
  /** Remove the first pill whose `filePath` matches */
  removePillByPath: (filePath: string) => void;
  /** True if there is no text and no pills */
  isHostEmpty: () => boolean;
  /** Reconcile pillEntries with the live DOM (call after `onInput`) */
  reconcilePillsFromDom: () => void;
  /** Re-register an existing DOM span (used by reconcile) */
  registerPillHost: (id: string, element: HTMLSpanElement) => void;
}

export function useEditorOperations(): UseEditorOperationsResult {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const pillHostsRef = useRef<Map<string, HTMLSpanElement>>(new Map());
  const pillAttrsRef = useRef<Map<string, ComposerPillAttrs>>(new Map());
  const [pillEntries, setPillEntries] = useState<PillEntry[]>([]);

  const syncPillEntries = useCallback(() => {
    const next: PillEntry[] = [];
    pillHostsRef.current.forEach((_element, id) => {
      const attrs = pillAttrsRef.current.get(id);
      if (attrs) next.push({ id, attrs });
    });
    setPillEntries(next);
  }, []);

  const registerPillHost = useCallback(
    (id: string, element: HTMLSpanElement) => {
      pillHostsRef.current.set(id, element);
    },
    []
  );

  const insertPill = useCallback(
    (attrs: ComposerPillAttrs) => {
      const host = hostRef.current;
      if (!host) return;
      const id = nextPillId();
      const span = document.createElement("span");
      const dataAttrs = pillDataAttributes(attrs);
      Object.entries(dataAttrs).forEach(([key, value]) => {
        span.setAttribute(key, value);
      });
      span.setAttribute(PILL_ID_ATTR, id);
      span.setAttribute("contenteditable", "false");
      pillHostsRef.current.set(id, span);
      pillAttrsRef.current.set(id, attrs);
      insertNodeAtCaret(host, span);
      syncPillEntries();
    },
    [syncPillEntries]
  );

  const insertTextAtCaret = useCallback((text: string) => {
    const host = hostRef.current;
    if (!host || !text) return;
    host.focus();
    // Split on newlines so multi-line text becomes <br>-separated.
    const segments = text.split("\n");
    let lastNode: Node | null = null;
    for (let index = 0; index < segments.length; index++) {
      if (segments[index]) {
        const textNode = document.createTextNode(segments[index]);
        insertNodeAtCaret(host, textNode);
        lastNode = textNode;
      }
      if (index < segments.length - 1) {
        const br = document.createElement("br");
        insertNodeAtCaret(host, br);
        lastNode = br;
      }
    }
    if (lastNode) placeCaretAfter(lastNode);
  }, []);

  const insertNewline = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    // Insert a literal "\n" text node rather than a <br>. The composer
    // host has `white-space: pre-wrap` (see index.scss), so "\n" renders
    // as a visible line break without the trailing-<br>-phantom quirk
    // that requires two Enters to produce one visible row break:
    //
    //   "abc" + Enter (br-based):
    //     DOM:   abc<br>     ← Chromium collapses trailing <br>, no row 2
    //     User:  presses Enter again to "actually" break the line
    //
    //   "abc" + Enter (\n-based):
    //     DOM:   abc\n       ← pre-wrap renders the newline, caret on row 2
    //     User:  one Enter, one visible new row
    //
    // Multi-line text inserted via insertTextAtCaret / setHostContent /
    // restoreSnapshot still uses <br> for legacy reasons; extractPlainText
    // serializes both forms (text content + <br>) to "\n", so storage and
    // submit logic see the same plain-text string regardless of how the
    // newlines were originally inserted.
    const newline = document.createTextNode("\n");
    insertNodeAtCaret(host, newline);
    // pre-wrap renders a trailing "\n" as a real line break, but the
    // resulting empty row has no inline content to anchor the caret rect.
    // Chromium then snaps the caret back up to the end of the previous
    // row — visually the Enter "did nothing" and the user has to press
    // Enter a second time. Anchor the new row with a zero-width space.
    //
    // We always (re)stamp the anchor at the host's end so repeat Enters
    // don't accumulate multiple anchors.
    const lastChild = host.lastChild;
    if (
      !lastChild ||
      lastChild.nodeType !== Node.TEXT_NODE ||
      lastChild.textContent !== "\u200B"
    ) {
      host.appendChild(document.createTextNode("\u200B"));
    }
    // Position the caret immediately after the just-inserted "\n", which
    // lives at the start of the new (empty) row.
    placeCaretAfter(newline);
  }, []);

  const setHostContent = useCallback(
    (text: string) => {
      const host = hostRef.current;
      if (!host) return;
      pillHostsRef.current.clear();
      pillAttrsRef.current.clear();
      host.textContent = "";
      if (text) {
        const segments = text.split("\n");
        segments.forEach((segment, index) => {
          if (segment) host.appendChild(document.createTextNode(segment));
          if (index < segments.length - 1)
            host.appendChild(document.createElement("br"));
        });
      }
      syncPillEntries();
    },
    [syncPillEntries]
  );

  const restoreSnapshot = useCallback(
    (snapshot: ComposerSnapshot) => {
      const host = hostRef.current;
      if (!host) return;
      if (!snapshot?.parts) return;
      pillHostsRef.current.clear();
      pillAttrsRef.current.clear();
      host.textContent = "";
      for (const part of snapshot.parts) {
        if (part.kind === "text") {
          if (part.text) host.appendChild(document.createTextNode(part.text));
        } else if (part.kind === "newline") {
          host.appendChild(document.createElement("br"));
        } else {
          const id = nextPillId();
          const span = document.createElement("span");
          const dataAttrs = pillDataAttributes(part.attrs);
          Object.entries(dataAttrs).forEach(([key, value]) => {
            span.setAttribute(key, value);
          });
          span.setAttribute(PILL_ID_ATTR, id);
          span.setAttribute("contenteditable", "false");
          pillHostsRef.current.set(id, span);
          pillAttrsRef.current.set(id, part.attrs);
          host.appendChild(span);
        }
      }
      syncPillEntries();
    },
    [syncPillEntries]
  );

  const captureSnapshot = useCallback((): ComposerSnapshot => {
    const host = hostRef.current;
    const parts: ComposerSnapshot["parts"] = [];
    if (!host) return { parts };
    host.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? "";
        if (text) parts.push({ kind: "text", text });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const element = node as HTMLElement;
      if (element.tagName === "BR") {
        parts.push({ kind: "newline" });
        return;
      }
      if (element.hasAttribute(PILL_DATA_ATTR)) {
        const id = element.getAttribute(PILL_ID_ATTR);
        const attrs = id ? pillAttrsRef.current.get(id) : undefined;
        if (attrs) parts.push({ kind: "pill", attrs: { ...attrs } });
        return;
      }
      // Fall back to plain-text extraction for any unexpected child.
      const text = element.textContent ?? "";
      if (text) parts.push({ kind: "text", text });
    });
    return { parts };
  }, []);

  const clearHost = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    pillHostsRef.current.clear();
    pillAttrsRef.current.clear();
    host.textContent = "";
    syncPillEntries();
  }, [syncPillEntries]);

  const focusHost = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    placeCaretAtEnd(host);
  }, []);

  const removePillByPath = useCallback(
    (filePath: string) => {
      const host = hostRef.current;
      if (!host) return;
      const nodes = host.querySelectorAll<HTMLElement>(`[${PILL_DATA_ATTR}]`);
      for (let index = 0; index < nodes.length; index++) {
        const element = nodes[index];
        if (element.getAttribute("data-file-path") === filePath) {
          const id = element.getAttribute(PILL_ID_ATTR);
          if (id) {
            pillHostsRef.current.delete(id);
            pillAttrsRef.current.delete(id);
          }
          element.parentNode?.removeChild(element);
          syncPillEntries();
          break;
        }
      }
    },
    [syncPillEntries]
  );

  const isHostEmpty = useCallback(() => {
    const host = hostRef.current;
    if (!host) return true;
    if (host.querySelector(`[${PILL_DATA_ATTR}]`)) return false;
    // An explicit newline is content: the user pressed Enter to start a
    // multi-line message, the placeholder should hide and the editor
    // should reflect that the document is no longer empty.
    const text = extractPlainText(host);
    if (text.includes("\n")) return false;
    return text.trim().length === 0;
  }, []);

  /**
   * Walk the live DOM and prune pill registrations whose spans were removed
   * by the user (Backspace/Delete on a pill). Called after every `input`
   * event from the host.
   */
  const reconcilePillsFromDom = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const presentIds = new Set<string>();
    host
      .querySelectorAll<HTMLElement>(`[${PILL_DATA_ATTR}]`)
      .forEach((element) => {
        const id = element.getAttribute(PILL_ID_ATTR);
        if (id) presentIds.add(id);
      });

    let changed = false;
    pillHostsRef.current.forEach((_value, id) => {
      if (!presentIds.has(id)) {
        pillHostsRef.current.delete(id);
        pillAttrsRef.current.delete(id);
        changed = true;
      }
    });
    if (changed) syncPillEntries();
  }, [syncPillEntries]);

  return useMemo(
    () => ({
      hostRef,
      pillEntries,
      insertPill,
      insertTextAtCaret,
      setHostContent,
      restoreSnapshot,
      captureSnapshot,
      clearHost,
      insertNewline,
      focusHost,
      removePillByPath,
      isHostEmpty,
      reconcilePillsFromDom,
      registerPillHost,
    }),
    [
      pillEntries,
      insertPill,
      insertTextAtCaret,
      setHostContent,
      restoreSnapshot,
      captureSnapshot,
      clearHost,
      insertNewline,
      focusHost,
      removePillByPath,
      isHostEmpty,
      reconcilePillsFromDom,
      registerPillHost,
    ]
  );
}
