/**
 * Overlay Layer — reference-counted "is any React overlay currently visible?"
 *
 * Problem: On macOS, Tauri inline browser WKWebViews are native NSViews that
 * render and hit-test above sibling React content regardless of CSS z-index.
 * Any React overlay (dropdown, modal, spotlight, tooltip) rendered into a
 * portal at document.body will visually lose to an overlapping inline
 * webview.
 *
 * Solution: track how many overlays are currently mounted through a single
 * global ref counter. A bridge effect mounted at the app root watches the
 * count and, when it crosses 0 → 1+, sends all inline browser webviews to
 * the back of their NSView superviews. When the count returns to 0, it
 * brings them back to the front. All existing overlay primitives
 * (`useDropdownEngine`, `SpotlightPortal`, `Tooltip` portal) contribute
 * automatically — no per-call-site work.
 *
 * See `Documentation/WorkStation/Browser/webview-layering--0418.md`.
 */
import { atom, useAtom } from "jotai";
import { useEffect } from "react";

/**
 * Number of currently visible overlays (dropdowns, modals, tooltips, etc.).
 * Increment on overlay open / mount, decrement on close / unmount. Never
 * mutate directly outside the `useOverlayLayer` helper hook.
 */
export const activeOverlayCountAtom = atom(0);

/**
 * Contributes one reference to `activeOverlayCountAtom` while `active` is
 * true. Call from any overlay primitive whose portal can visually cross an
 * inline Browser webview's rect.
 *
 * Safe across strict-mode double-invocations: the cleanup always decrements
 * exactly once per active-mount, and the effect is keyed by `active`.
 */
export function useOverlayLayer(active: boolean): void {
  const [, setCount] = useAtom(activeOverlayCountAtom);

  useEffect(() => {
    if (!active) return;
    setCount((prev) => prev + 1);
    return () => {
      setCount((prev) => Math.max(0, prev - 1));
    };
  }, [active, setCount]);
}
