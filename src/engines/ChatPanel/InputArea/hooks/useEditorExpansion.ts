/**
 * useEditorExpansion
 *
 * Manages the "compact pill ↔ expanded box" layout toggle for the chat
 * input. The editor starts in pill (single-line) mode and expands when:
 *   1. The user types a newline character.
 *   2. The text fills ≥80% of the editor slot's horizontal width.
 *   3. Other composer chrome that genuinely needs extra vertical space is
 *      visible (images, cite-code, reply banner).
 *
 * Floating menus (`@`, inline `/`, and `+` skills/tools) intentionally do
 * not participate in this state: they retain the current composer height and
 * position from the editor slot.
 *
 * It collapses back to pill ONLY when the document is fully empty, so
 * backspacing to a shorter line does NOT cause a flash.
 *
 * The hook also owns the ResizeObserver that detects horizontal fill while
 * in compact mode. Callers must pass the stable `containerRef` to connect
 * the observer. `isCursorCompactRow` gates the observer — pass `false` if
 * the observer should be inactive.
 */
import { type RefObject, useCallback, useEffect, useReducer } from "react";

interface UseEditorExpansionOptions {
  containerRef: RefObject<HTMLElement | null>;
  composerInputRef: RefObject<{ focus?: () => void } | null>;
  handleContentChange: (text: string) => void;
  handleInputBlur: () => void;
}

interface UseEditorExpansionReturn {
  editorMultiline: boolean;
  suppressToolbarHover: boolean;
  acknowledgeToolbarHover: () => void;
  onEditorContentChange: (text: string) => void;
  onEditorBlur: () => void;
  /** Call with the final compact-row state after isCursorCompactRow is derived. */
  observeCompact: (isCompact: boolean) => void;
}

type EditorExpansionAction =
  | { type: "setMultiline"; value: boolean }
  | { type: "setCompact"; value: boolean }
  | { type: "acknowledgeToolbarHover" };

interface EditorExpansionState {
  editorMultiline: boolean;
  isCompact: boolean;
  suppressToolbarHover: boolean;
}

function editorExpansionReducer(
  state: EditorExpansionState,
  action: EditorExpansionAction
): EditorExpansionState {
  switch (action.type) {
    case "setMultiline": {
      if (state.editorMultiline === action.value) return state;
      return {
        ...state,
        editorMultiline: action.value,
        suppressToolbarHover:
          state.isCompact && action.value ? true : state.suppressToolbarHover,
      };
    }
    case "setCompact":
      if (state.isCompact === action.value) return state;
      return { ...state, isCompact: action.value };
    case "acknowledgeToolbarHover":
      return state.suppressToolbarHover
        ? { ...state, suppressToolbarHover: false }
        : state;
  }
}

/**
 * Measure the horizontal extent of the live document inside the editable
 * host. Using `scrollWidth` on the host itself is unreliable for the new
 * `contenteditable`-based `ComposerInput`: the host is `display: block`
 * (and `width: 100%` when empty), so its scrollWidth always equals the
 * available width even when only one or two characters are present.
 *
 * Instead we build a Range that spans the entire host and read the union
 * of its client rects, which gives the true ink extent of the text +
 * pills regardless of host display mode.
 */
function measureContentWidth(host: HTMLElement): number {
  if (!host.firstChild) return 0;
  const range = document.createRange();
  try {
    range.selectNodeContents(host);
    const rects = range.getClientRects();
    let width = 0;
    for (let index = 0; index < rects.length; index += 1) {
      if (rects[index].width > width) width = rects[index].width;
    }
    return width;
  } finally {
    range.detach?.();
  }
}

export function useEditorExpansion({
  containerRef,
  composerInputRef,
  handleContentChange,
  handleInputBlur,
}: UseEditorExpansionOptions): UseEditorExpansionReturn {
  const [{ editorMultiline, isCompact, suppressToolbarHover }, dispatch] =
    useReducer(editorExpansionReducer, {
      editorMultiline: false,
      isCompact: false,
      suppressToolbarHover: false,
    });

  const onEditorContentChange = useCallback(
    (text: string) => {
      handleContentChange(text);

      const root = containerRef.current;
      const content =
        root?.querySelector<HTMLElement>(".composer-input-content") ?? null;
      const hasPills = content?.querySelector("[data-composer-pill]") != null;

      // Any inserted pill switches the regular chat composer out of the
      // single-line compact row. Pills are atomic inline tokens; keeping them
      // inside the compact layout makes caret and selection painting diverge
      // between this path and the taller creator/edit surfaces.
      if (hasPills) {
        dispatch({ type: "setMultiline", value: true });
        return;
      }

      // An explicit newline always expands — even if the document is
      // otherwise blank. User just pressed Enter on an empty editor to
      // start composing a multi-line message; staying compact would hide
      // the new caret row.
      if (text.includes("\n")) {
        dispatch({ type: "setMultiline", value: true });
        return;
      }

      // Auto-collapse on full clear. Browsers can leave stray `\n` artifacts
      // (e.g. a trailing `<br>` after Backspace), but those are caught by
      // the newline branch above. Pills count as document content too —
      // only collapse when the host is truly empty (no text, no pills).
      if (text.trim().length === 0 && !hasPills) {
        dispatch({ type: "setMultiline", value: false });
        requestAnimationFrame(() => {
          composerInputRef.current?.focus?.();
        });
        return;
      }

      // Measure horizontal fill inline on growth; only swap to full if ≥80%.
      const slot = content?.closest<HTMLElement>("[data-editor-slot]");
      if (!content || !slot) return;
      const available = slot.clientWidth;
      const used = measureContentWidth(content);
      if (available > 0 && used / available >= 0.8) {
        dispatch({ type: "setMultiline", value: true });
      }
    },
    [containerRef, handleContentChange, composerInputRef]
  );

  const onEditorBlur = useCallback(() => {
    handleInputBlur();
  }, [handleInputBlur]);

  const observeCompact = useCallback((compact: boolean) => {
    dispatch({ type: "setCompact", value: compact });
  }, []);

  const acknowledgeToolbarHover = useCallback(() => {
    dispatch({ type: "acknowledgeToolbarHover" });
  }, []);

  // Detect when the pill's editor is ~80% full horizontally via ResizeObserver.
  // Only runs while compact and can only flip state to true — no oscillation.
  useEffect(() => {
    if (!isCompact) return;
    const root = containerRef.current;
    if (!root) return;
    const content = root.querySelector<HTMLElement>(".composer-input-content");
    if (!content) return;
    const slot = content.closest<HTMLElement>("[data-editor-slot]");
    if (!slot) return;

    const check = () => {
      const available = slot.clientWidth;
      if (available <= 0) return;
      const docText = (content.textContent ?? "").replace(/\u200b/g, "").trim();
      if (docText.length === 0) return;
      const used = measureContentWidth(content);
      if (used / available >= 0.8) {
        dispatch({ type: "setMultiline", value: true });
      }
    };

    check();
    const ro = new ResizeObserver(check);
    ro.observe(content);
    ro.observe(slot);
    return () => ro.disconnect();
  }, [isCompact, containerRef]);

  return {
    editorMultiline,
    suppressToolbarHover,
    acknowledgeToolbarHover,
    onEditorContentChange,
    onEditorBlur,
    observeCompact,
  };
}
