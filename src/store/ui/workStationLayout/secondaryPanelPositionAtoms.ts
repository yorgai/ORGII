/**
 * Per-app "secondary panel" position atoms.
 *
 * The secondary panel is the shared right-rail/bottom-row slot used
 * by `WorkStationShell` (Browser DevTools, Code Editor output, etc.).
 * Each app that exposes a secondary panel gets its own position atom
 * so users can set, e.g., DevTools to the right while keeping the
 * editor output at the bottom.
 *
 * Persisted via localStorage so the chosen position survives reloads.
 */
import { atom } from "jotai";

import { getStoredValue, setStoredValue } from "./storage";

/**
 * Canonical type for the secondary panel's dock position. Shared by
 * all per-app atoms below and re-exported by
 * `WorkStationShell/config.ts` so shell callers don't reach into the
 * store layer.
 */
export type SecondaryPanelPosition = "right" | "bottom";

function parseStoredPosition(
  raw: string | null,
  fallback: SecondaryPanelPosition
): SecondaryPanelPosition {
  if (raw === "right" || raw === "bottom") return raw;
  return fallback;
}

// ============================================
// Browser DevTools position — defaults to "right"
// ============================================

export const browserDevToolsPositionAtom = atom<SecondaryPanelPosition>(
  parseStoredPosition(getStoredValue("browser_devtools_position"), "right")
);
browserDevToolsPositionAtom.debugLabel = "browserDevToolsPositionAtom";

export const browserDevToolsPositionPersistAtom = atom(
  (get) => get(browserDevToolsPositionAtom),
  (get, set, value: SecondaryPanelPosition | "toggle") => {
    const next =
      value === "toggle"
        ? get(browserDevToolsPositionAtom) === "right"
          ? "bottom"
          : "right"
        : value;
    set(browserDevToolsPositionAtom, next);
    setStoredValue("browser_devtools_position", next);
  }
);

// ============================================
// Code Editor secondary panel position — defaults to "bottom"
// ============================================

export const editorPanelPositionAtom = atom<SecondaryPanelPosition>(
  parseStoredPosition(getStoredValue("editor_panel_position"), "bottom")
);
editorPanelPositionAtom.debugLabel = "editorPanelPositionAtom";

export const editorPanelPositionPersistAtom = atom(
  (get) => get(editorPanelPositionAtom),
  (get, set, value: SecondaryPanelPosition | "toggle") => {
    const next =
      value === "toggle"
        ? get(editorPanelPositionAtom) === "right"
          ? "bottom"
          : "right"
        : value;
    set(editorPanelPositionAtom, next);
    setStoredValue("editor_panel_position", next);
  }
);
