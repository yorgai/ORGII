/**
 * useDropdownAutoKeyboard Hook
 *
 * Zero-config keyboard navigation fallback for dropdowns that don't pass
 * an explicit `listNavigation` config to `useDropdownEngine`.
 *
 * Strategy:
 *   - While the dropdown is open, discover focusable rows inside
 *     `panelRef.current` by DOM query (buttons / `[role="menuitem"]` /
 *     `[role="option"]` that are not `[disabled]` and not opted-out via
 *     `[data-dropdown-keyboard-skip="true"]`).
 *   - Track a highlighted row index in state. Apply the highlight by
 *     setting `data-dropdown-keyboard-highlight="true"` on the active
 *     DOM node (CSS in `src/index.scss` paints it with the same
 *     `--color-fill-2` background as :hover).
 *   - Capture document-level keydown while open: ArrowUp/Down/Home/End
 *     move the highlight, Enter dispatches a synthetic click on the
 *     highlighted node, Escape closes via the engine's existing handler
 *     (we don't double-handle it here).
 *   - Start with no highlight on open (matches native macOS menu / Cursor
 *     palette behaviour: a click-to-open + hover-and-click flow doesn't
 *     surprise the user with a pre-highlighted row; the first ArrowDown
 *     promotes the first selectable row). Clear the highlight when the
 *     mouse moves over the panel so pointer + keyboard don't fight.
 *
 * Constraints:
 *   - Must NOT activate when the caller passes `listNavigation` to the
 *     engine (the explicit path takes over) or when `autoKeyboardNavigation`
 *     is disabled (e.g. `Select`, which already runs its own
 *     `useDropdownKeyboard` against a typed option list).
 *   - Must not steal keys from inputs inside the panel (search boxes).
 *     The handler bails when the event target is an editable element.
 */
import { type RefObject, useCallback, useEffect, useRef } from "react";

// ============================================
// Types
// ============================================

export interface UseDropdownAutoKeyboardOptions {
  /** Whether the dropdown is currently open. */
  isOpen: boolean;
  /** Panel ref - the hook queries rows from this subtree. */
  panelRef: RefObject<HTMLElement | null>;
  /** Close the dropdown (used after a row is committed via Enter). */
  onClose: () => void;
  /** When `false`, the hook is a no-op. */
  enabled: boolean;
}

// ============================================
// Constants
// ============================================

/**
 * Selector for rows that participate in keyboard navigation.
 *
 * `button:not([disabled])` covers every dropdown built with `<button>`
 * rows (the vast majority). `[role="menuitem"]` / `[role="option"]`
 * cover the rare div-based rows. Anything that should explicitly be
 * skipped (separators, section headers wrapped in a clickable element)
 * can opt out via `data-dropdown-keyboard-skip="true"`.
 */
const ROW_SELECTOR = [
  'button:not([disabled]):not([data-dropdown-keyboard-skip="true"])',
  '[role="menuitem"]:not([aria-disabled="true"]):not([data-dropdown-keyboard-skip="true"])',
  '[role="option"]:not([aria-disabled="true"]):not([data-dropdown-keyboard-skip="true"])',
].join(", ");

const HIGHLIGHT_ATTR = "data-dropdown-keyboard-highlight";
const KEYBOARD_MODE_ATTR = "data-dropdown-keyboard-mode";

// ============================================
// Helpers
// ============================================

function queryRows(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  // Exclude rows nested inside a sub-popover/portal that happens to be
  // a descendant of the panel (rare). We rely on the panel author to
  // keep nested controls outside the panel subtree, which is the
  // current convention.
  return Array.from(panel.querySelectorAll<HTMLElement>(ROW_SELECTOR)).filter(
    (element) => {
      // Skip rows whose ancestor is collapsed/hidden.
      if (element.offsetParent === null && element.tagName !== "BUTTON") {
        return false;
      }
      return true;
    }
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

function clearHighlight(panel: HTMLElement | null): void {
  if (!panel) return;
  const previous = panel.querySelectorAll<HTMLElement>(`[${HIGHLIGHT_ATTR}]`);
  previous.forEach((element) => {
    element.removeAttribute(HIGHLIGHT_ATTR);
  });
}

function setKeyboardMode(panel: HTMLElement | null, enabled: boolean): void {
  if (!panel) return;
  if (enabled) {
    panel.setAttribute(KEYBOARD_MODE_ATTR, "true");
  } else {
    panel.removeAttribute(KEYBOARD_MODE_ATTR);
  }
}

function applyHighlight(row: HTMLElement | null, panel: HTMLElement | null) {
  clearHighlight(panel);
  if (!row) return;
  setKeyboardMode(panel, true);
  row.setAttribute(HIGHLIGHT_ATTR, "true");
  row.scrollIntoView({ block: "nearest" });
}

// ============================================
// Hook
// ============================================

export function useDropdownAutoKeyboard({
  isOpen,
  panelRef,
  onClose,
  enabled,
}: UseDropdownAutoKeyboardOptions): void {
  const indexRef = useRef<number>(-1);

  // Reset highlight on every (re-)open. We deliberately leave the
  // highlight UNSET so a click-to-open + mouse-hover-then-click flow
  // doesn't surprise users with a pre-highlighted row. The first
  // ArrowDown promotes the first selectable row to highlighted; this
  // matches native macOS menu / Cursor command palette behaviour.
  useEffect(() => {
    if (!enabled) return;
    if (!isOpen) {
      indexRef.current = -1;
      return;
    }
    const panel = panelRef.current;
    return () => {
      clearHighlight(panel);
      setKeyboardMode(panel, false);
      indexRef.current = -1;
    };
  }, [isOpen, enabled, panelRef]);

  // Clear highlight when the user moves the mouse inside the panel so
  // pointer hover takes over without competing visuals.
  useEffect(() => {
    if (!enabled || !isOpen) return;
    const panel = panelRef.current;
    if (!panel) return;

    const handleMouseMove = () => {
      if (indexRef.current === -1) return;
      indexRef.current = -1;
      clearHighlight(panel);
      setKeyboardMode(panel, false);
    };

    panel.addEventListener("mousemove", handleMouseMove);
    return () => {
      panel.removeEventListener("mousemove", handleMouseMove);
    };
  }, [enabled, isOpen, panelRef]);

  const move = useCallback(
    (delta: 1 | -1 | "first" | "last") => {
      const panel = panelRef.current;
      const rows = queryRows(panel);
      if (rows.length === 0) {
        indexRef.current = -1;
        setKeyboardMode(panel, false);
        return;
      }
      const current = indexRef.current;
      let next: number;
      if (delta === "first") next = 0;
      else if (delta === "last") next = rows.length - 1;
      else if (current === -1) {
        next = delta === 1 ? 0 : rows.length - 1;
      } else {
        next = current + delta;
        if (next < 0) next = 0;
        if (next > rows.length - 1) next = rows.length - 1;
      }
      indexRef.current = next;
      applyHighlight(rows[next] ?? null, panel);
    },
    [panelRef]
  );

  const commit = useCallback(() => {
    const panel = panelRef.current;
    const rows = queryRows(panel);
    const current = indexRef.current;
    if (current < 0 || current >= rows.length) return false;
    const row = rows[current];
    // Use the native click so React onClick handlers fire identically
    // to a real pointer click.
    row.click();
    return true;
  }, [panelRef]);

  // Document-level capture listener — mirrors the strategy in
  // `useDropdownListNavigation` so keys are caught regardless of where
  // focus currently lives (trigger button, document.body, …).
  useEffect(() => {
    if (!enabled || !isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      // Don't hijack typing inside a search input nested in the panel.
      if (isEditableTarget(event.target)) return;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          event.stopPropagation();
          move(1);
          return;
        case "ArrowUp":
          event.preventDefault();
          event.stopPropagation();
          move(-1);
          return;
        case "Home":
          event.preventDefault();
          event.stopPropagation();
          move("first");
          return;
        case "End":
          event.preventDefault();
          event.stopPropagation();
          move("last");
          return;
        case "Enter": {
          // Only commit when a row is highlighted. Otherwise let the
          // event reach whatever has focus (e.g. the trigger), so
          // pressing Enter on an unopened dropdown doesn't silently
          // do nothing.
          if (indexRef.current < 0) return;
          event.preventDefault();
          event.stopPropagation();
          const committed = commit();
          if (committed) onClose();
          return;
        }
        // Escape is owned by `useDropdownEngine`'s own handler.
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [enabled, isOpen, move, commit, onClose]);
}

export default useDropdownAutoKeyboard;
